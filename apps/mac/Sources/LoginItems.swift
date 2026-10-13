// The daemon as a login item (docs/design.md, "Who starts what"): the packaged app carries the daemon's LaunchAgent
// inside itself (Contents/Library/LaunchAgents/com.shadow.daemon.plist) and registers it with SMAppService, so
// launchd starts the daemon at login and again if it exits. In development, pnpm setup:daemon writes the same kind
// of file to ~/Library/LaunchAgents instead; DaemonControl (main.swift) looks at both.
import ServiceManagement

enum SMAppServiceBridge {
  static let plist = "com.shadow.daemon.plist"

  // Whether the app's own LaunchAgent is registered (the packaged app, after first run).
  static var registered: Bool {
    if #available(macOS 13.0, *) {
      return SMAppService.agent(plistName: plist).status == .enabled
    }
    return false
  }

  // Registers the app's LaunchAgent (and so starts the daemon). Only the packaged app has one; a development build
  // without the plist inside gets an error, which the caller shows.
  @discardableResult static func register() -> String? {
    if #available(macOS 13.0, *) {
      do {
        try SMAppService.agent(plistName: plist).register()
        return nil
      } catch {
        return error.localizedDescription
      }
    }
    return "needs macOS 13"
  }

  static func unregister() {
    if #available(macOS 13.0, *) {
      try? SMAppService.agent(plistName: plist).unregister()
    }
  }
}
