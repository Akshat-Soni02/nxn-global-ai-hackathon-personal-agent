// The floating Record / Stop button, on the desktop above every app (and every Space). It is a remote control: a
// press asks the daemon to start or stop, and it shows what the daemon reports back, like the extension's button.
// - A non-activating panel: pressing it does not take focus from the app you are recording.
// - Its own clicks are never recorded: macOS does not show an app's own events to its global monitors.
// - Drag it anywhere; right-click it for Accessibility (Mac apps) and Quit.
import AppKit

final class Panel {
  enum Icon { case record, stop, spinner, terminal, check, alert }
  enum Phase: String { case compiling, question, saved, empty, failed, busy, replay }

  struct Look: Equatable {
    var kind: Kind
    var icon: Icon
    var text: String
    var badge = false  // Mac apps can't be recorded yet (no Accessibility)
    enum Kind { case idle, rec, work, note }
  }

  var onPress: () -> Void = {}
  var onAllow: () -> Void = {}
  var onQuit: () -> Void = {}

  var trusted = false { didSet { render() } }
  private(set) var recordingSince: Date?
  private var status: (phase: Phase, text: String, at: Date)?
  private var local: (text: String, at: Date)?
  private var dismissed = Date.distantPast
  private var ticker: Timer?
  private var spin = 0.0

  private let window: NSPanel
  private let view: ButtonView

  init() {
    view = ButtonView(frame: NSRect(x: 0, y: 0, width: 40, height: 40))
    window = NSPanel(
      contentRect: view.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    window.isFloatingPanel = true
    window.level = .floating
    window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = true
    window.hidesOnDeactivate = false
    window.becomesKeyOnlyIfNeeded = true
    window.contentView = view
    view.onClick = { [weak self] in self?.press() }
    view.onMenu = { [weak self] event in self?.showMenu(event) }
    view.onMoved = { [weak self] in self?.savePosition() }
    placeAtSavedPosition()
  }

  func show() {
    window.orderFrontRegardless()
    render()
  }

  // MARK: state from the daemon

  func recording(since: Date) {
    recordingSince = since
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
    view.look = l
    view.spin = spin
    view.toolTip =
      l.kind == .idle
      ? (trusted
        ? "Record a task (Task Player)"
        : "Record a task. Mac apps are not recorded until you allow Accessibility: right-click.")
      : l.text
    view.setAccessibilityLabel(l.kind == .idle ? "Record a task" : l.text)
    resize(to: view.fittingWidth())
    // A clock while recording, a spinner while compiling, and a timer to let notes expire.
    let ticking = l.kind != .idle
    if ticking && ticker == nil {
      ticker = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
        guard let self else { return }
        self.spin += 0.35
        self.render()
      }
    } else if !ticking, let t = ticker {
      t.invalidate()
      ticker = nil
    }
  }

  private func press() {
    switch look().kind {
    case .work: return  // compiling, or a question is open in the daemon terminal
    case .note:
      local = nil
      dismissed = Date()
      render()
    default:
      onPress()
    }
  }

  func refused(_ text: String) {
    local = (text, Date())
    render()
  }

