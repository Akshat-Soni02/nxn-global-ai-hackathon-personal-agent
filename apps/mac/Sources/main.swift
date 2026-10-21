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
//            --transcribe <audio>   turn narration into text on the Mac, and exit (Voice.swift)
//            --icon <dir>      draw the app icon's PNGs into a folder, for iconutil, and exit (Icon.swift)
//            --capabilities    print which of the modes above this build has, and exit
//            --first-run       show the setup window (shown by itself the first time the packaged app runs)
//            --log <file>      append diagnostics to a file (an app started by `open` has no terminal)
import AppKit
import ApplicationServices
import AVFoundation

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

// The Edit menu: ⌘X, ⌘C, ⌘V, ⌘A and ⌘Z reach the window's web view only through the app's main menu. Shadow has no
// menu bar of its own (it lives in the status bar), so without this, pasting an answer into a question or copying
// anything from the window did nothing. The menu is never shown; only its key equivalents are used.
func editMenu() -> NSMenu {
  let main = NSMenu()
  let appItem = NSMenuItem()
  appItem.submenu = NSMenu(title: "Shadow")
  main.addItem(appItem)
  let edit = NSMenu(title: "Edit")
  edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
  let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
  redo.keyEquivalentModifierMask = [.command, .shift]
  edit.addItem(.separator())
  edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
  edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
  edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
  edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
  let editItem = NSMenuItem()
  editItem.submenu = edit
  main.addItem(editItem)
  return main
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
  let voice = Voice()
  var trusted = AXIsProcessTrusted()
  var everConnected = false
  // The daemon's API over the socket (api.call): replies by request id.
  private var calls: [String: (JSON) -> Void] = [:]

  func applicationDidFinishLaunching(_ notification: Notification) {
    // The menu bar item, the window and notifications: not in the fixture's test mode.
    if !arguments.contains("--fixture") {
      NSApp.mainMenu = editMenu()
      let menu = StatusMenu()
      menu.onOpen = { [weak self] route in self?.window.show(route: route) }
      menu.onRecord = { [weak self] in self?.press() }
      menu.onQuit = { NSApp.terminate(nil) }
      menu.onStartDaemon = { DaemonControl.kickstart() }
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
    panel.onDiscard = { [weak self] in self?.discard() }
    panel.onAllow = { [weak self] in self?.askForAccessibility() }
    panel.onQuit = { NSApp.terminate(nil) }
    link.onState = { [weak self] up in self?.connection(up) }
    link.onMessage = { [weak self] message in self?.handle(message) }
    link.start()
    // The Mac going to sleep or waking up: the daemon looks at its triggers on wake, and a step that timed out
    // across the sleep is tried once more.
    let center = NSWorkspace.shared.notificationCenter
    center.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
      self?.link.send(["id": UUID().uuidString, "type": "system.sleep"])
    }
    center.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
      self?.link.send(["id": UUID().uuidString, "type": "system.wake"])
    }
    if arguments.contains("--fixture"), let state = argument("--state") {
      recorder.recordSelf = true
      fixture = Fixture(recorder: recorder, statePath: state, log: log)
    }
    // Accessibility can be allowed (or taken away) in System Settings at any time.
    Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.checkTrust() }
    // Started but never reached the daemon, and nothing (launchd) to start it: nothing to be the button of.
    DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in
      if self?.everConnected == false && !DaemonControl.installed { NSApp.terminate(nil) }
    }
    // With the daemon registered with launchd (pnpm setup:daemon, or the packaged app), the app outlives it: it
    // asks launchd to start it again whenever it is not there.
    Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
      guard let self, !self.connected, DaemonControl.installed else { return }
      log("the daemon is not running: asking launchd to start it")
      DaemonControl.kickstart()
    }
    log("Shadow.app started, socket \(socketPath), Accessibility \(trusted ? "allowed" : "not allowed")")
    // The packaged app owns its daemon: register the LaunchAgent inside the bundle (launchd starts the daemon now
    // and at every login), then walk a new user through the setup once.
    if packaged && !arguments.contains("--fixture") {
      if !SMAppServiceBridge.registered, let problem = SMAppServiceBridge.register() {
        log("could not register the daemon with launchd: \(problem)")
      }
      if !UserDefaults.standard.bool(forKey: "firstRunDone") { showFirstRun() }
    }
    if arguments.contains("--first-run") { showFirstRun() }
  }

  private var connected = false
  private var healthTimer: Timer?

  private func connection(_ up: Bool) {
    connected = up
    statusMenu?.daemonUp = up
    firstRun?.model.daemonUp = up
    if up {
      everConnected = true
      link.send(["id": UUID().uuidString, "type": "hello", "from": "mac", "version": "0.0.0", "trusted": trusted])
      panel.refresh()
      log("connected to the daemon")
      if statusMenu != nil {
        // Runs, steps and inbox changes from now on; what waits already, and how things are.
        link.send(["id": UUID().uuidString, "type": "api.subscribe"])
        refreshInbox()
        refreshHealth()
        healthTimer?.invalidate()
        healthTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
          self?.refreshHealth()
        }
      }
    } else if everConnected {
      recorder.stop()
      panel.stopped()
      if DaemonControl.installed {
        // launchd starts it again (KeepAlive); the link keeps trying to connect, and the timer above nudges launchd.
        log("the daemon went away: waiting for launchd to start it again")
        panel.refused("Shadow's daemon stopped: starting it again")
        DaemonControl.kickstart()
      } else {
        log("the daemon went away: quitting")
        NSApp.terminate(nil)
      }
    }
  }

  private func handle(_ message: JSON) {
    switch message["type"] as? String {
    case "record.start":
      sessionId = message["sessionId"] as? String
      recordingDir = message["dir"] as? String
      screenConsent = (message["consent"] as? JSON)?["screen"] as? Bool ?? false
      // Narration, when the form allowed the microphone; only once per recording (record.start comes again to a
      // connection that joins late).
      if (message["consent"] as? JSON)?["microphone"] as? Bool == true, let dir = recordingDir,
        !FileManager.default.fileExists(atPath: (dir as NSString).appendingPathComponent("voice.json"))
      {
        voice.start(dir: dir)
      }
      let started = (message["startedAt"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
      // Ask for Screen Recording now, before anything is recorded: asked later, its prompt and System Settings became
      // steps of the task (reports/oct19-two-recordings.md, B).
      if screenConsent && !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
      recorder.start()
      panel.recording(
        since: started, mic: (message["consent"] as? JSON)?["microphone"] as? Bool ?? false, screen: screenConsent)
    case "record.stop":
      recorder.stop()  // flushes the field being typed into, while the session id is still known
      sessionId = nil
      recordingDir = nil
      screenConsent = false
      voice.stop()
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
    case "mac.screenshot":
      // The repair agent's describe_screen: a picture of the frontmost app's window, saved where the daemon says.
      // The daemon masks it before anything else sees it. Needs Screen Recording for Shadow.
      guard let path = message["path"] as? String else { return }
      let shotId = message["id"] as? String ?? ""
      guard let front = NSWorkspace.shared.frontmostApplication,
        front.processIdentifier != ProcessInfo.processInfo.processIdentifier
      else {
        link.send(["id": shotId, "type": "mac.screenshot_result", "ok": false, "error": "no app window in front"])
        return
      }
      Screen.captureWindow(pid: front.processIdentifier, to: path) { [weak self] ok in
        DispatchQueue.main.async {
          var reply: JSON = ["id": shotId, "type": "mac.screenshot_result", "ok": ok]
          if !ok { reply["error"] = "no window, or Screen Recording isn't allowed for Shadow" }
          self?.link.send(reply)
        }
      }
    case "ax.highlight":
      // A walk-through: outline the control an ax step would act on (Highlight.swift), acting on nothing.
      guard let target = message["target"] as? JSON else { return }
      let id = message["id"] as? String ?? ""
      player.highlight(target) { [weak self] result in
        var reply = result
        reply["id"] = id
        reply["type"] = "ax.highlight_result"
        self?.link.send(reply)
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
    apiCall(method, params) { value, _ in done(value) }
  }

  // The same, with the daemon's reason when the call failed.
  private func apiCall(_ method: String, _ params: JSON = [:], done: @escaping (Any?, String?) -> Void) {
    let id = UUID().uuidString
    calls[id] = { reply in
      if reply["ok"] as? Bool == true { done(reply["value"], nil) } else { done(nil, reply["error"] as? String ?? "failed") }
    }
    link.send(["id": id, "type": "api.call", "method": method, "params": params])
  }

  // MARK: first run (FirstRun.swift)

  private var firstRun: FirstRunWindow?

  // The packaged app: the daemon lives inside it (Resources/daemon.js).
  private var packaged: Bool { Bundle.main.url(forResource: "daemon", withExtension: "js") != nil }

  private func showFirstRun() {
    let win = firstRun ?? FirstRunWindow()
    firstRun = win
    let model = win.model
    model.daemonUp = connected
    model.extensionFolder = packaged
      ? Bundle.main.resourceURL?.appendingPathComponent("extension").path ?? ""
      : (Bundle.main.bundlePath as NSString).deletingLastPathComponent + "/../../extension/dist"
    win.show(
      FirstRunView(
        model: model,
        onSaveKey: { [weak self] key in
          model.checking = true
          model.keyStatus = "Storing the key in your Keychain…"
          self?.apiCall("setApiKey", ["key": key]) { _, error in
            if let error {
              model.checking = false
              model.keyOk = false
              model.keyStatus = error
              return
            }
            model.keyStatus = "Checking the connection to Nemotron…"
            self?.apiCall("checkModel") { value, error in
              model.checking = false
              let check = value as? JSON
              model.keyOk = check?["ok"] as? Bool == true
              if model.keyOk {
                let n = check?["reachable"] as? Int ?? 0
                model.keyStatus = "Connected to Nemotron: \(n) models reachable."
              } else {
                model.keyStatus = "Not connected: \(check?["error"] as? String ?? error ?? "the model did not answer")"
              }
            }
          }
        },
        onSetupChrome: { [weak self] in
          self?.apiCall("setupChrome") { value, error in
            model.chromeOk = error == nil
            model.chromeStatus = error ?? "Chrome can reach Shadow. Now load the extension (the folder is shown)."
            if error == nil, let chrome = (value as? JSON)?["chrome"] as? JSON, let path = chrome["manifest"] as? String {
              log("wrote Chrome's connection file: \(path)")
            }
          }
          self?.showExtensionFolder()
        },
        onShowExtension: { [weak self] in self?.showExtensionFolder() },
        onAccessibility: { [weak self] in
          self?.askForAccessibility()
          DispatchQueue.main.asyncAfter(deadline: .now() + 3) { model.accessibility = AXIsProcessTrusted() }
        },
        onScreenRecording: {
          model.screenRecording = CGRequestScreenCaptureAccess()
          DispatchQueue.main.asyncAfter(deadline: .now() + 3) { model.screenRecording = CGPreflightScreenCaptureAccess() }
        },
        onMicrophone: {
          AVCaptureDevice.requestAccess(for: .audio) { granted in DispatchQueue.main.async { model.microphone = granted } }
        },
        onDone: { [weak self] in
          UserDefaults.standard.set(true, forKey: "firstRunDone")
          win.close()
          self?.window.show(route: "/workflows")
        }))
  }

  private func showExtensionFolder() {
    let folder = firstRun?.model.extensionFolder ?? ""
    guard !folder.isEmpty else { return }
    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: folder)])
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

  // The trash on the pill: the recording ends and everything it captured is deleted; nothing is compiled.
  private func discard() {
    link.send(["id": UUID().uuidString, "type": "record.command", "command": "discard"])
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

// The daemon's LaunchAgent (docs/design.md, "Who starts what"): installed by pnpm setup:daemon, or registered by the
// packaged app. When it is there, launchd owns the daemon's life: Shadow.app only nudges it.
enum DaemonControl {
  static let label = "com.shadow.daemon"
  static var installed: Bool {
    FileManager.default.fileExists(atPath: NSHomeDirectory() + "/Library/LaunchAgents/\(label).plist")
      || SMAppServiceBridge.registered
  }
  static func kickstart() {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    task.arguments = ["kickstart", "gui/\(getuid())/\(label)"]
    task.standardOutput = FileHandle.nullDevice
    task.standardError = FileHandle.nullDevice
    try? task.run()
  }
}

// What this build's command-line modes can do. The daemon finds this line in the binary rather than running it
// (apps/daemon/src/mac-binary.ts): a build too old to know --capabilities would start the whole app instead. Keep it
// longer than 15 bytes: Swift keeps shorter strings inside the machine code, where a search of the file can't see them.
let capabilities = "shadow-capabilities: ocr redact transcribe"
if arguments.contains("--capabilities") {
  print(capabilities)
  exit(0)
}
if Screen.runCommand(arguments) { exit(0) }
if Icon.runCommand(arguments) { exit(0) }
Voice.runCommand(arguments)

if let dir = argument("--snapshot") {
  _ = NSApplication.shared
  MainActor.assumeIsolated { Panel().snapshots(to: dir) }
  exit(0)
}

let app = NSApplication.shared
let delegate = AppMain()
app.delegate = delegate
app.setActivationPolicy(.accessory)  // no Dock icon, no menu bar of its own: just the floating button
app.run()
