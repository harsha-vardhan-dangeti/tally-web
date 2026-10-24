import SwiftUI
import AppKit

/// Colours from src/tokens.css, so the widgets match the app in light and dark mode.
extension Color {
    static let tallyAccent = Color(light: 0x3446D6, dark: 0x8C9BFF)
    static let tallyWarn = Color(light: 0xA3480C, dark: 0xFFB37A)
    static let tallyDanger = Color(light: 0xC2321F, dark: 0xFF8A7A)

    init(light: UInt32, dark: UInt32) {
        self.init(nsColor: NSColor(name: nil) { appearance in
            NSColor(rgb: appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light)
        })
    }

    /// "#B34D0D" → colour. Falls back to grey for anything unreadable.
    init(hex: String) {
        let value = UInt32(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x565C69
        self.init(nsColor: NSColor(rgb: value))
    }
}

private extension NSColor {
    convenience init(rgb: UInt32) {
        self.init(srgbRed: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255,
                  blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
    }
}

/// Opens a tab in Tally for Mac. Handled by `WebModel.handle(url:)`.
enum TallyLink {
    static let home = URL(string: "tally://open?tab=home")!
    static let plan = URL(string: "tally://open?tab=plan")!
}

struct MoneyText: View {
    let paise: Int
    var body: some View { Text(Money.format(paise)).monospacedDigit() }
}

/// Shown until Tally for Mac has been opened once and sent its first snapshot.
struct SetUpView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Tally", systemImage: "indianrupeesign.circle.fill")
                .font(.headline)
                .foregroundStyle(Color.tallyAccent)
            Text("Open Tally for Mac once to show your budget here.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(TallyLink.home)
    }
}
