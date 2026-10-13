// A walk-through (docs/design.md, "7. Test"): outlines the control an ax step would act on, for a moment, without
// touching it. A transparent window above everything, that ignores the mouse, draws a rounded blue frame around the
// control's screen rectangle and fades away. Nothing is sent anywhere and nothing is pressed.
import AppKit

enum Highlight {
  private static var shown: [NSWindow] = []

  // `frame` is in Accessibility screen coordinates (origin top-left of the main screen).
  static func flash(_ frame: CGRect, for seconds: Double = 1.5) {
    guard let primary = NSScreen.screens.first else { return }
    let height = primary.frame.height
    let rect = NSRect(x: frame.minX - 6, y: height - frame.maxY - 6, width: frame.width + 12, height: frame.height + 12)
    let window = NSWindow(contentRect: rect, styleMask: .borderless, backing: .buffered, defer: false)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.level = .screenSaver
    window.ignoresMouseEvents = true
    window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
    window.contentView = HighlightView(frame: NSRect(origin: .zero, size: rect.size))
    window.orderFrontRegardless()
    shown.append(window)
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
      NSAnimationContext.runAnimationGroup({ context in
        context.duration = 0.3
        window.animator().alphaValue = 0
      }) {
        window.orderOut(nil)
        shown.removeAll { $0 === window }
      }
    }
  }
}

final class HighlightView: NSView {
  override func draw(_ dirtyRect: NSRect) {
    let inset = bounds.insetBy(dx: 3, dy: 3)
    let path = NSBezierPath(roundedRect: inset, xRadius: 8, yRadius: 8)
    // A soft glow, then the frame itself: the same blue as the window's accent.
    NSColor(srgbRed: 0.23, green: 0.36, blue: 0.86, alpha: 0.25).setStroke()
    path.lineWidth = 8
    path.stroke()
    NSColor(srgbRed: 0.23, green: 0.36, blue: 0.86, alpha: 1).setStroke()
    path.lineWidth = 3
    path.stroke()
  }
}
