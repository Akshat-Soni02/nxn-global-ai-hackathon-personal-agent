// Replay, Mac apps: one ax step at a time, sent by the daemon (templates already filled in). It finds the control
// again by what it was recorded as (AX.find) and acts on the control itself: AXPress, setting its value, a menu item
// by its titles. Only when a control has no action of its own is it clicked, at its current position.
import AppKit
import ApplicationServices

final class Player {
  private let queue = DispatchQueue(label: "taskplayer.player")

  // Runs off the main thread, so the floating button stays responsive; replies on the main thread.
  func run(_ step: JSON, reply: @escaping (JSON) -> Void) {
    queue.async {
      let result = self.execute(step)
      DispatchQueue.main.async { reply(result) }
    }
  }

  private func fail(_ message: String) -> JSON { ["ok": false, "error": message] }

  // Task Player's own window (test mode) answers the Accessibility API on its main thread: acting on it from this
  // queue does the action but reports a failure. Other apps answer across processes, from any thread.
  private func onTarget<T>(_ isSelf: Bool, _ work: () -> T) -> T {
    isSelf ? DispatchQueue.main.sync(execute: work) : work()
  }

  func execute(_ step: JSON) -> JSON {
    let action = step["action"] as? String ?? ""
    let args = step["args"] as? JSON ?? [:]
    let target = step["target"] as? JSON
    let attrs = target?["attrs"] as? [String: String]
    let timeout = Double(step["timeout_ms"] as? Int ?? 10_000) / 1000
    guard let bundle = (args["app"] as? String) ?? attrs?["app"], !bundle.isEmpty else {
      return fail("the step does not say which app")
    }
    let isSelf = bundle == Bundle.main.bundleIdentifier
    if !isSelf && !AXIsProcessTrusted() {
      return fail(
        "Task Player may not use other apps yet: right-click the floating button and choose Allow Mac apps "
          + "(System Settings > Privacy & Security > Accessibility)")
    }
    guard let pid = running(bundle) ?? launch(bundle, timeout: timeout) else {
      return fail("\(bundle) is not installed, or did not start")
    }
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 2)
    if !isSelf { AX.exposeControls(of: pid) }

