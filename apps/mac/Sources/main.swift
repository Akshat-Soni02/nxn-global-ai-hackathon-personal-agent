// Task Player.app: the desktop side of Task Player. The daemon launches it (`open`, so macOS treats it as its own app
// and asks permission for it by name, not for your terminal) and it connects back over the daemon's socket.
// It is three things:
//   - the floating Record / Stop button, above every app (Panel.swift);
//   - the Mac-app recorder, through the Accessibility API (Recorder.swift);
//   - the ax channel: replays Mac-app steps (Player.swift).
// It quits when the daemon goes away; the daemon starts it again.
// Arguments: --socket <path>   the daemon's socket (default ~/Library/Application Support/TaskPlayer/daemon.sock)
//            --fixture --state <file>   test mode: a timesheet window inside the app and a scripted user (Fixture.swift)
//            --snapshot <dir>  draw each look of the button to PNG files and exit
//            --log <file>      append diagnostics to a file (an app started by `open` has no terminal)
import AppKit
import ApplicationServices

let arguments = CommandLine.arguments
func argument(_ name: String) -> String? {
  guard let i = arguments.firstIndex(of: name), i + 1 < arguments.count else { return nil }
  return arguments[i + 1]
}
let socketPath =
  argument("--socket") ?? (NSHomeDirectory() + "/Library/Application Support/TaskPlayer/daemon.sock")
let logPath = argument("--log")

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
  var fixture: Fixture?
  var sessionId: String?
  var trusted = AXIsProcessTrusted()
  var everConnected = false

  func applicationDidFinishLaunching(_ notification: Notification) {
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
    log("Task Player.app started, socket \(socketPath), Accessibility \(trusted ? "allowed" : "not allowed")")
  }

  private func connection(_ up: Bool) {
    if up {
      everConnected = true
      link.send(["id": UUID().uuidString, "type": "hello", "from": "mac", "version": "0.0.0", "trusted": trusted])
      panel.show()
      log("connected to the daemon")
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
      let started = (message["startedAt"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
      recorder.start()
      panel.recording(since: started)
    case "record.stop":
      recorder.stop()  // flushes the field being typed into, while the session id is still known
      sessionId = nil
      panel.stopped()
      fixture?.reset()
    case "record.status":
      if let phase = (message["phase"] as? String).flatMap(Panel.Phase.init(rawValue:)) {
        panel.status(phase, message["text"] as? String ?? "")
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
    default:
      break
    }
  }

  private func record(_ event: JSON) {
    guard let sessionId else { return }
    var message = event
    message["id"] = UUID().uuidString
    message["type"] = "record.event"
    message["sessionId"] = sessionId
    link.send(message)
  }

  private func press() {
    link.send(["id": UUID().uuidString, "type": "record.command", "command": panel.isRecording ? "stop" : "start"])
  }

  // macOS's own prompt, then the Accessibility pane of System Settings, where the switch for Task Player is.
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
