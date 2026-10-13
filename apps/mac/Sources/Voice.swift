// Narration while recording (docs/design.md, "2. Record"): with the microphone allowed on the form, Shadow.app records
// the user's voice into the recording's folder (voice.m4a, and voice.json with when it started on the daemon's clock).
// The audio never leaves the Mac and goes with the folder a day later. After Stop, the daemon turns it into text with
// the command-line mode below, on the Mac (macOS 26's SpeechAnalyzer); only that text, masked, reaches the model.
//   Shadow --transcribe <audio>   prints {"segments":[{"start","end","text"}]} (seconds from the start of the audio)
// Recording needs macOS's Microphone permission for Shadow; the speech model is downloaded by macOS the first time.
import AVFoundation
import Foundation
import Speech

final class Voice {
  private var recorder: AVAudioRecorder?

  // Starts recording into `dir`, once macOS allows the microphone (it asks the first time).
  func start(dir: String) {
    AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
      DispatchQueue.main.async {
        guard granted else { return log("no narration: the microphone isn't allowed for Shadow") }
        self?.begin(dir: dir)
      }
    }
  }

  private func begin(dir: String) {
    let url = URL(fileURLWithPath: dir).appendingPathComponent("voice.m4a")
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16_000, AVNumberOfChannelsKey: 1,
    ]
    do {
      let recorder = try AVAudioRecorder(url: url, settings: settings)
      guard recorder.record() else { return log("no narration: the microphone couldn't start") }
      self.recorder = recorder
      let started = ["startedAt": Date().timeIntervalSince1970 * 1000]
      if let data = try? JSONSerialization.data(withJSONObject: started) {
        FileManager.default.createFile(
          atPath: URL(fileURLWithPath: dir).appendingPathComponent("voice.json").path, contents: data,
          attributes: [.posixPermissions: 0o600])
      }
      log("recording narration")
    } catch {
      log("no narration: \(error.localizedDescription)")
    }
  }

  func stop() {
    recorder?.stop()
    recorder = nil
  }

  // `Shadow --transcribe <audio>`: never returns when it ran (it exits).
  static func runCommand(_ arguments: [String]) {
    guard let i = arguments.firstIndex(of: "--transcribe"), i + 1 < arguments.count else { return }
    let path = arguments[i + 1]
    Task {
      do {
        if #available(macOS 26.0, *) {
          let segments = try await transcribe(path)
          let data = try JSONSerialization.data(withJSONObject: ["segments": segments])
          print(String(data: data, encoding: .utf8) ?? "{}")
          exit(0)
        } else {
          FileHandle.standardError.write(Data("turning speech into text needs macOS 26\n".utf8))
          exit(1)
        }
      } catch {
        FileHandle.standardError.write(Data("\(error)\n".utf8))
        exit(1)
      }
    }
    dispatchMain()
  }

  @available(macOS 26.0, *)
  static func transcribe(_ path: String) async throws -> [[String: Any]] {
    let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale.current) ?? Locale(identifier: "en-US")
    let transcriber = SpeechTranscriber(
      locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange])
    // The speech model for this language, downloaded by macOS the first time.
    if await AssetInventory.status(forModules: [transcriber]) != .installed,
      let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber])
    {
      try await request.downloadAndInstall()
    }
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
    let analyzer = try await SpeechAnalyzer(inputAudioFile: file, modules: [transcriber], finishAfterFile: true)
    var segments: [[String: Any]] = []
    for try await result in transcriber.results {
      let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
      guard !text.isEmpty else { continue }
      segments.append(["start": result.range.start.seconds, "end": result.range.end.seconds, "text": text])
    }
    _ = analyzer
    return segments
  }
}
