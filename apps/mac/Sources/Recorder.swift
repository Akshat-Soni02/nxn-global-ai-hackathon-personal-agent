// Record, Mac apps: what you click, type, press and choose in other apps, described through the Accessibility API.
// Safety, by construction:
// - It listens only between Record and Stop: the monitors are added on record.start and removed on record.stop.
// - NSEvent global monitors are passive: they see a copy of an event after it happened and cannot block or change it.
// - No keystroke log: characters are never recorded. A text field's final value is read from the field when you
//   leave it; only shortcuts (Cmd+S), Return, Escape and arrow keys are recorded as keys.
// - Password fields (AXSecureTextField) are never read: the step becomes a secret input. macOS also stops delivering
//   keys to monitors while a password field has focus (Secure Event Input).
// - Some apps are never recorded: password managers, terminals (their whole scrollback is one text value), Chrome
//   (the extension records web pages), Finder (its moves and renames are recorded from the disk, as file steps, so
//   they replay on next month's file instead of clicking last month's row) and Task Player itself.
// - A value over 2 000 characters (a whole document) is not kept; the skill asks for it instead.
import AppKit
import ApplicationServices

final class Recorder {
  // A trace event without id, sessionId and type; main.swift adds those.
  var emit: (JSON) -> Void = { _ in }
  // A folder a Finder window shows, outside your home folder (which the daemon already watches).
  var onFolder: (String) -> Void = { _ in }
  private var reportedFolders = Set<String>()
  private var lastFinderLook = Date.distantPast
  // Task Player's own test window (Fixture.swift) is recordable; otherwise Task Player never records itself.
  var recordSelf = false
  private(set) var running = false
  private var monitors: [Any] = []
  private var activation: NSObjectProtocol?
  private var typing: Typing?

  private struct Typing {
    let element: AXUIElement
    let described: JSON
    let app: (id: String, name: String)
    var value: String?
    let secret: Bool
    var pasted = false
  }

  static let neverRecorded: Set<String> = [
    // password managers and system password prompts
    "com.apple.keychainaccess", "com.apple.Passwords", "com.1password.1password", "com.agilebits.onepassword7",
    "com.bitwarden.desktop", "com.lastpass.LastPass", "org.keepassxc.keepassxc", "com.dashlane.dashlanephonefinal",
    "com.apple.SecurityAgent", "com.apple.loginwindow",
    // terminals
    "com.apple.Terminal", "com.googlecode.iterm2", "dev.warp.Warp-Stable", "com.mitchellh.ghostty",
    "net.kovidgoyal.kitty", "org.alacritty", "co.zeit.hyper",
    // Finder: the file watcher records what it did to files
    "com.apple.finder",
    // Chrome: the extension records it, by page element
    "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.dev", "com.google.Chrome.canary",
    "com.google.chrome.for.testing",
  ]
  static let valueLimit = 2_000

