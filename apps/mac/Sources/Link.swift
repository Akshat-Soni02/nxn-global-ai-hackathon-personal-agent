// The daemon's Unix socket, with the framing the extension and native host use: a 4-byte little-endian length, then
// UTF-8 JSON (packages/ipc/src/framing.ts). Task Player.app is launched by the daemon through `open`, so it gets no
// stdin/stdout from it: this socket is its only line to the daemon.
import Foundation

final class Link {
  private let path: String
  private var fd: Int32 = -1
  private var buffer = Data()
  private var source: DispatchSourceRead?
  private let queue = DispatchQueue(label: "taskplayer.link")
  var onMessage: (JSON) -> Void = { _ in }
  var onState: (Bool) -> Void = { _ in }

  init(path: String) { self.path = path }

  func start() { queue.async { self.connect() } }

  private func connect() {
    let url = URL(fileURLWithPath: path)
    // macOS caps a socket path at 103 bytes: connect by name from inside its folder instead.
    FileManager.default.changeCurrentDirectoryPath(url.deletingLastPathComponent().path)
    let name = Array(url.lastPathComponent.utf8)
    let s = socket(AF_UNIX, SOCK_STREAM, 0)
    guard s >= 0 else { return retry() }
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    guard name.count < MemoryLayout.size(ofValue: addr.sun_path) else {
      close(s)
      return
    }
    withUnsafeMutableBytes(of: &addr.sun_path) { $0.copyBytes(from: name) }
    let connected = withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.connect(s, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    guard connected == 0 else {
      close(s)
      return retry()
    }
    var noSigpipe: Int32 = 1
    setsockopt(s, SOL_SOCKET, SO_NOSIGPIPE, &noSigpipe, socklen_t(MemoryLayout<Int32>.size))
    fd = s
    let src = DispatchSource.makeReadSource(fileDescriptor: s, queue: queue)
    src.setEventHandler { [weak self] in self?.read() }
    src.setCancelHandler { [weak self] in
      close(s)
      self?.fd = -1
      DispatchQueue.main.async { self?.onState(false) }
      self?.retry()
    }
    source = src
    src.resume()
    DispatchQueue.main.async { self.onState(true) }
  }

  private func retry() {
    queue.asyncAfter(deadline: .now() + 2) { [weak self] in self?.connect() }
  }

  private func read() {
    var chunk = [UInt8](repeating: 0, count: 65_536)
    let n = Darwin.read(fd, &chunk, chunk.count)
    if n <= 0 {
      source?.cancel()
      source = nil
      return
    }
    buffer.append(contentsOf: chunk[0..<n])
    while buffer.count >= 4 {
      let length = Int(UInt32(littleEndian: buffer.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }))
      guard buffer.count >= 4 + length else { break }
      let start = buffer.startIndex
      let body = buffer.subdata(in: (start + 4)..<(start + 4 + length))
      buffer.removeSubrange(start..<(start + 4 + length))
      if let message = (try? JSONSerialization.jsonObject(with: body)) as? JSON {
        DispatchQueue.main.async { self.onMessage(message) }
      }
    }
  }

  func send(_ message: JSON) {
    guard let json = try? JSONSerialization.data(withJSONObject: message) else { return }
    var length = UInt32(json.count).littleEndian
    var frame = Data(bytes: &length, count: 4)
    frame.append(json)
    queue.async { [weak self] in
      guard let self, self.fd >= 0 else { return }
      frame.withUnsafeBytes { raw in
        guard let base = raw.baseAddress else { return }
        var offset = 0
        while offset < raw.count {
          let written = Darwin.write(self.fd, base + offset, raw.count - offset)
          if written <= 0 { break }
          offset += written
        }
      }
    }
  }
}
