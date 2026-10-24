import WidgetKit
import SwiftUI

/// Spent vs budget for the month, safe to spend today, and where the money went.
struct MonthSummaryWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TallyMonthSummary", provider: TallyProvider()) { entry in
            MonthSummaryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Month summary")
        .description("Spent against your budget, what's safe to spend today, and your top categories.")
        .supportedFamilies([.systemMedium])
    }
}

struct MonthSummaryView: View {
    let entry: TallyEntry

    var body: some View {
        if entry.snapshot == nil {
            SetUpView()
        } else {
            content(TallyDay(entry: entry))
        }
    }

    private func content(_ day: TallyDay) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Spent in \(day.monthName)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                MoneyText(paise: day.budget.spent)
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                if day.budget.hasBudget {
                    ProgressView(value: min(day.budget.fractionUsed, 1))
                        .tint(day.budget.isOver ? Color.tallyDanger : Color.tallyAccent)
                        .widgetAccentable()
                    Text(day.budget.isOver
                         ? "\(Money.format(-day.budget.left)) over \(Money.format(day.budget.budget))"
                         : "\(Money.format(day.budget.left)) left of \(Money.format(day.budget.budget))")
                        .font(.caption)
                        .foregroundStyle(day.budget.isOver ? Color.tallyDanger : .secondary)
                    Spacer(minLength: 0)
                    HStack(spacing: 14) {
                        Stat(label: "Safe today", value: Money.format(day.budget.leftToday))
                        Stat(label: "Days left", value: "\(day.budget.daysLeft)")
                    }
                } else {
                    Spacer(minLength: 0)
                    Text("Set a monthly budget in Tally to see what's safe to spend.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            VStack(alignment: .leading, spacing: 8) {
                Text("Top categories")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if day.categories.isEmpty {
                    Text("Nothing logged yet this month.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(day.categories) { category in
                        HStack(spacing: 6) {
                            Circle().fill(Color(hex: category.tint)).frame(width: 8, height: 8)
                            Text(category.title).font(.callout).lineLimit(1)
                            Spacer(minLength: 4)
                            MoneyText(paise: category.amount).font(.callout.weight(.semibold))
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .widgetURL(TallyLink.home)
    }
}

private struct Stat: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.callout.weight(.semibold)).monospacedDigit()
        }
    }
}