  func start() {
    guard !running else { return }
    running = true
    // Without Accessibility, other apps can't be read: web and file capture still run, this records nothing.
    guard AXIsProcessTrusted() else { return }
    AXUIElementSetMessagingTimeout(AX.systemWide, 0.5) // a hung app must not stall the recorder
    if let front = NSWorkspace.shared.frontmostApplication { AX.exposeControls(of: front.processIdentifier) }
    reportFinderFolders(force: true) // folders already open before you pressed Record
    if let m = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] e in
      self?.mouseDown(e)
    }) { monitors.append(m) }
    if let m = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown], handler: { [weak self] e in self?.keyDown(e) }) {
      monitors.append(m)
    }
    activation = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
    ) { [weak self] note in
      guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
      self?.activated(app)
    }
  }

  func stop() {
    guard running else { return }
    flushTyping()
    for m in monitors { NSEvent.removeMonitor(m) }
    monitors = []
    if let a = activation { NSWorkspace.shared.notificationCenter.removeObserver(a) }
    activation = nil
    reportedFolders = []
    running = false
  }

  // MARK: Finder's folders

  // Finder itself is recorded by what it does to files. The daemon watches your home folder; a folder elsewhere (an
  // external drive) is watched once a Finder window shows it, before you move anything there.
  private func reportFinderFolders(force: Bool = false) {
    guard force || Date().timeIntervalSince(lastFinderLook) > 2 else { return }
    lastFinderLook = Date()
    let seen = AX.finderFolders()
    // Windows open but none said its folder: ask Finder instead (the only case that needs that permission).
    let folders = seen.windows > 0 && seen.folders.isEmpty ? finderFoldersByScript() : seen.folders
    let home = NSHomeDirectory()
    for folder in folders where !folder.hasPrefix(home + "/") && folder != home && !reportedFolders.contains(folder) {
      reportedFolders.insert(folder)
      onFolder(folder)
    }
  }

  // When Finder's windows don't say their folder through Accessibility: ask Finder (macOS asks you once to let
  // Task Player do that: Privacy & Security > Automation).
  private func finderFoldersByScript() -> [String] {
    let source = """
      tell application "Finder"
        set out to {}
        repeat with w in Finder windows
          try
            set end of out to POSIX path of (target of w as alias)
          end try
        end repeat
        return out
      end tell
      """
    guard let result = NSAppleScript(source: source)?.executeAndReturnError(nil), result.numberOfItems > 0 else {
      return []
    }
    return (1...result.numberOfItems).compactMap { result.atIndex($0)?.stringValue }
  }

  private func recorded(_ app: (id: String, name: String)?) -> Bool {
    guard let app else { return false }
    if app.id == Bundle.main.bundleIdentifier { return recordSelf }
    return !Recorder.neverRecorded.contains(app.id)
  }

  private func appJSON(_ app: (id: String, name: String)) -> JSON { ["id": app.id, "name": app.name] }
  private func now() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) } // epoch ms, like the web events

  // MARK: clicks and menus

  private func mouseDown(_ e: NSEvent) {
    if NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.finder" { reportFinderFolders() }
    guard let hit = AX.hit(AX.axPoint(fromScreen: NSEvent.mouseLocation)) else { return }
    recordClick(hit, button: e.type == .rightMouseDown ? "right" : "left")
  }

  // What a click on `hit` records. The global monitor calls it after hit-testing; the fixture's scripted user calls
  // the same function, so a test exercises the same path.
  func recordClick(_ hit: AXUIElement, button: String = "left") {
    guard running else { return }
    let app = AX.app(pid: AX.pid(hit))
    guard recorded(app), let app else { return }
    flushTyping()
    let el = AX.actionableAncestor(hit)
    switch AX.role(el) {
    case "AXMenuBarItem", "AXMenuBar":
      return // opening a menu: the item you then choose is the step
    case "AXMenuItem":
      if let path = AX.menuBarPath(el) {
        emit(["event": "app_menu", "at": now(), "app": appJSON(app), "menu": path])
        return
      }
    default:
      break
    }
    var event: JSON = ["event": "app_click", "at": now(), "app": appJSON(app), "element": AX.describe(el)]
    if button == "right" { event["button"] = "right" }
    emit(event)
  }

  // MARK: keys and typing

  private static let named: [UInt16: String] = [
    36: "Return", 76: "Return", 53: "Escape", 48: "Tab", 51: "Delete", 117: "ForwardDelete",
    123: "Left", 124: "Right", 125: "Down", 126: "Up", 115: "Home", 119: "End", 116: "PageUp", 121: "PageDown",
  ]

  private func keyDown(_ e: NSEvent) {
    let flags = e.modifierFlags.intersection(.deviceIndependentFlagsMask)
    var mods: [String] = []
    if flags.contains(.command) { mods.append("cmd") }
    if flags.contains(.control) { mods.append("ctrl") }
    if flags.contains(.option) { mods.append("option") }
    let named = Recorder.named[e.keyCode]
    let key = named ?? (e.charactersIgnoringModifiers ?? "").lowercased()

    if !mods.isEmpty {
      if flags.contains(.shift) { mods.append("shift") }
      if mods == ["cmd"] && key == "v" {
        notePaste() // a paste into a field: the field's value is not kept, as on the web
        return
      }
      if mods == ["cmd"] && ["a", "c", "x", "z"].contains(key) && typing != nil { return } // editing inside the field
      recordKey(key, modifiers: mods)
      return
    }
    guard let named else {
      noteTyping() // a character: remember which field, never the key
      return
    }
    let inText = typing != nil
    switch named {
    case "Tab":
      flushTyping() // moves focus; the next field's step says where
    case "Delete", "ForwardDelete", "Left", "Right", "Home", "End":
      if inText { noteTyping() } else { recordKey(named, modifiers: []) }
    default:
      recordKey(named, modifiers: [])
    }
  }

  func recordKey(_ key: String, modifiers: [String]) {
    guard running, let app = frontApp(), recorded(app) else { return }
    flushTyping()
    emit(["event": "app_key", "at": now(), "app": appJSON(app), "value": key, "modifiers": modifiers])
  }

  private func frontApp() -> (id: String, name: String)? {
    guard let app = NSWorkspace.shared.frontmostApplication, let id = app.bundleIdentifier else { return nil }
    return (id, app.localizedName ?? id)
  }

  private func noteTyping() {
    guard let focused = AX.element(AX.systemWide, kAXFocusedUIElementAttribute) else { return }
    recordTyping(in: focused)
  }

  private func notePaste() {
    noteTyping()
    typing?.pasted = true
  }

  // A field being typed into. The global monitor calls it per key; the fixture calls it directly.
  func recordTyping(in el: AXUIElement) {
    guard running else { return }
    if let t = typing, CFEqual(t.element, el) {
      refreshValue()
      return
    }
    flushTyping()
    let app = AX.app(pid: AX.pid(el))
    guard recorded(app), let app else { return }
    typing = Typing(
      element: el, described: AX.describe(el), app: app, value: nil,
      secret: AX.string(el, kAXSubroleAttribute) == "AXSecureTextField")
    refreshValue()
  }

  // The field updates after the key event: read its value a moment later. A secret field is never read.
  private func refreshValue() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
      guard let self, var t = self.typing, !t.secret else { return }
      t.value = AX.attr(t.element, kAXValueAttribute) as? String ?? t.value
      self.typing = t
    }
  }

  func flushTyping() {
    guard let t = typing else { return }
    typing = nil
    var event: JSON = ["event": "app_type", "at": now(), "app": appJSON(t.app), "element": t.described]
    if t.secret {
      event["secret"] = true
    } else if t.pasted {
      event["pasted"] = true
    } else {
      let value = AX.attr(t.element, kAXValueAttribute) as? String ?? t.value ?? ""
      if value.count > Recorder.valueLimit { event["long"] = true } else { event["value"] = value }
    }
    emit(event)
  }

  // MARK: apps

  private func activated(_ app: NSRunningApplication) {
    guard let id = app.bundleIdentifier else { return }
    AX.exposeControls(of: app.processIdentifier)
    if id == "com.apple.finder" { reportFinderFolders(force: true) }
    flushTyping()
    let info = (id: id, name: app.localizedName ?? id)
    if recorded(info) { emit(["event": "app_activate", "at": now(), "app": appJSON(info)]) }
  }
}
