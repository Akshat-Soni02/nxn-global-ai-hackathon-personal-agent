// The floating button's face, in SwiftUI (Panel.swift hosts it in a non-activating panel above every app). A pill:
// the record dot when idle; while recording a red pill with the stop square, the clock, small marks for the
// microphone and the screen when the form allowed them, and a trash button that throws the recording away; a dark
// pill with an icon and a line of text for everything else (compiling, a question, saved, failed). It is a remote
// control: a press asks the daemon, and the pill shows what the daemon reports back.
import SwiftUI

final class PillModel: ObservableObject {
  @Published var look = Panel.Look(kind: .idle, icon: .record, text: "Record")
  @Published var mic = false
  @Published var screen = false
}

struct Pill: View {
  @ObservedObject var model: PillModel
  var onPress: () -> Void = {}
  var onDiscard: () -> Void = {}

  private var fill: Color {
    model.look.kind == .rec ? Color(red: 0.86, green: 0.15, blue: 0.15) : Color(red: 0.094, green: 0.094, blue: 0.106)
  }

  var body: some View {
    HStack(spacing: 8) {
      icon.frame(width: 16, height: 16)
      if model.look.kind != .idle {
        Text(model.look.text)
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(.white)
          .lineLimit(1)
          .truncationMode(.tail)
          .frame(maxWidth: 340, alignment: .leading)
          .fixedSize(horizontal: true, vertical: false)
      }
      if model.look.kind == .rec {
        if model.mic || model.screen {
          HStack(spacing: 4) {
            if model.mic { Image(systemName: "mic.fill").font(.system(size: 9, weight: .bold)).help("Narration is on") }
            if model.screen {
              Image(systemName: "camera.fill").font(.system(size: 9, weight: .bold)).help("Screenshots are on")
            }
          }
          .foregroundStyle(.white.opacity(0.75))
        }
        Button(action: onDiscard) {
          Image(systemName: "trash")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.white.opacity(0.9))
            .frame(width: 22, height: 22)
            .background(Circle().fill(.white.opacity(0.14)))
        }
        .buttonStyle(.plain)
        .help("Throw this recording away: nothing is kept")
        .accessibilityLabel("Discard the recording")
      }
    }
    .padding(.leading, 12)
    .padding(.trailing, model.look.kind == .idle ? 12 : model.look.kind == .rec ? 9 : 14)
    .frame(height: 40)
    .background(
      Capsule()
        .fill(fill)
        .overlay(Capsule().stroke(.white.opacity(0.16), lineWidth: 1))
    )
    .overlay(alignment: .topTrailing) {
      if model.look.badge {
        Circle().fill(Color(red: 0.98, green: 0.75, blue: 0.14)).frame(width: 8, height: 8).offset(x: -5, y: 5)
      }
    }
    .contentShape(Capsule())
    .onTapGesture(perform: onPress)
    .animation(.spring(response: 0.35, dampingFraction: 1.0), value: model.look.kind)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(model.look.kind == .idle ? "Record a task" : model.look.text)
    .accessibilityAddTraits(.isButton)
  }

  @ViewBuilder private var icon: some View {
    let amber = Color(red: 0.98, green: 0.75, blue: 0.14)
    switch model.look.icon {
    case .record:
      Circle().fill(Color(red: 0.94, green: 0.27, blue: 0.27)).frame(width: 11, height: 11)
    case .stop:
      RoundedRectangle(cornerRadius: 2).fill(.white).frame(width: 9, height: 9)
    case .spinner:
      ProgressView().controlSize(.small).tint(.white)
    case .terminal:
      Image(systemName: "text.bubble").font(.system(size: 12, weight: .semibold)).foregroundStyle(amber)
    case .check:
      Image(systemName: "checkmark").font(.system(size: 12, weight: .bold))
        .foregroundStyle(Color(red: 0.29, green: 0.87, blue: 0.5))
    case .alert:
      Image(systemName: "exclamationmark.circle").font(.system(size: 13, weight: .semibold)).foregroundStyle(amber)
    }
  }
}
