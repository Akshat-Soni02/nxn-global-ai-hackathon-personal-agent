// The floating Record / Stop button, on the desktop above every app (and every Space). It is a remote control: a
// press asks the daemon to start or stop, and it shows what the daemon reports back, like the extension's button.
// - A non-activating panel: pressing it does not take focus from the app you are recording.
// - Its own clicks are never recorded: macOS does not show an app's own events to its global monitors.
// - Drag it anywhere (its place is remembered); right-click it for Accessibility (Mac apps), Open and Quit.
// - Its face is SwiftUI (Pill.swift), hosted here; this file keeps the state and the window.
import AppKit
import SwiftUI

final class Panel {
  enum Icon { case record, stop, spinner, terminal, check, alert }
  enum Phase: String { case compiling, question, saved, empty, failed, busy, replay, form }

  struct Look: Equatable {
    var kind: Kind
    var icon: Icon
    var text: String
    var badge = false  // Mac apps can't be recorded yet (no Accessibility)
    enum Kind { case idle, rec, work, note }
  }

  var onPress: () -> Void = {}
  var onDiscard: () -> Void = {}
  var onAllow: () -> Void = {}
  var onQuit: () -> Void = {}
  var onOpen: () -> Void = {}

  var trusted = false { didSet { render() } }
  private(set) var recordingSince: Date?
  private var consent = (mic: false, screen: false)
  private var status: (phase: Phase, text: String, at: Date)?
  private var local: (text: String, at: Date)?
  private var dismissed = Date.distantPast
  private var ticker: Timer?

  private let window: NSPanel
  private let model = PillModel()
  private let hosting: DraggableHostingView<Pill>

  init() {
    hosting = DraggableHostingView(rootView: Pill(model: model))
    window = NSPanel(
      contentRect: NSRect(x: 0, y: 0, width: 40, height: 40), styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered, defer: false)
    window.isFloatingPanel = true
    window.level = .floating
    window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = true
    window.hidesOnDeactivate = false
    window.becomesKeyOnlyIfNeeded = true
    window.contentView = hosting
    hosting.rootView = Pill(
      model: model, onPress: { [weak self] in self?.press() }, onDiscard: { [weak self] in self?.discard() })
    hosting.onMoved = { [weak self] in self?.savePosition() }
    hosting.onMenu = { [weak self] event in self?.showMenu(event) }
    placeAtSavedPosition()
  }

  func show() {
    window.orderFrontRegardless()
    render()
  }

  // MARK: state from the daemon

  func recording(since: Date, mic: Bool = false, screen: Bool = false) {
    recordingSince = since
    consent = (mic, screen)
    status = nil
    if !trusted { local = ("Recording Chrome and files. Mac apps need Accessibility: right-click me", Date()) }
    render()
  }

  func stopped() {
    recordingSince = nil
    render()
  }

  func status(_ phase: Phase, _ text: String) {
    // "Still compiling" while a question is showing would only hide that question.
    if phase == .busy, let s = status?.phase, s == .compiling || s == .question { return }
    status = (phase, text, Date())
    render()
  }

  var isRecording: Bool { recordingSince != nil }

  // MARK: what it shows (the same rules as the extension's button.ts)

  func look(now: Date = Date()) -> Look {
    if let l = local, now.timeIntervalSince(l.at) < 6 { return Look(kind: .note, icon: .alert, text: l.text) }
    if let since = recordingSince {
      let s = max(0, Int(now.timeIntervalSince(since)))
      return Look(kind: .rec, icon: .stop, text: "Stop · \(s / 60):\(String(format: "%02d", s % 60))")
    }
    if let st = status, st.at > dismissed {
      switch st.phase {
      case .compiling, .replay: return Look(kind: .work, icon: .spinner, text: st.text)
      case .question: return Look(kind: .work, icon: .terminal, text: st.text)
      case .form:  // Record was pressed: the form is open in the window
        if now.timeIntervalSince(st.at) < 15 { return Look(kind: .note, icon: .terminal, text: st.text) }
      default:
        if now.timeIntervalSince(st.at) < 15 {
          return Look(kind: .note, icon: st.phase == .saved ? .check : .alert, text: st.text)
        }
      }
    }
    return Look(kind: .idle, icon: .record, text: "Record", badge: !trusted)
  }

