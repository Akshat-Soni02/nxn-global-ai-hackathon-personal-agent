// The macOS Accessibility API (ApplicationServices, AXUIElement): how Task Player reads and presses controls in other
// apps, the way VoiceOver does. Built into macOS; nothing to download. Using it on another app needs the user's
// permission (System Settings > Privacy & Security > Accessibility); an app may always use it on itself.
// Record (Recorder.swift) and replay (Player.swift) both go through `describe` and `find` here, so a control is
// found again by exactly the signals it was remembered by. Never by screen position.
import AppKit
import ApplicationServices

typealias JSON = [String: Any]

enum AX {
  static let systemWide = AXUIElementCreateSystemWide()

  // MARK: reading

  static func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success ? value : nil
  }

  static func string(_ el: AXUIElement, _ name: String) -> String? {
    guard let s = attr(el, name) as? String else { return nil }
    let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
    return t.isEmpty ? nil : String(t.prefix(200))
  }

  static func element(_ el: AXUIElement, _ name: String) -> AXUIElement? {
    guard let v = attr(el, name), CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
    return (v as! AXUIElement)
  }

  static func children(_ el: AXUIElement) -> [AXUIElement] {
    (attr(el, kAXChildrenAttribute) as? [AXUIElement]) ?? []
  }

  static func role(_ el: AXUIElement) -> String { string(el, kAXRoleAttribute) ?? "AXUnknown" }
  static func parent(_ el: AXUIElement) -> AXUIElement? { element(el, kAXParentAttribute) }

  static func pid(_ el: AXUIElement) -> pid_t {
    var pid: pid_t = 0
    AXUIElementGetPid(el, &pid)
    return pid
  }

  static func actions(_ el: AXUIElement) -> [String] {
    var names: CFArray?
    AXUIElementCopyActionNames(el, &names)
    return (names as? [String]) ?? []
  }

  // The control's own text: a button's title, an image's description.
  static func name(_ el: AXUIElement) -> String? {
    string(el, kAXTitleAttribute) ?? string(el, kAXDescriptionAttribute)
  }

  // Text of the element that labels this one (AXTitleUIElement), as a form label does on the web.
  static func label(_ el: AXUIElement) -> String? {
    guard let t = element(el, kAXTitleUIElementAttribute) else { return nil }
    return string(t, kAXValueAttribute) ?? string(t, kAXTitleAttribute)
  }

  static func frame(_ el: AXUIElement) -> CGRect? {
    guard let p = attr(el, kAXPositionAttribute), let s = attr(el, kAXSizeAttribute) else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    AXValueGetValue(p as! AXValue, .cgPoint, &point)
    AXValueGetValue(s as! AXValue, .cgSize, &size)
    return CGRect(origin: point, size: size)
  }

  static func app(pid: pid_t) -> (id: String, name: String)? {
    guard let app = NSRunningApplication(processIdentifier: pid), let id = app.bundleIdentifier else { return nil }
    return (id, app.localizedName ?? id)
  }

  // Electron apps (Slack, Notion, VS Code, Teams) build their controls for the Accessibility API only once an
  // assistive app asks with AXManualAccessibility. Other apps ignore the attribute.
  static func exposeControls(of pid: pid_t) {
    AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), "AXManualAccessibility" as CFString, kCFBooleanTrue)
  }

  // The folders Finder's windows show (AXDocument: a file URL), for watching folders outside the home folder, and
  // how many windows Finder has (some versions don't say a window's folder this way).
  static func finderFolders() -> (windows: Int, folders: [String]) {
    guard let finder = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder").first else {
      return (0, [])
    }
    let app = AXUIElementCreateApplication(finder.processIdentifier)
    let windows = (attr(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
    let folders = windows.compactMap { window in
      (attr(window, kAXDocumentAttribute) as? String).flatMap { URL(string: $0)?.path }
    }
    return (windows.count, folders)
  }

  // MARK: hit testing

  // NSEvent.mouseLocation counts from the bottom-left of the primary screen; AX counts from its top-left.
  static func axPoint(fromScreen p: NSPoint) -> CGPoint {
    let height = NSScreen.screens.first?.frame.height ?? 0
    return CGPoint(x: p.x, y: height - p.y)
  }

  static func hit(_ point: CGPoint, in root: AXUIElement = systemWide) -> AXUIElement? {
    var el: AXUIElement?
    return AXUIElementCopyElementAtPosition(root, Float(point.x), Float(point.y), &el) == .success ? el : nil
  }

  // What you meant to click: the nearest control around the text or image under the pointer.
  static let actionable: Set<String> = [
    "AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton", "AXMenuItem", "AXMenuBarItem",
    "AXTextField", "AXTextArea", "AXComboBox", "AXLink", "AXCell", "AXRow", "AXDisclosureTriangle", "AXSlider",
    "AXIncrementor", "AXColorWell", "AXDockItem",
  ]

  static func actionableAncestor(_ el: AXUIElement) -> AXUIElement {
    var node: AXUIElement? = el
    for _ in 0..<6 {
      guard let n = node else { break }
      if actionable.contains(role(n)) || actions(n).contains(kAXPressAction) { return n }
      node = parent(n)
    }
    return el
  }

  // MARK: describing (record)

  // The AxElement of the trace (packages/core/src/trace.ts).
  static func describe(_ el: AXUIElement) -> JSON {
    var d: [String: Any?] = ["role": role(el)]
    if let app = app(pid: pid(el)) {
      d["app"] = app.id
      d["appName"] = app.name
    } else {
      d["app"] = "unknown"
    }
    if let window = element(el, kAXWindowAttribute) { d["window"] = string(window, kAXTitleAttribute) }
    d["subrole"] = string(el, kAXSubroleAttribute)
    d["title"] = string(el, kAXTitleAttribute)
    d["description"] = string(el, kAXDescriptionAttribute)
    d["label"] = label(el)
    d["near"] = near(el)
    d["identifier"] = string(el, kAXIdentifierAttribute)
    d["placeholder"] = string(el, kAXPlaceholderValueAttribute)
    d["path"] = path(el)
    return d.compactMapValues { $0 }
  }

  // The nearest text before the control among its siblings (a form's "Hours" next to its field).
  static func near(_ el: AXUIElement) -> String? {
    var node = el
    for _ in 0..<2 {
      guard let p = parent(node) else { return nil }
      let kids = children(p)
      if let i = kids.firstIndex(where: { CFEqual($0, node) }) {
        for k in kids[..<i].reversed() where role(k) == "AXStaticText" {
          if let text = string(k, kAXValueAttribute) ?? string(k, kAXTitleAttribute) { return text }
        }
      }
      node = p
    }
    return nil
  }

  // From the window down: "AXWindow", "AXGroup", "AXTextField[1]" (the second text field among its siblings).
  static func path(_ el: AXUIElement) -> [String] {
    var out: [String] = []
    var node = el
    for _ in 0..<30 {
      let r = role(node)
      guard let p = parent(node), r != "AXWindow", r != "AXApplication" else {
        out.append(r)
        break
      }
      let same = children(p).filter { role($0) == r }
      if same.count > 1, let i = same.firstIndex(where: { CFEqual($0, node) }) {
        out.append("\(r)[\(i)]")
      } else {
        out.append(r)
      }
      node = p
    }
    return out.reversed()
  }

  // A menu item's titles from the menu bar down (["File", "Export As…"]), or nil when it is not in the menu bar
  // (a pop-up button's or a context menu's item, pressed by name instead).
  static func menuBarPath(_ item: AXUIElement) -> [String]? {
    var titles: [String] = []
    var node: AXUIElement? = item
    for _ in 0..<12 {
      guard let n = node else { return nil }
      let r = role(n)
      if r == "AXMenuItem" || r == "AXMenuBarItem", let t = string(n, kAXTitleAttribute) { titles.insert(t, at: 0) }
      if r == "AXMenuBar" { return titles }
      if r != "AXMenuItem" && r != "AXMenu" && r != "AXMenuBarItem" { return nil }
      node = parent(n)
    }
    return nil
  }

  // MARK: finding (replay)

  // Roles that are the same control to a person (a text field may become a combo box in the next version).
  static let roleGroups: [[String]] = [
    ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"],
    ["AXButton", "AXMenuButton"],
    ["AXRow", "AXCell", "AXOutlineRow"],
  ]

  static func sameRole(_ a: String, _ b: String) -> Bool {
    a == b || roleGroups.contains { $0.contains(a) && $0.contains(b) }
  }

  struct Match {
    let element: AXUIElement
    let score: Double
    let matchedBy: [String]
  }

  // Scores every element of the app's windows against the locator. Same rule as the web matcher: a clear winner
  // (score >= 0.5, 0.15 ahead of the next) or nothing, so a step never acts on a lookalike.
  static func find(_ locator: JSON, in app: AXUIElement) -> Result<Match, StepError> {
    guard let wantRole = locator["role"] as? String else { return .failure(StepError("the step has no target role")) }
    let attrs = locator["attrs"] as? [String: String] ?? [:]
    let wanted: [(name: String, weight: Double, want: String?, have: (AXUIElement) -> String?)] = [
      ("identifier", 0.35, attrs["identifier"], { string($0, kAXIdentifierAttribute) }),
      ("name", 0.30, locator["name"] as? String, { name($0) }),
      ("label", 0.15, locator["label"] as? String, { label($0) }),
      ("path", 0.10, attrs["path"], { path($0).joined(separator: " > ") }),
      ("near", 0.05, locator["near"] as? String, { near($0) }),
      ("placeholder", 0.05, attrs["placeholder"], { string($0, kAXPlaceholderValueAttribute) }),
      ("window", 0.05, attrs["window"], { element($0, kAXWindowAttribute).flatMap { string($0, kAXTitleAttribute) } }),
    ]
    let signals = wanted.filter { norm($0.want) != nil }
    let total = signals.reduce(0) { $0 + $1.weight }
    guard total > 0 else { return .failure(StepError("the target has nothing to recognise it by")) }

    var scored: [Match] = []
    var queue: [(AXUIElement, Int)] = ((attr(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []).map { ($0, 0) }
    var seen = 0
    while !queue.isEmpty, seen < 6000 {
      let (el, depth) = queue.removeFirst()
      seen += 1
      let r = role(el)
      if r == "AXMenuBar" { continue }
      if sameRole(r, wantRole) {
        var got = 0.0
        var by = ["role"]
        for s in signals where norm(s.have(el)) == norm(s.want) {
          got += s.weight
          by.append(s.name)
        }
        scored.append(Match(element: el, score: got / total, matchedBy: by))
      }
      if depth < 40 { queue.append(contentsOf: children(el).map { ($0, depth + 1) }) }
    }
    scored.sort { $0.score > $1.score }
    let fmt = { (x: Double) in String(format: "%.2f", x) }
    guard let best = scored.first, best.score >= 0.5 else {
      return .failure(StepError("no \(wantRole) like the recorded one (best match \(fmt(scored.first?.score ?? 0)))"))
    }
    if let second = scored.dropFirst().first, best.score - second.score < 0.15 {
      return .failure(StepError("two controls look like the target (\(fmt(best.score)) and \(fmt(second.score))); not guessing"))
    }
    return .success(best)
  }

  static func norm(_ s: String?) -> String? {
    guard let s else { return nil }
    let t = s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return t.isEmpty ? nil : t
  }

  // MARK: menus

  // The menu bar item for a path, walking the menus without opening them (most apps keep them populated).
  static func menuItem(_ path: [String], in app: AXUIElement) -> AXUIElement? {
    guard let bar = element(app, kAXMenuBarAttribute) else { return nil }
    func walk(_ node: AXUIElement, _ rest: ArraySlice<String>) -> AXUIElement? {
      guard let first = rest.first else { return node }
      let title = norm(first)
      for kid in children(node) {
        let r = role(kid)
        if r == "AXMenu", let found = walk(kid, rest) { return found }
        if r == "AXMenuBarItem" || r == "AXMenuItem", norm(string(kid, kAXTitleAttribute)) == title {
          if rest.count == 1 { return kid }
          for menu in children(kid) where role(menu) == "AXMenu" {
            if let found = walk(menu, rest.dropFirst()) { return found }
          }
        }
      }
      return nil
    }
    return walk(bar, ArraySlice(path))
  }
}

struct StepError: Error {
  let message: String
  init(_ message: String) { self.message = message }
}