  private func showMenu(_ event: NSEvent) {
    let menu = NSMenu()
    let allow = NSMenuItem(
      title: trusted ? "Mac apps: allowed (Accessibility)" : "Allow Mac apps (Accessibility)…",
      action: trusted ? nil : #selector(MenuTarget.allow), keyEquivalent: "")
    allow.target = menuTarget
    allow.isEnabled = !trusted
    menu.addItem(allow)
    menu.addItem(.separator())
    let quit = NSMenuItem(title: "Quit Task Player", action: #selector(MenuTarget.quit), keyEquivalent: "")
    quit.target = menuTarget
    menu.addItem(quit)
    NSMenu.popUpContextMenu(menu, with: event, for: view)
  }

  private lazy var menuTarget = MenuTarget(
    allow: { [weak self] in self?.onAllow() }, quit: { [weak self] in self?.onQuit() })

  // MARK: position: anchored at its right edge, so it grows to the left

  private func resize(to width: CGFloat) {
    var frame = window.frame
    guard abs(frame.width - width) > 0.5 else { return }
    frame.origin.x = frame.maxX - width
    frame.size.width = width
    window.setFrame(frame, display: true)
    view.frame = NSRect(x: 0, y: 0, width: width, height: 40)
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

  func snapshots(to dir: String) {
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let looks: [(String, Look)] = [
      ("idle", Look(kind: .idle, icon: .record, text: "Record")),
      ("idle-no-accessibility", Look(kind: .idle, icon: .record, text: "Record", badge: true)),
      ("recording", Look(kind: .rec, icon: .stop, text: "Stop · 0:42")),
      ("compiling", Look(kind: .work, icon: .spinner, text: "Compiling…")),
      ("question", Look(kind: .work, icon: .terminal, text: "Answer in the daemon terminal: Describe this task")),
      ("saved", Look(kind: .note, icon: .check, text: "Saved timesheet. Replay: run timesheet")),
    ]
    for (name, l) in looks {
      let v = ButtonView(frame: .zero)
      v.look = l
      v.spin = 1.2
      v.frame = NSRect(x: 0, y: 0, width: v.fittingWidth(), height: 40)
      guard let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) else { continue }
      v.cacheDisplay(in: v.bounds, to: rep)
      try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
    }
  }
}

final class MenuTarget: NSObject {
  let allowAction: () -> Void
  let quitAction: () -> Void
  init(allow: @escaping () -> Void, quit: @escaping () -> Void) {
    allowAction = allow
    quitAction = quit
  }
  @objc func allow() { allowAction() }
  @objc func quit() { quitAction() }
}

// Draws the button: a circle with a red dot when idle, a red pill with a stop square and a clock while recording, a
// dark pill with an icon and a line of text otherwise. Vector paths, so it is sharp at any scale.
final class ButtonView: NSView {
  var look = Panel.Look(kind: .idle, icon: .record, text: "Record") { didSet { needsDisplay = true } }
  var spin = 0.0 { didSet { if look.icon == .spinner { needsDisplay = true } } }
  var onClick: () -> Void = {}
  var onMenu: (NSEvent) -> Void = { _ in }
  var onMoved: () -> Void = {}
  private var pressAt: NSPoint?
  private var moved = false

  private let font = NSFont.systemFont(ofSize: 13, weight: .semibold)
  private var textAttrs: [NSAttributedString.Key: Any] {
    let p = NSMutableParagraphStyle()
    p.lineBreakMode = .byTruncatingTail
    return [.font: font, .foregroundColor: NSColor.white, .paragraphStyle: p]
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override var mouseDownCanMoveWindow: Bool { false }

  func fittingWidth() -> CGFloat {
    if look.kind == .idle { return 40 }
    let text = min((look.text as NSString).size(withAttributes: textAttrs).width, 340)
    return ceil(12 + 16 + 8 + text + 14)
  }

  override func draw(_ dirty: NSRect) {
    let outline = bounds.insetBy(dx: 0.5, dy: 0.5)
    let shape = NSBezierPath(roundedRect: outline, xRadius: outline.height / 2, yRadius: outline.height / 2)
    let fill =
      look.kind == .rec
      ? NSColor(srgbRed: 0.86, green: 0.15, blue: 0.15, alpha: 1)
      : NSColor(srgbRed: 0.094, green: 0.094, blue: 0.106, alpha: 1)
    fill.setFill()
    shape.fill()
    NSColor(white: 1, alpha: 0.16).setStroke()
    shape.lineWidth = 1
    shape.stroke()

    let iconRect =
      look.kind == .idle
      ? NSRect(x: (bounds.width - 16) / 2, y: 12, width: 16, height: 16)
      : NSRect(x: 12, y: 12, width: 16, height: 16)
    drawIcon(look.icon, in: iconRect)
    if look.badge {
      NSColor(srgbRed: 0.98, green: 0.75, blue: 0.14, alpha: 1).setFill()
      NSBezierPath(ovalIn: NSRect(x: bounds.width - 13, y: bounds.height - 13, width: 8, height: 8)).fill()
    }
    if look.kind != .idle {
      let x = iconRect.maxX + 8
      let size = (look.text as NSString).size(withAttributes: textAttrs)
      (look.text as NSString).draw(
        in: NSRect(x: x, y: (bounds.height - size.height) / 2, width: bounds.width - x - 14, height: size.height),
        withAttributes: textAttrs)
    }
  }

  private func drawIcon(_ icon: Panel.Icon, in r: NSRect) {
    let amber = NSColor(srgbRed: 0.98, green: 0.75, blue: 0.14, alpha: 1)
    func line(_ path: NSBezierPath, _ color: NSColor, _ width: CGFloat) {
      color.setStroke()
      path.lineWidth = width
      path.lineCapStyle = .round
      path.lineJoinStyle = .round
      path.stroke()
    }
    // Points in a 16x16 box measured from its top-left, like the web button's SVG.
    func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: r.minX + x, y: r.minY + 16 - y) }
    switch icon {
    case .record:
      NSColor(srgbRed: 0.94, green: 0.27, blue: 0.27, alpha: 1).setFill()
      NSBezierPath(ovalIn: NSRect(x: r.midX - 5.5, y: r.midY - 5.5, width: 11, height: 11)).fill()
    case .stop:
      NSColor.white.setFill()
      NSBezierPath(
        roundedRect: NSRect(x: r.midX - 4.5, y: r.midY - 4.5, width: 9, height: 9), xRadius: 2, yRadius: 2
      ).fill()
    case .spinner:
      line(NSBezierPath(ovalIn: r.insetBy(dx: 2, dy: 2)), NSColor(white: 1, alpha: 0.3), 2)
      let arc = NSBezierPath()
      let start = CGFloat(90 - spin * 57.3)
      arc.appendArc(
        withCenter: NSPoint(x: r.midX, y: r.midY), radius: 6, startAngle: start, endAngle: start - 90,
        clockwise: true)
      line(arc, .white, 2)
    case .terminal:
      line(
        NSBezierPath(
          roundedRect: NSRect(x: r.minX + 1.5, y: r.minY + 2.5, width: 13, height: 11), xRadius: 2, yRadius: 2),
        amber, 1.5)
      let prompt = NSBezierPath()
      prompt.move(to: p(4.5, 6))
      prompt.line(to: p(6.5, 8))
      prompt.line(to: p(4.5, 10))
      prompt.move(to: p(8.5, 10.5))
      prompt.line(to: p(11.5, 10.5))
      line(prompt, amber, 1.5)
    case .check:
      let tick = NSBezierPath()
      tick.move(to: p(3, 8.5))
      tick.line(to: p(6.2, 11.7))
      tick.line(to: p(13, 4.8))
      line(tick, NSColor(srgbRed: 0.29, green: 0.87, blue: 0.5, alpha: 1), 2)
    case .alert:
      line(NSBezierPath(ovalIn: r.insetBy(dx: 1.75, dy: 1.75)), amber, 1.5)
      let bar = NSBezierPath()
      bar.move(to: p(8, 4.8))
      bar.line(to: p(8, 8.6))
      line(bar, amber, 1.6)
      amber.setFill()
      NSBezierPath(ovalIn: NSRect(x: r.minX + 7.1, y: r.minY + 16 - 12.1, width: 1.8, height: 1.8)).fill()
    }
  }

  // MARK: mouse: a press that moved is a drag, not a click

  override func mouseDown(with event: NSEvent) {
    pressAt = NSEvent.mouseLocation
    moved = false
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
    if moved { onMoved() } else { onClick() }
    pressAt = nil
  }

  override func rightMouseDown(with event: NSEvent) { onMenu(event) }

  override func isAccessibilityElement() -> Bool { true }
  override func accessibilityRole() -> NSAccessibility.Role? { .button }
}