  private func render() {
    let l = look()
    model.look = l
    model.mic = l.kind == .rec && consent.mic
    model.screen = l.kind == .rec && consent.screen
    hosting.toolTip =
      l.kind == .idle
      ? (trusted
        ? "Record a task (Shadow)"
        : "Record a task. Mac apps are not recorded until you allow Accessibility: right-click.")
      : l.text
    resize(to: hosting.fittingSize.width)
    // A clock while recording, and a timer to let notes expire.
    let ticking = l.kind != .idle
    if ticking && ticker == nil {
      ticker = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.render() }
    } else if !ticking, let t = ticker {
      t.invalidate()
      ticker = nil
    }
  }

  private func press() {
    switch look().kind {
    case .work: return  // compiling, or a question is open
    case .note:
      local = nil
      dismissed = Date()
      render()
    default:
      onPress()
    }
  }

  private func discard() {
    guard isRecording else { return }
    onDiscard()
  }

  func refused(_ text: String) {
    local = (text, Date())
    render()
  }

  private func showMenu(_ event: NSEvent) {
    let menu = NSMenu()
    let open = NSMenuItem(title: "Open Shadow", action: #selector(MenuTarget.open), keyEquivalent: "")
    open.target = menuTarget
    menu.addItem(open)
    menu.addItem(.separator())
    let allow = NSMenuItem(
      title: trusted ? "Mac apps: allowed (Accessibility)" : "Allow Mac apps (Accessibility)…",
      action: trusted ? nil : #selector(MenuTarget.allow), keyEquivalent: "")
    allow.target = menuTarget
    allow.isEnabled = !trusted
    menu.addItem(allow)
    menu.addItem(.separator())
    let quit = NSMenuItem(title: "Quit Shadow", action: #selector(MenuTarget.quit), keyEquivalent: "")
    quit.target = menuTarget
    menu.addItem(quit)
    NSMenu.popUpContextMenu(menu, with: event, for: hosting)
  }

  private lazy var menuTarget = MenuTarget(
    allow: { [weak self] in self?.onAllow() }, quit: { [weak self] in self?.onQuit() },
    open: { [weak self] in self?.onOpen() })

  // MARK: position: anchored at its right edge, so it grows to the left

  private func resize(to width: CGFloat) {
    let w = max(40, ceil(width))
    var frame = window.frame
    guard abs(frame.width - w) > 0.5 else { return }
    frame.origin.x = frame.maxX - w
    frame.size.width = w
    window.setFrame(frame, display: true)
  }

  private func placeAtSavedPosition() {
    let screen = NSScreen.screens.first?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    let saved = UserDefaults.standard.array(forKey: "buttonRightBottom") as? [Double]
    let right = saved?.first ?? Double(screen.maxX - 24)
    let bottom = saved?.last ?? Double(screen.minY + 24)
    window.setFrameOrigin(NSPoint(x: right - 40, y: bottom))
  }

  private func savePosition() {
    UserDefaults.standard.set([Double(window.frame.maxX), Double(window.frame.minY)], forKey: "buttonRightBottom")
  }

  // MARK: pictures of each look, to check the drawing without a screen recording permission

  @MainActor func snapshots(to dir: String) {
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let looks: [(String, Look, Bool)] = [
      ("idle", Look(kind: .idle, icon: .record, text: "Record"), false),
      ("idle-no-accessibility", Look(kind: .idle, icon: .record, text: "Record", badge: true), false),
      ("recording", Look(kind: .rec, icon: .stop, text: "Stop · 0:42"), true),
      ("compiling", Look(kind: .work, icon: .spinner, text: "Compiling…"), false),
      ("question", Look(kind: .work, icon: .terminal, text: "Answer in Shadow: Describe this task"), false),
      ("saved", Look(kind: .note, icon: .check, text: "Saved timesheet. Replay: run timesheet"), false),
    ]
    for (name, l, rec) in looks {
      let m = PillModel()
      m.look = l
      m.mic = rec
      m.screen = rec
      let renderer = ImageRenderer(content: Pill(model: m).padding(4))
      renderer.scale = 2
      guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
        let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:])
      else { continue }
      try? png.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
    }
  }
}

final class MenuTarget: NSObject {
  let allowAction: () -> Void
  let quitAction: () -> Void
  let openAction: () -> Void
  init(allow: @escaping () -> Void, quit: @escaping () -> Void, open: @escaping () -> Void) {
    allowAction = allow
    quitAction = quit
    openAction = open
  }
  @objc func allow() { allowAction() }
  @objc func quit() { quitAction() }
  @objc func open() { openAction() }
}

// Hosts the SwiftUI pill and adds what SwiftUI can't do for a floating panel: a drag that moves the whole window (a
// press that moved is a drag, not a click, so the pill's tap never fires), and a right-click menu.
final class DraggableHostingView<Content: View>: NSHostingView<Content> {
  var onMoved: () -> Void = {}
  var onMenu: (NSEvent) -> Void = { _ in }
  private var pressAt: NSPoint?
  private var moved = false

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override var mouseDownCanMoveWindow: Bool { false }

  override func mouseDown(with event: NSEvent) {
    pressAt = NSEvent.mouseLocation
    moved = false
    // Not passed on yet: if the press turns out to be a drag, SwiftUI must never see a tap.
  }

  override func mouseDragged(with event: NSEvent) {
    guard let start = pressAt, let window else { return }
    let now = NSEvent.mouseLocation
    if !moved && hypot(now.x - start.x, now.y - start.y) < 4 { return }
    moved = true
    window.setFrameOrigin(
      NSPoint(x: window.frame.origin.x + now.x - start.x, y: window.frame.origin.y + now.y - start.y))
    pressAt = now
  }

  override func mouseUp(with event: NSEvent) {
    if moved {
      onMoved()
    } else {
      // A click: hand SwiftUI the press and the release it was waiting for.
      super.mouseDown(with: event)
      super.mouseUp(with: event)
    }
    pressAt = nil
  }

  override func rightMouseDown(with event: NSEvent) { onMenu(event) }
}
