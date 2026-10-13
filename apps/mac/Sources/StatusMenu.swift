// Shadow in the menu bar: how many things wait for the user next to the icon, and a menu to open the window, record,
// see whether Chrome, Mac apps and the model are reachable, and quit. Built afresh each time it opens, from what the
// daemon last reported.
import AppKit

final class StatusMenu: NSObject, NSMenuDelegate {
  var onOpen: (String) -> Void = { _ in }
  var onRecord: () -> Void = {}
  var onQuit: () -> Void = {}
  var isRecording: () -> Bool = { false }

  var waiting = 0 { didSet { render() } }
  var health: JSON = [:]
  var todayUsd: Double = 0
  // Whether the daemon is reachable right now (the menu says so, and offers to start it).
  var daemonUp = false { didSet { render() } }
  var onStartDaemon: () -> Void = {}

  private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  private let menu = NSMenu()

  override init() {
    super.init()
    menu.delegate = self
    item.menu = menu
    if let button = item.button {
      button.image = NSImage(systemSymbolName: "circle.lefthalf.filled", accessibilityDescription: "Shadow")
      button.image?.isTemplate = true
      button.imagePosition = .imageLeading
    }
    render()
  }

  private func render() {
    item.button?.title = waiting > 0 ? " \(waiting)" : ""
    item.button?.toolTip = !daemonUp ? "Shadow: not running" : waiting > 0 ? "Shadow: \(waiting) waiting for you" : "Shadow"
    item.button?.appearsDisabled = !daemonUp
  }

  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    if !daemonUp {
      menu.addItem(disabled("Shadow is not running"))
      menu.addItem(ClosureItem("Start Shadow", key: "") { [weak self] in self?.onStartDaemon() })
      menu.addItem(.separator())
      menu.addItem(ClosureItem("Quit Shadow", key: "q") { [weak self] in self?.onQuit() })
      return
    }
    if waiting > 0 {
      let line = waiting == 1 ? "1 thing waits for you" : "\(waiting) things wait for you"
      let open = ClosureItem(line, key: "") { [weak self] in self?.onOpen("/inbox") }
      open.attributedTitle = NSAttributedString(string: line, attributes: [.font: NSFont.boldSystemFont(ofSize: 13)])
      menu.addItem(open)
    } else {
      menu.addItem(disabled("Nothing waits for you"))
    }
    menu.addItem(.separator())
    menu.addItem(ClosureItem("Open Shadow", key: "o") { [weak self] in self?.onOpen("/inbox") })
    menu.addItem(ClosureItem("Workflows", key: "") { [weak self] in self?.onOpen("/workflows") })
    menu.addItem(ClosureItem("Runs", key: "") { [weak self] in self?.onOpen("/runs") })
    menu.addItem(.separator())
    menu.addItem(ClosureItem(isRecording() ? "Stop recording" : "Record a task", key: "r") { [weak self] in self?.onRecord() })
    menu.addItem(.separator())
    let chrome = (health["extensions"] as? Int ?? 0) > 0
    let mac = health["macApp"] as? JSON
    let model = health["model"] as? String == "configured"
    menu.addItem(disabled("Chrome: \(chrome ? "connected" : "not connected")"))
    menu.addItem(disabled("Mac apps: \(mac?["trusted"] as? Bool == true ? "allowed" : "not allowed yet")"))
    menu.addItem(disabled("Model: \(model ? "Nemotron" : "no API key")"))
    // The next workflow to start on its own (triggers): "Next: Weekly report, Mon 09:00".
    if let next = health["next"] as? JSON, let name = next["name"] as? String, let at = next["at"] as? Double {
      let when = Date(timeIntervalSince1970: at / 1000)
      let format = Calendar.current.isDateInToday(when) ? "HH:mm" : "EEE HH:mm"
      let formatter = DateFormatter()
      formatter.dateFormat = format
      menu.addItem(disabled("Next: \(name), \(formatter.string(from: when))"))
    }
    if todayUsd > 0 { menu.addItem(disabled(String(format: "Model use today: $%.4f", todayUsd))) }
    menu.addItem(.separator())
    menu.addItem(ClosureItem("Quit Shadow", key: "q") { [weak self] in self?.onQuit() })
  }

  private func disabled(_ title: String) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    item.isEnabled = false
    return item
  }
}

// A menu item that runs a closure.
final class ClosureItem: NSMenuItem {
  private let handler: () -> Void
  init(_ title: String, key: String, handler: @escaping () -> Void) {
    self.handler = handler
    super.init(title: title, action: #selector(fire), keyEquivalent: key)
    target = self
  }
  required init(coder: NSCoder) { fatalError("not used") }
  @objc private func fire() { handler() }
}
