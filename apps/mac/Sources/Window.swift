// Shadow's window (docs/design.md, "The app"). Its pages are the daemon's (apps/ui, served at
// http://127.0.0.1:<port>/); api.json, written by the daemon and readable only by the user, says the port and token.
// The token goes in the URL's fragment, which the web view never sends to the server. The window holds no state: close
// it any time. While it is open the app shows in the Dock and the app switcher, like any window.
import AppKit
import WebKit

final class AppWindow: NSObject, NSWindowDelegate, WKNavigationDelegate {
  private let infoPath: String
  private var window: NSWindow?
  private var webView: WKWebView?
  private var loaded: (port: Int, token: String)?

  init(infoPath: String) {
    self.infoPath = infoPath
  }

  // Opens the window at a screen of its own ("/inbox", "/runs/<id>"); reuses it if it is already showing this daemon.
  func show(route: String = "/inbox") {
    guard let info = readInfo() else {
      log("can't open the window: no \(infoPath) (is the daemon running?)")
      return
    }
    let safe = String(route.filter { $0.isLetter || $0.isNumber || "/-_.:".contains($0) })
    let win = window ?? makeWindow()
    if let webView, let loaded, loaded == info {
      // The same daemon: go to the screen without loading again.
      webView.evaluateJavaScript("location.hash = '#\(safe)'")
    } else {
      var url = URLComponents()
      url.scheme = "http"
      url.host = "127.0.0.1"
      url.port = info.port
      url.path = "/"
      url.fragment = "token=\(info.token)&to=\(safe)"
      if let target = url.url { webView?.load(URLRequest(url: target)) }
      loaded = info
    }
    NSApp.setActivationPolicy(.regular)
    win.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  private func readInfo() -> (port: Int, token: String)? {
    guard let data = FileManager.default.contents(atPath: infoPath),
      let json = (try? JSONSerialization.jsonObject(with: data)) as? JSON,
      let port = json["port"] as? Int, let token = json["token"] as? String
    else { return nil }
    return (port, token)
  }

  private func makeWindow() -> NSWindow {
    let config = WKWebViewConfiguration()
    let web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    if #available(macOS 13.3, *) { web.isInspectable = true }  // Safari's Web Inspector, for development
    let win = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720),
      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    win.title = "Shadow"
    win.minSize = NSSize(width: 760, height: 480)
    win.contentView = web
    win.isReleasedWhenClosed = false
    win.delegate = self
    win.center()
    win.setFrameAutosaveName("ShadowWindow")
    window = win
    webView = web
    return win
  }

  func windowWillClose(_ notification: Notification) {
    // Back to a menu bar app: no Dock icon while the window is closed.
    NSApp.setActivationPolicy(.accessory)
  }

  // Only the daemon's own pages load in the window; any other link opens in the user's browser.
  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = action.request.url else { return decisionHandler(.cancel) }
    if url.host == "127.0.0.1", url.port == loaded?.port { return decisionHandler(.allow) }
    if url.scheme == "http" || url.scheme == "https" { NSWorkspace.shared.open(url) }
    decisionHandler(.cancel)
  }
}