    switch action {
    case "open":
      return isSelf || bringForward(app, pid: pid, timeout: timeout)
        ? ["ok": true] : fail("\(bundle) did not come forward")
    case "menu":
      if !isSelf { _ = bringForward(app, pid: pid, timeout: timeout) }
      return onTarget(isSelf) { menu(args["path"] as? [String] ?? [], in: app) }
    case "key":
      if !isSelf { _ = bringForward(app, pid: pid, timeout: timeout) }
      return key(args["key"] as? String ?? "", modifiers: args["modifiers"] as? [String] ?? [], pid: pid)
    case "press", "set_value", "focus":
      guard let target else { return fail("the step has no target") }
      var last = StepError("not found")
      let deadline = Date().addingTimeInterval(timeout)
      repeat {
        switch AX.find(target, in: app) {
        case .success(let match):
          let error = onTarget(isSelf) { act(action, on: match.element, args: args, isSelf: isSelf) }
          var out: JSON = ["ok": error == nil, "matchScore": (match.score * 100).rounded() / 100, "matchedBy": match.matchedBy]
          if let error { out["error"] = error }
          return out
        case .failure(let error):
          last = error
          Thread.sleep(forTimeInterval: 0.25)
        }
      } while Date() < deadline
      return fail(last.message)
    default:
      return fail("ax.\(action) is not supported")
    }
  }

  // MARK: acting

  private func act(_ action: String, on el: AXUIElement, args: JSON, isSelf: Bool) -> String? {
    switch action {
    case "focus":
      return AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success
        ? nil : "could not focus the control"
    case "set_value":
      let text = args["text"] as? String ?? ""
      AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
      var settable: DarwinBoolean = false
      AXUIElementIsAttributeSettable(el, kAXValueAttribute as CFString, &settable)
      if settable.boolValue,
        AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, text as CFString) == .success
      {
        // Apps commit a field's value when it is confirmed (as when you press Tab or click away).
        if AX.actions(el).contains(kAXConfirmAction) { AXUIElementPerformAction(el, kAXConfirmAction as CFString) }
        return nil
      }
      // Fields that take no value from outside get it typed: select all, then the text.
      guard !isSelf else { return "the field takes no value" }
      let pid = AX.pid(el)
      post(key: "a", modifiers: ["cmd"], pid: pid)
      type(text, pid: pid)
      return nil
    default:  // press
      let available = AX.actions(el)
      if args["button"] as? String == "right" {
        return AXUIElementPerformAction(el, kAXShowMenuAction as CFString) == .success ? nil : "no context menu here"
      }
      for name in [kAXPressAction, kAXConfirmAction, kAXPickAction, "AXOpen"] where available.contains(name) {
        if AXUIElementPerformAction(el, name as CFString) == .success { return nil }
      }
      // A row or cell with no action: select it, as a click would.
      var settable: DarwinBoolean = false
      AXUIElementIsAttributeSettable(el, kAXSelectedAttribute as CFString, &settable)
      if settable.boolValue,
        AXUIElementSetAttributeValue(el, kAXSelectedAttribute as CFString, kCFBooleanTrue) == .success
      {
        return nil
      }
      // Last resort: a click where the control is now (not where it was when you recorded).
      guard !isSelf, let frame = AX.frame(el) else {
        return "the control has no action to press (it offers: \(available.joined(separator: ", ")))"
      }
      click(at: CGPoint(x: frame.midX, y: frame.midY))
      return nil
    }
  }

  private func menu(_ path: [String], in app: AXUIElement) -> JSON {
    guard let first = path.first else { return fail("the menu step has no path") }
    if let item = AX.menuItem(path, in: app) {
      return AXUIElementPerformAction(item, kAXPressAction as CFString) == .success
        ? ["ok": true] : fail("could not choose \(path.joined(separator: " > "))")
    }
    // Some apps fill a menu only when it opens: open the top one, look again, close it if the item is not there.
    if let top = AX.menuItem([first], in: app) {
      AXUIElementPerformAction(top, kAXPressAction as CFString)
      Thread.sleep(forTimeInterval: 0.3)
      if let item = AX.menuItem(path, in: app),
        AXUIElementPerformAction(item, kAXPressAction as CFString) == .success
      {
        return ["ok": true]
      }
      AXUIElementPerformAction(top, kAXCancelAction as CFString)
    }
    return fail("no menu item \(path.joined(separator: " > "))")
  }

  private func key(_ key: String, modifiers: [String], pid: pid_t) -> JSON {
    guard Player.keyCode(key) != nil else { return fail("unknown key \(key)") }
    post(key: key, modifiers: modifiers, pid: pid)
    return ["ok": true]
  }

  // MARK: apps

  private func running(_ bundle: String) -> pid_t? {
    NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first?.processIdentifier
  }

  private func launch(_ bundle: String, timeout: Double) -> pid_t? {
    guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle) else { return nil }
    let config = NSWorkspace.OpenConfiguration()
    config.activates = true
    NSWorkspace.shared.openApplication(at: url, configuration: config) { _, _ in }
    let deadline = Date().addingTimeInterval(max(timeout, 10))
    while Date() < deadline {
      if let pid = running(bundle) { return pid }
      Thread.sleep(forTimeInterval: 0.25)
    }
    return nil
  }

  // Through the Accessibility API (AXFrontmost): macOS lets a trusted background app bring another app forward.
  private func bringForward(_ app: AXUIElement, pid: pid_t, timeout: Double) -> Bool {
    let deadline = Date().addingTimeInterval(min(timeout, 5))
    repeat {
      if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { return true }
      AXUIElementSetAttributeValue(app, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
      Thread.sleep(forTimeInterval: 0.2)
    } while Date() < deadline
    return NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
  }

  // MARK: input events (only for keys, and for controls with no action of their own)

  private func post(key: String, modifiers: [String], pid: pid_t) {
    guard let code = Player.keyCode(key) else { return }
    var flags: CGEventFlags = []
    if modifiers.contains("cmd") { flags.insert(.maskCommand) }
    if modifiers.contains("shift") { flags.insert(.maskShift) }
    if modifiers.contains("option") { flags.insert(.maskAlternate) }
    if modifiers.contains("ctrl") { flags.insert(.maskControl) }
    for down in [true, false] {
      let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)
      event?.flags = flags
      event?.postToPid(pid)
    }
  }

  private func type(_ text: String, pid: pid_t) {
    let units = Array(text.utf16)
    for start in stride(from: 0, to: units.count, by: 20) {
      let chunk = Array(units[start..<min(start + 20, units.count)])
      for down in [true, false] {
        let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)
        chunk.withUnsafeBufferPointer {
          event?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: $0.baseAddress)
        }
        event?.postToPid(pid)
      }
    }
  }

  private func click(at point: CGPoint) {
    for type in [CGEventType.leftMouseDown, .leftMouseUp] {
      CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?
        .post(tap: .cghidEventTap)
    }
  }

  // US keyboard layout virtual key codes (Carbon kVK_*).
  static func keyCode(_ key: String) -> CGKeyCode? {
    let named: [String: CGKeyCode] = [
      "Return": 36, "Tab": 48, "Space": 49, "Delete": 51, "Escape": 53, "ForwardDelete": 117, "Home": 115,
      "End": 119, "PageUp": 116, "PageDown": 121, "Left": 123, "Right": 124, "Down": 125, "Up": 126,
    ]
    if let code = named[key] { return code }
    let chars: [Character: CGKeyCode] = [
      "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
      "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25,
      "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38,
      "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50, " ": 49,
    ]
    guard key.count == 1, let c = key.lowercased().first else { return nil }
    return chars[c]
  }
}
