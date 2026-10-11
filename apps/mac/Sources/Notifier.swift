// Notifications for the inbox (docs/design.md, "The app"): a run waiting for approval or for the user, a question,
// a repair saved as a new version. Clicking one opens the window at the inbox. An item answered elsewhere (the window,
// the terminal) takes its notification away. macOS asks the user once whether Shadow may notify.
import Foundation
import UserNotifications

final class Notifier: NSObject, UNUserNotificationCenterDelegate {
  var onOpen: (String) -> Void = { _ in }
  private let center = UNUserNotificationCenter.current()

  func start() {
    center.delegate = self
    center.requestAuthorization(options: [.alert, .sound]) { granted, error in
      if let error { log("notifications unavailable: \(error.localizedDescription)") }
      else { log(granted ? "notifications allowed" : "notifications not allowed: the menu bar still shows what waits") }
    }
  }

  // A new inbox item (the daemon's InboxItem as JSON).
  func notify(_ item: JSON) {
    guard let id = item["id"] as? String else { return }
    let kind = item["kind"] as? String ?? ""
    let workflow = item["skillId"] as? String
    let content = UNMutableNotificationContent()
    switch kind {
    case "approval": content.title = "Waiting for your approval"
    case "ask", "question": content.title = "Shadow has a question"
    case "recovery": content.title = "Shadow needs you"
    case "repaired": content.title = "Repaired a workflow"
    default: content.title = "Shadow"
    }
    if let workflow { content.subtitle = workflow }
    content.body = item["title"] as? String ?? ""
    content.userInfo = ["route": "/inbox"]
    // A repair is news, not a request: no sound.
    if kind != "repaired" { content.sound = .default }
    center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { error in
      if let error { log("notification failed: \(error.localizedDescription)") }
    }
  }

  func clear(_ id: String) {
    center.removeDeliveredNotifications(withIdentifiers: [id])
    center.removePendingNotificationRequests(withIdentifiers: [id])
  }

  // Shown even while Shadow's window is in front.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let route = response.notification.request.content.userInfo["route"] as? String ?? "/inbox"
    DispatchQueue.main.async { self.onOpen(route) }
    completionHandler()
  }
}
