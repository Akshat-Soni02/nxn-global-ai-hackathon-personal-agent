// Shadow.app: the desktop side of Shadow. The daemon launches it (`open`, so macOS treats it as its own app
// and asks permission for it by name, not for your terminal) and it connects back over the daemon's socket.
// It is:
//   - the floating Record / Stop button, above every app (Panel.swift);
//   - Shadow in the menu bar: what waits for the user, health, Record (StatusMenu.swift);
//   - the window, the daemon's pages in a web view (Window.swift), and notifications for the inbox (Notifier.swift);
//   - the Mac-app recorder, through the Accessibility API (Recorder.swift);
//   - the ax channel: replays Mac-app steps (Player.swift).
// It quits when the daemon goes away; the daemon starts it again.
// Arguments: --socket <path>   the daemon's socket (default ~/Library/Application Support/Shadow/daemon.sock)
//            --api <file>      the daemon's api.json (HTTP port and token), for the window (default: next to the socket)
//            --fixture --state <file>   test mode: a timesheet window inside the app and a scripted user (Fixture.swift)
//            --snapshot <dir>  draw each look of the button to PNG files and exit
//            --ocr <image> | --redact <image> <boxes.json>   read or black out text in a picture, and exit (Screen.swift)
//            --log <file>      append diagnostics to a file (an app started by `open` has no terminal)
import AppKit
import ApplicationServices

let arguments = CommandLine.arguments
func argument(_ name: String) -> String? {
  guard let i = arguments.firstIndex(of: name), i + 1 < arguments.count else { return nil }
  return arguments[i + 1]
}
let socketPath =
  argument("--socket") ?? (NSHomeDirectory() + "/Library/Application Support/Shadow/daemon.sock")
let logPath = argument("--log")
// Where the daemon writes its HTTP API's port and token, for the window. The daemon passes it; by default it sits
// next to the socket, in the data folder.
let apiInfoPath =
  argument("--api") ?? ((socketPath as NSString).deletingLastPathComponent as NSString).appendingPathComponent("api.json")

func log(_ line: String) {
  guard let logPath else { return NSLog("%@", line) }
  let stamped = "\(ISO8601DateFormatter().string(from: Date())) \(line)\n"
  if let handle = FileHandle(forWritingAtPath: logPath) {
    handle.seekToEndOfFile()
    handle.write(Data(stamped.utf8))
    handle.closeFile()
  } else {
    try? stamped.write(toFile: logPath, atomically: true, encoding: .utf8)
  }
}

final class AppMain: NSObject, NSApplicationDelegate {
  let link = Link(path: socketPath)
  let panel = Panel()
  let recorder = Recorder()
  let player = Player()
  let window = AppWindow(infoPath: apiInfoPath)
  var statusMenu: StatusMenu?
  let notifier = Notifier()
  var fixture: Fixture?
  var sessionId: String?
  // The recording's folder and whether the form allowed screenshots (record.start).
  var recordingDir: String?
  var screenConsent = false
  var lastShot = Date.distantPast
  var trusted = AXIsProcessTrusted()
  var everConnected = false
  // The daemon's API over the socket (api.call): replies by request id.
  private var calls: [String: (JSON) -> Void] = [:]

