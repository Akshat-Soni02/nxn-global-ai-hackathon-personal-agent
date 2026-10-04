// Test mode (--fixture): a small timesheet window inside Task Player itself, and a scripted user. An app may always
// use the Accessibility API on itself, so this runs the real describe / find / press code with no permission granted.
// The scripted user hit-tests a screen point and then calls the recorder's own entry points (recordClick,
// recordTyping), as the global monitors do; only the monitors and other apps are left out.
// The harness drives it through files: it creates <state>.go to start the scripted user, and reads <state> (JSON).
import AppKit
import ApplicationServices

final class Fixture: NSObject {
  private let recorder: Recorder
  private let statePath: String
  private let log: (String) -> Void
  private let window: NSWindow
  private let hoursLabel = NSTextField(labelWithString: "Hours")
  private let hours = NSTextField()
  private let notesLabel = NSTextField(labelWithString: "Notes")
  private let notes = NSTextField()
  private let billable = NSButton(checkboxWithTitle: "Billable", target: nil, action: nil)
  private let save = NSButton(title: "Save draft", target: nil, action: nil)
  private var urgent = false
  private var saved = 0
  private var hitMethod = "none"
  private var menuSeen = false
  private var poll: Timer?

  init(recorder: Recorder, statePath: String, log: @escaping (String) -> Void) {
    self.recorder = recorder
    self.statePath = statePath
    self.log = log
    window = NSWindow(
      contentRect: NSRect(x: 60, y: 140, width: 340, height: 190), styleMask: [.titled], backing: .buffered,
      defer: false)
    window.title = "Timesheet (Task Player fixture)"
    window.isReleasedWhenClosed = false
    super.init()

    let content = NSView(frame: NSRect(x: 0, y: 0, width: 340, height: 190))
    hoursLabel.frame = NSRect(x: 20, y: 140, width: 60, height: 22)
    hours.frame = NSRect(x: 90, y: 140, width: 220, height: 24)
    hours.setAccessibilityIdentifier("hours")
    hours.setAccessibilityTitleUIElement(hoursLabel)
    notesLabel.frame = NSRect(x: 20, y: 104, width: 60, height: 22)
    notes.frame = NSRect(x: 90, y: 104, width: 220, height: 24)  // no identifier, no label: found by "near" and path
    billable.frame = NSRect(x: 88, y: 70, width: 200, height: 22)
    save.frame = NSRect(x: 86, y: 24, width: 120, height: 32)
    save.bezelStyle = .rounded
    save.target = self
    save.action = #selector(saveDraft)
    for v in [hoursLabel, hours, notesLabel, notes, billable, save] as [NSView] { content.addSubview(v) }
    window.contentView = content

    // A menu bar menu, for menu steps (Timesheet > Mark urgent).
    let main = NSMenu()
    let appItem = NSMenuItem()
    appItem.submenu = NSMenu(title: "Task Player")
    main.addItem(appItem)
    let sheetItem = NSMenuItem()
    let sheet = NSMenu(title: "Timesheet")
    let mark = NSMenuItem(title: "Mark urgent", action: #selector(markUrgent), keyEquivalent: "")
    mark.target = self
    sheet.addItem(mark)
    sheetItem.submenu = sheet
    main.addItem(sheetItem)
    NSApp.mainMenu = main

    window.orderFrontRegardless()
    writeState("ready")
    poll = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in self?.checkGo() }
  }

  @objc private func saveDraft() {
    saved += 1
    writeState("saved")
  }

  @objc private func markUrgent() {
    urgent = true
    writeState("urgent")
  }

  // After a recording: back to an empty form, so a replay has something to do.
  func reset() {
    hours.stringValue = ""
    notes.stringValue = ""
    billable.state = .off
    urgent = false
    saved = 0
    writeState("reset")
  }

  private func writeState(_ phase: String) {
    let state: JSON = [
      "phase": phase, "hours": hours.stringValue, "notes": notes.stringValue, "billable": billable.state == .on,
      "urgent": urgent, "saved": saved, "hit": hitMethod, "menu": menuSeen,
    ]
    if let data = try? JSONSerialization.data(withJSONObject: state) {
      try? data.write(to: URL(fileURLWithPath: statePath))
    }
  }

  private func checkGo() {
    let go = statePath + ".go"
    guard FileManager.default.fileExists(atPath: go) else { return }
    try? FileManager.default.removeItem(atPath: go)
    runScript()
  }

  // MARK: the scripted user

  private var me: AXUIElement { AXUIElementCreateApplication(getpid()) }

  // Where a view is on screen, as NSEvent.mouseLocation would say (bottom-left origin), then hit-tested the way the
  // recorder hit-tests a real click.
  private func element(at view: NSView) -> AXUIElement? {
    let rect = window.convertToScreen(view.convert(view.bounds, to: nil))
    let point = AX.axPoint(fromScreen: NSPoint(x: rect.midX, y: rect.midY))
    if let el = AX.hit(point, in: me) {
      hitMethod = "AXUIElementCopyElementAtPosition"
      return el
    }
    hitMethod = "frame search"
    return smallest(containing: point, in: me)
  }

  private func smallest(containing point: CGPoint, in root: AXUIElement) -> AXUIElement? {
    var best: (element: AXUIElement, area: CGFloat)?
    var queue = (AX.attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? []
    while !queue.isEmpty {
      let el = queue.removeFirst()
      if let f = AX.frame(el), f.contains(point), f.width * f.height < (best?.area ?? .infinity) {
        best = (el, f.width * f.height)
      }
      queue.append(contentsOf: AX.children(el))
    }
    return best?.element
  }

  private func click(_ view: NSView, press: Bool) {
    guard let el = element(at: view) else { return log("fixture: nothing at \(view)") }
    recorder.recordClick(el)
    if press { AXUIElementPerformAction(AX.actionableAncestor(el), kAXPressAction as CFString) }
  }

  private func type(_ text: String, into field: NSTextField) {
    guard let el = element(at: field) else { return }
    let target = AX.actionableAncestor(el)
    AXUIElementSetAttributeValue(target, kAXValueAttribute as CFString, text as CFString)
    recorder.recordTyping(in: target)
  }

  private func runScript() {
    let actions: [() -> Void] = [
      { self.click(self.hours, press: false) },
      { self.type("8", into: self.hours) },
      { self.click(self.notes, press: false) },
      { self.type("weekly report", into: self.notes) },
      { self.click(self.billable, press: true) },
      {
        // A menu bar item, as the recorder sees a click on it (Task Player is an accessory app, so this menu bar
        // exists for the Accessibility API but is not on screen).
        if let item = AX.menuItem(["Timesheet", "Mark urgent"], in: self.me) {
          self.menuSeen = true
          self.recorder.recordClick(item)
          // What choosing it does. (Pressing this off-screen menu bar through AX would leave it tracking the mouse,
          // which a person's click on a real menu bar never does.)
          self.markUrgent()
        } else {
          self.log("fixture: no AX menu bar for Task Player")
        }
      },
      { self.click(self.save, press: true) },
      { self.writeState("recorded") },
    ]
    for (i, action) in actions.enumerated() {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.4 * Double(i + 1), execute: action)
    }
  }
}
