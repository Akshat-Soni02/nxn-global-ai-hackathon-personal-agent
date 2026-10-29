// First run (docs/design.md, "Deployment", first run): the one window a new user sees before anything else. Three
// short steps, each a button that does the thing and says what happened: signing in to Shadow (the browser opens
// Shadow's sign-in page; then a connection check against Nemotron), Chrome (the connection file, and the extension
// folder to load), and the macOS permissions (Accessibility, Screen Recording, Microphone). A build without Shadow's
// service (SHADOW_API_URL unset) asks for a Token Factory key instead, as before Oct 25. Nothing here talks to the
// model itself: every button is a call to the daemon's API (main.swift), which holds the sign-in and makes the calls.
import AVFoundation
import AppKit
import SwiftUI

final class FirstRunModel: ObservableObject {
  @Published var daemonUp = false
  @Published var keyStatus = ""
  @Published var keyOk = false
  @Published var checking = false
  // Shadow's service is configured: step 1 is Sign in, not a key.
  @Published var managed = false
  // While signing in: the code the browser page shows.
  @Published var signInCode = ""
  @Published var chromeStatus = ""
  @Published var chromeOk = false
  @Published var accessibility = AXIsProcessTrusted()
  @Published var screenRecording = CGPreflightScreenCaptureAccess()
  @Published var microphone = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
  var extensionFolder = ""
}

struct FirstRunView: View {
  @ObservedObject var model: FirstRunModel
  @State private var key = ""
  var onSignIn: () -> Void = {}
  var onSaveKey: (String) -> Void = { _ in }
  var onSetupChrome: () -> Void = {}
  var onShowExtension: () -> Void = {}
  var onAccessibility: () -> Void = {}
  var onScreenRecording: () -> Void = {}
  var onMicrophone: () -> Void = {}
  var onDone: () -> Void = {}

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Welcome to Shadow").font(.system(size: 22, weight: .semibold))
        Text("Show it a task once. It does it for you from then on, on your Mac.")
          .foregroundStyle(.secondary)
      }

      if model.managed {
        step(1, "Sign in to Shadow", done: model.keyOk) {
          Text(
            "Your browser opens Shadow's sign-in page (Google or email). No API key needed; your recordings and workflows stay on this Mac."
          )
          .font(.callout).foregroundStyle(.secondary)
          HStack {
            Button(model.checking ? "Waiting for the browser…" : "Sign in") { onSignIn() }
              .disabled(model.checking || model.keyOk || !model.daemonUp)
              .keyboardShortcut(.defaultAction)
            if !model.signInCode.isEmpty && !model.keyOk {
              Text("The page shows \(model.signInCode)").font(.system(.callout, design: .monospaced))
            }
          }
          if !model.daemonUp { Text("Starting Shadow's daemon…").font(.callout).foregroundStyle(.secondary) }
          if !model.keyStatus.isEmpty {
            Text(model.keyStatus).font(.callout).foregroundStyle(model.keyOk ? .green : .secondary)
          }
        }
      } else {
        step(1, "Your Nebius Token Factory key", done: model.keyOk) {
          Text(
            "Made at tokenfactory.nebius.com. It is stored in your Keychain and never leaves this Mac except to call the model."
          )
          .font(.callout).foregroundStyle(.secondary)
          HStack {
            SecureField("Paste the key", text: $key).textFieldStyle(.roundedBorder).frame(maxWidth: 360)
            Button(model.checking ? "Checking…" : "Save and check") { onSaveKey(key) }
              .disabled(key.trimmingCharacters(in: .whitespaces).isEmpty || model.checking || !model.daemonUp)
              .keyboardShortcut(.defaultAction)
          }
          if !model.daemonUp { Text("Starting Shadow's daemon…").font(.callout).foregroundStyle(.secondary) }
          if !model.keyStatus.isEmpty {
            Text(model.keyStatus).font(.callout).foregroundStyle(model.keyOk ? .green : .red)
          }
        }
      }

      step(2, "Chrome", done: model.chromeOk) {
        Text("Shadow records and replays web tasks through a small Chrome extension in your own, logged-in Chrome.")
          .font(.callout).foregroundStyle(.secondary)
        HStack {
          Button("Connect Chrome") { onSetupChrome() }.disabled(!model.daemonUp)
          Button("Show the extension folder") { onShowExtension() }
        }
        Text(
          "Then in Chrome: chrome://extensions → Developer mode → Load unpacked → that folder → Allow access to file URLs."
        )
        .font(.callout).foregroundStyle(.secondary)
        if !model.chromeStatus.isEmpty {
          Text(model.chromeStatus).font(.callout).foregroundStyle(model.chromeOk ? .green : .red)
        }
      }

      step(3, "Permissions", done: model.accessibility) {
        Text("Each one only when you want that part. macOS asks by Shadow's name.").font(.callout)
          .foregroundStyle(.secondary)
        permission("Accessibility", "to record and replay Mac apps", on: model.accessibility, action: onAccessibility)
        permission(
          "Screen Recording", "for screenshots of Mac app windows while recording", on: model.screenRecording,
          action: onScreenRecording)
        permission("Microphone", "to narrate a task while recording", on: model.microphone, action: onMicrophone)
      }

      HStack {
        Spacer()
        Button("Later") { onDone() }.keyboardShortcut(.cancelAction)
        Button("Open Shadow") { onDone() }.buttonStyle(.borderedProminent).disabled(!model.keyOk)
      }
    }
    .padding(28)
    .frame(width: 640)
  }

  @ViewBuilder private func step<Content: View>(
    _ n: Int, _ title: String, done: Bool, @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        ZStack {
          Circle().fill(done ? Color.green.opacity(0.9) : Color.secondary.opacity(0.25)).frame(width: 22, height: 22)
          if done {
            Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
          } else {
            Text("\(n)").font(.system(size: 12, weight: .semibold))
          }
        }
        Text(title).font(.system(size: 15, weight: .semibold))
      }
      VStack(alignment: .leading, spacing: 8) { content() }.padding(.leading, 30)
    }
  }

  @ViewBuilder private func permission(_ name: String, _ why: String, on: Bool, action: @escaping () -> Void)
    -> some View
  {
    HStack {
      Image(systemName: on ? "checkmark.circle.fill" : "circle").foregroundStyle(on ? .green : .secondary)
      Text(name).fontWeight(.medium)
      Text(why).foregroundStyle(.secondary)
      Spacer()
      if !on { Button("Allow…") { action() } }
    }
    .font(.callout)
  }
}

// The window that holds it.
final class FirstRunWindow {
  let model = FirstRunModel()
  private var window: NSWindow?

  func show(_ view: FirstRunView) {
    let win = window ?? makeWindow()
    win.contentView = NSHostingView(rootView: view)
    NSApp.setActivationPolicy(.regular)
    win.center()
    win.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func close() {
    window?.orderOut(nil)
  }

  private func makeWindow() -> NSWindow {
    let win = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 640, height: 560), styleMask: [.titled, .closable],
      backing: .buffered, defer: false)
    win.title = "Set up Shadow"
    win.isReleasedWhenClosed = false
    window = win
    return win
  }
}