  func applicationDidFinishLaunching(_ notification: Notification) {
    // The menu bar item, the window and notifications: not in the fixture's test mode.
    if !arguments.contains("--fixture") {
      let menu = StatusMenu()
      menu.onOpen = { [weak self] route in self?.window.show(route: route) }
      menu.onRecord = { [weak self] in self?.press() }
      menu.onQuit = { NSApp.terminate(nil) }
      menu.isRecording = { [weak self] in self?.panel.isRecording ?? false }
      statusMenu = menu
      notifier.onOpen = { [weak self] route in self?.window.show(route: route) }
      notifier.start()
      panel.onOpen = { [weak self] in self?.window.show() }
    }
    recorder.emit = { [weak self] event in self?.record(event) }
    recorder.onFolder = { [weak self] path in
      self?.link.send(["id": UUID().uuidString, "type": "watch.folder", "path": path])
      log("Finder shows \(path): asked the daemon to watch it")
    }
    panel.trusted = trusted
    panel.onPress = { [weak self] in self?.press() }
    panel.onAllow = { [weak self] in self?.askForAccessibility() }
    panel.onQuit = { NSApp.terminate(nil) }
    link.onState = { [weak self] up in self?.connection(up) }
    link.onMessage = { [weak self] message in self?.handle(message) }
    link.start()
    if arguments.contains("--fixture"), let state = argument("--state") {
      recorder.recordSelf = true
      fixture = Fixture(recorder: recorder, statePath: state, log: log)
    }
    // Accessibility can be allowed (or taken away) in System Settings at any time.
    Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.checkTrust() }
    // Started but never reached the daemon: nothing to be the button of.
    DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in
      if self?.everConnected == false { NSApp.terminate(nil) }
    }
    log("Shadow.app started, socket \(socketPath), Accessibility \(trusted ? "allowed" : "not allowed")")
  }

  private func connection(_ up: Bool) {
    if up {
      everConnected = true
      link.send(["id": UUID().uuidString, "type": "hello", "from": "mac", "version": "0.0.0", "trusted": trusted])
      panel.show()
      log("connected to the daemon")
      if statusMenu != nil {
        // Runs, steps and inbox changes from now on; what waits already, and how things are.
        link.send(["id": UUID().uuidString, "type": "api.subscribe"])
        refreshInbox()
        refreshHealth()
        Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in self?.refreshHealth() }
      }
    } else if everConnected {
      recorder.stop()
      log("the daemon went away: quitting")
      NSApp.terminate(nil)
    }
  }

  private func handle(_ message: JSON) {
    switch message["type"] as? String {
    case "record.start":
      sessionId = message["sessionId"] as? String
      recordingDir = message["dir"] as? String
      screenConsent = (message["consent"] as? JSON)?["screen"] as? Bool ?? false
      let started = (message["startedAt"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
      recorder.start()
      panel.recording(since: started)
    case "record.stop":
      recorder.stop()  // flushes the field being typed into, while the session id is still known
      sessionId = nil
      recordingDir = nil
      screenConsent = false
      panel.stopped()
      fixture?.reset()
    case "record.status":
      if let phase = (message["phase"] as? String).flatMap(Panel.Phase.init(rawValue:)) {
        panel.status(phase, message["text"] as? String ?? "")
        // Record was pressed (here, in Chrome or in the menu bar): the description form comes first.
        if phase == .form { window.show(route: "/record") }
      }
    case "run.step":
      guard let step = message["step"] as? JSON else { return }
      let id = message["id"] as? String ?? ""
      let runId = message["runId"] as? String ?? ""
      player.run(step) { [weak self] result in
        var reply = result
        reply["id"] = id
        reply["type"] = "run.step_result"
        reply["runId"] = runId
        reply["stepId"] = step["id"] as? String ?? ""
        self?.link.send(reply)
        let outcome = result["ok"] as? Bool == true ? "ok" : (result["error"] as? String ?? "failed")
        log("ran \(step["id"] as? String ?? "?") \(step["action"] as? String ?? "?"): \(outcome)")
      }
    case "api.result":
      if let id = message["id"] as? String { calls.removeValue(forKey: id)?(message) }
    case "api.event":
      guard let event = message["event"] as? JSON, event["type"] as? String == "inbox",
        let item = event["item"] as? JSON, let id = item["id"] as? String
      else { return }
      if item["answeredAt"] == nil || item["answeredAt"] is NSNull {
        notifier.notify(item)
      } else {
        notifier.clear(id)
      }
      refreshInbox()
    default:
      break
    }
  }

  // One call to the daemon's API (apps/daemon/src/api.ts); `done` gets the value, or nil when it failed.
  private func api(_ method: String, _ params: JSON = [:], done: @escaping (Any?) -> Void) {
    let id = UUID().uuidString
    calls[id] = { reply in done(reply["ok"] as? Bool == true ? reply["value"] : nil) }
    link.send(["id": id, "type": "api.call", "method": method, "params": params])
  }

  private func refreshInbox() {
    api("inbox", ["open": true]) { [weak self] value in
      self?.statusMenu?.waiting = (value as? [Any])?.count ?? 0
    }
  }

  private func refreshHealth() {
    api("health") { [weak self] value in
      if let health = value as? JSON { self?.statusMenu?.health = health }
    }
    api("usage") { [weak self] value in
      self?.statusMenu?.todayUsd = (value as? JSON)?["todayUsd"] as? Double ?? 0
    }
  }

  private func record(_ event: JSON) {
    guard let sessionId else { return }
    var message = event
    message["id"] = UUID().uuidString
    message["type"] = "record.event"
    message["sessionId"] = sessionId
    link.send(message)
    shoot(after: message)
  }

  // A picture of the window the user just acted in, when the form allowed it (Screen Recording permission). Saved in
  // the recording's folder; the daemon reads its words, masks them and blacks out what it masked (screen.ts).
  // Never over a password field, at most one every 0.7 s, and never Shadow's own windows.
  private func shoot(after message: JSON) {
    guard screenConsent, let dir = recordingDir, let sessionId else { return }
    let element = message["element"] as? JSON
    if message["secret"] as? Bool == true || element?["role"] as? String == "AXSecureTextField"
      || element?["subrole"] as? String == "AXSecureTextField"
    {
      return
    }
    guard Date().timeIntervalSince(lastShot) > 0.7, let app = NSWorkspace.shared.frontmostApplication,
      app.processIdentifier != ProcessInfo.processInfo.processIdentifier
    else { return }
    lastShot = Date()
    let eventId = message["id"] as? String ?? UUID().uuidString
    let shots = (dir as NSString).appendingPathComponent("shots")
    try? FileManager.default.createDirectory(
      atPath: shots, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let path = (shots as NSString).appendingPathComponent("\(eventId).jpg")
    let at = message["at"] as? Double ?? Date().timeIntervalSince1970 * 1000
    Screen.captureWindow(pid: app.processIdentifier, to: path) { [weak self] ok in
      DispatchQueue.main.async {
        guard ok else { return log("no screenshot: no window, or Screen Recording isn't allowed for Shadow") }
        self?.link.send([
          "id": UUID().uuidString, "type": "record.shot", "sessionId": sessionId, "eventId": eventId, "at": at,
          "path": path,
        ])
      }
    }
  }

  private func press() {
    link.send(["id": UUID().uuidString, "type": "record.command", "command": panel.isRecording ? "stop" : "start"])
  }

  // macOS's own prompt, then the Accessibility pane of System Settings, where the switch for Shadow is.
  private func askForAccessibility() {
    let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    _ = AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary)
    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
      NSWorkspace.shared.open(url)
    }
  }

  private func checkTrust() {
    let now = AXIsProcessTrusted()
    guard now != trusted else { return }
    trusted = now
    panel.trusted = now
    link.send(["id": UUID().uuidString, "type": "mac.trusted", "trusted": now])
    log("Accessibility \(now ? "allowed" : "turned off")")
    // Allowed in the middle of a recording: record Mac apps from now on.
    if sessionId != nil {
      recorder.stop()
      recorder.start()
    }
  }
}

if Screen.runCommand(arguments) { exit(0) }

if let dir = argument("--snapshot") {
  _ = NSApplication.shared
  Panel().snapshots(to: dir)
  exit(0)
}

let app = NSApplication.shared
let delegate = AppMain()
app.delegate = delegate
app.setActivationPolicy(.accessory)  // no Dock icon, no menu bar of its own: just the floating button
app.run()
