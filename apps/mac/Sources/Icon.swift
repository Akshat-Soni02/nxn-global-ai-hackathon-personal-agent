// The app icon, drawn by the app itself so the repo ships no image files (docs/design-ui.md, "The mark"):
//   Shadow --icon <folder>   writes icon_16x16.png … icon_512x512@2x.png there, for `iconutil -c icns`
// The mark: a crisp white dot and the soft blue shadow it casts, on a deep night-blue rounded square. The dot is
// the record button; the shadow is what follows it. Vector drawing, so every size is sharp.
import AppKit
import CoreGraphics
import UniformTypeIdentifiers

enum Icon {
  static func draw(size: Int) -> CGImage? {
    let s = CGFloat(size)
    guard
      let ctx = CGContext(
        data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    ctx.clear(CGRect(x: 0, y: 0, width: s, height: s))

    // The macOS icon shape: a rounded square with a little margin, as Apple's template does.
    let inset = s * 0.065
    let square = CGRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
    let shape = CGPath(
      roundedRect: square, cornerWidth: square.width * 0.2237, cornerHeight: square.height * 0.2237, transform: nil)
    ctx.saveGState()
    ctx.addPath(shape)
    ctx.clip()
    let colors =
      [
        CGColor(red: 0.14, green: 0.15, blue: 0.26, alpha: 1),
        CGColor(red: 0.05, green: 0.05, blue: 0.09, alpha: 1),
      ] as CFArray
    if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
      ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: s), end: CGPoint(x: 0, y: 0), options: [])
    }
    // A faint light along the top edge, the way glass catches it.
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.06))
    ctx.fill(CGRect(x: square.minX, y: square.maxY - s * 0.012, width: square.width, height: s * 0.012))

    // The shadow: soft blue, offset down and to the right.
    let center = CGPoint(x: s * 0.47, y: s * 0.53)
    let radius = s * 0.19
    ctx.setShadow(offset: .zero, blur: s * 0.12, color: CGColor(red: 0.23, green: 0.36, blue: 0.86, alpha: 0.9))
    ctx.setFillColor(CGColor(red: 0.23, green: 0.36, blue: 0.86, alpha: 0.85))
    ctx.fillEllipse(
      in: CGRect(
        x: center.x - radius + s * 0.09, y: center.y - radius - s * 0.09, width: radius * 2, height: radius * 2))
    ctx.setShadow(offset: .zero, blur: 0, color: nil)
    // The dot: white, crisp.
    ctx.setFillColor(CGColor(red: 0.98, green: 0.98, blue: 1, alpha: 1))
    ctx.fillEllipse(in: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
    // The record dot inside it.
    let dot = radius * 0.34
    ctx.setFillColor(CGColor(red: 0.94, green: 0.27, blue: 0.27, alpha: 1))
    ctx.fillEllipse(in: CGRect(x: center.x - dot, y: center.y - dot, width: dot * 2, height: dot * 2))
    ctx.restoreGState()
    return ctx.makeImage()
  }

  // Every size iconutil wants, named as it wants them.
  static func writeIconset(to dir: String) throws {
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    for base in [16, 32, 128, 256, 512] {
      for scale in [1, 2] {
        guard let image = draw(size: base * scale) else { throw Screen.Failure(description: "could not draw the icon") }
        let name = scale == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png"
        try Screen.save(image, to: "\(dir)/\(name)", type: UTType.png.identifier as CFString)
      }
    }
  }

  static func runCommand(_ arguments: [String]) -> Bool {
    guard let i = arguments.firstIndex(of: "--icon"), i + 1 < arguments.count else { return false }
    do {
      try writeIconset(to: arguments[i + 1])
    } catch {
      FileHandle.standardError.write(Data("\(error)\n".utf8))
      exit(1)
    }
    return true
  }
}
