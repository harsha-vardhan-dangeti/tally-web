import WidgetKit
import SwiftUI
import AppIntents

/// Logs one of your pinned repeats. Runs in the widget: it queues the expense in the App Group
/// and pings Tally, which adds it right away if it's open, or the next time it opens.
struct LogRepeatIntent: AppIntent {
    static let title: LocalizedStringResource = "Log a repeat"
    static let description = IntentDescription("Logs one of your pinned Tally repeats.")
    static let isDiscoverable = false

    @Parameter(title: "Repeat")
    var chipId: String

    init() {}

    init(chipId: String) {
        self.chipId = chipId
    }

    func perform() async throws -> some IntentResult {
        guard let chip = SharedStore.loadSnapshot()?.chips.first(where: { $0.id == chipId }) else { return .result() }
        let log = WidgetLog(id: UUID().uuidString.lowercased(), title: chip.title, amount: chip.amount,
                            category: chip.category, loggedAt: Date.now.timeIntervalSince1970 * 1000)
        SharedStore.updatePendingLogs { $0.append(log) }
        SharedStore.notifyApp()
        // The tapped widget reloads by itself; this refreshes the month summary too.
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

/// Pinned repeats as buttons: tap Coffee · ₹180 and it's logged.
struct QuickLogWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TallyQuickLog", provider: TallyProvider()) { entry in
            QuickLogView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Quick log")
        .description("Log your pinned repeats with one click, without opening Tally.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct QuickLogView: View {
    let entry: TallyEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if entry.snapshot == nil {
            SetUpView()
        } else {
            content(TallyDay(entry: entry))
        }
    }

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 8), count: 2)
    }

    private func content(_ day: TallyDay) -> some View {
        let chips = Array(day.chips.prefix(family == .systemLarge ? 8 : 4))
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(day.budget.hasBudget ? "Safe today" : "Spent today")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                MoneyText(paise: day.budget.hasBudget ? day.budget.leftToday : day.spentToday)
                    .font(.headline)
                    .foregroundStyle(Color.tallyAccent)
                    .widgetAccentable()
            }

            if chips.isEmpty {
                Text("Pin repeats in Tally (Home → + Pin) to log them from here.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(chips) { chip in
                        Button(intent: LogRepeatIntent(chipId: chip.id)) {
                            HStack(spacing: 8) {
                                Circle().fill(Color(hex: chip.tint)).frame(width: 8, height: 8)
                                Text(chip.title).font(.callout.weight(.medium)).lineLimit(1)
                                Spacer(minLength: 4)
                                MoneyText(paise: chip.amount).font(.callout).foregroundStyle(.secondary)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity)
                            .background(.fill.secondary, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Log \(chip.title), \(Money.format(chip.amount))")
                    }
                }
                Spacer(minLength: 0)
            }

            if day.pendingCount > 0 {
                Label(day.pendingCount == 1 ? "1 log waits for Tally to open" : "\(day.pendingCount) logs wait for Tally to open",
                      systemImage: "clock")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else if family == .systemLarge {
                Text("Spent today \(Money.format(day.spentToday))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .widgetURL(TallyLink.home)
    }
}
