// Screenshots while recording (docs/design.md, "2. Record" and "Redaction"), and reading the words on them with Apple's
// on-device Vision framework. Nothing here sends anything anywhere: the daemon masks the words it is given
// (packages/recorder/src/mask.ts) and only those masked words go to the model. The pictures stay in the recording's
// folder, with what was masked blacked out, and are deleted with it a day later.
//
// The daemon also runs this from the command line, so reading a picture needs no running app and no permission:
//   Shadow --ocr <image>                  prints {"width","height","lines":[{"text","box":{"x","y","w","h"}}]}
//   Shadow --redact <image> <boxes.json>  blacks out the boxes ([{"x","y","w","h"}], image pixels) in place
// Capturing a window needs macOS's Screen Recording permission for Shadow.
import AppKit
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers
import Vision

enum Screen {
  struct Failure: Error, CustomStringConvertible {
    let description: String
  }

  static func load(_ path: String) throws -> (CGImage, CFString) {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { throw Failure(description: "can't read the image \(path)") }
    return (image, CGImageSourceGetType(source) ?? UTType.png.identifier as CFString)
  }

  static func save(_ image: CGImage, to path: String, type: CFString) throws {
    guard let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, type, 1, nil)
    else { throw Failure(description: "can't write the image \(path)") }
    let options = [kCGImageDestinationLossyCompressionQuality: 0.7] as CFDictionary
    CGImageDestinationAddImage(destination, image, options)
    guard CGImageDestinationFinalize(destination) else { throw Failure(description: "can't write the image \(path)") }
  }

  // The lines of text in an image, each with its box in the image's pixels (top-left origin).
  static func readText(_ path: String) throws -> [String: Any] {
    let (image, _) = try load(path)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let width = CGFloat(image.width)
    let height = CGFloat(image.height)
    let lines: [[String: Any]] = (request.results ?? []).compactMap { observation in
      guard let text = observation.topCandidates(1).first?.string else { return nil }
      let b = observation.boundingBox  // normalised, origin bottom-left
      return [
        "text": text,
        "box": [
          "x": Int(b.minX * width), "y": Int((1 - b.maxY) * height),
          "w": Int(b.width * width), "h": Int(b.height * height),
        ],
      ]
    }
    return ["width": image.width, "height": image.height, "lines": lines]
  }

  // Black boxes over the given rectangles (image pixels, top-left origin), a little larger than given, because the
  // boxes text recognition reports are not exact. The file is rewritten in place.
  static func blackOut(_ path: String, _ boxes: [CGRect]) throws {
    guard !boxes.isEmpty else { return }
    let (image, type) = try load(path)
    let width = image.width
    let height = image.height
    guard
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { throw Failure(description: "can't draw on \(path)") }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    context.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
    for box in boxes {
      let flipped = CGRect(x: box.minX, y: CGFloat(height) - box.maxY, width: box.width, height: box.height)
      context.fill(flipped.insetBy(dx: -4, dy: -4))
    }
    guard let out = context.makeImage() else { throw Failure(description: "can't draw on \(path)") }
    try save(out, to: path, type: type)
  }

  // The frontmost window of the app with `pid`, saved to `path` as JPEG. `done` gets false when there is no such
  // window or Screen Recording isn't allowed.
  static func captureWindow(pid: pid_t, to path: String, done: @escaping (Bool) -> Void) {
    SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { content, error in
      guard error == nil,
        let window = content?.windows.first(where: {
          $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.isOnScreen
        })
      else { return done(false) }
      let filter = SCContentFilter(desktopIndependentWindow: window)
      let config = SCStreamConfiguration()
      let scale = CGFloat(filter.pointPixelScale)
      config.width = max(1, Int(filter.contentRect.width * scale))
      config.height = max(1, Int(filter.contentRect.height * scale))
      config.showsCursor = false
      SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) { image, error in
        guard error == nil, let image else { return done(false) }
        do {
          try save(image, to: path, type: UTType.jpeg.identifier as CFString)
          done(true)
        } catch {
          done(false)
        }
      }
    }
  }

  // The command-line modes; returns whether one ran (the caller exits).
  static func runCommand(_ arguments: [String]) -> Bool {
    func emit(_ value: Any) {
      if let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) {
        print(text)
      }
    }
    if let i = arguments.firstIndex(of: "--ocr"), i + 1 < arguments.count {
      do {
        emit(try readText(arguments[i + 1]))
      } catch {
        FileHandle.standardError.write(Data("\(error)\n".utf8))
        exit(1)
      }
      return true
    }
    if let i = arguments.firstIndex(of: "--redact"), i + 2 < arguments.count {
      do {
        let data = try Data(contentsOf: URL(fileURLWithPath: arguments[i + 2]))
        let list = (try JSONSerialization.jsonObject(with: data) as? [[String: Double]]) ?? []
        let boxes = list.map { CGRect(x: $0["x"] ?? 0, y: $0["y"] ?? 0, width: $0["w"] ?? 0, height: $0["h"] ?? 0) }
        try blackOut(arguments[i + 1], boxes)
      } catch {
        FileHandle.standardError.write(Data("\(error)\n".utf8))
        exit(1)
      }
      return true
    }
    return false
  }
}
