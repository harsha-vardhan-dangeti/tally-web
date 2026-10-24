import WidgetKit
import SwiftUI

/// The next bills and subscriptions due, with price rises flagged.
struct BillsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TallyBills", provider: TallyProvider()) { entry in
            BillsView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Upcoming bills")
        .description("Bills and subscriptions coming up, and what's due in the next two weeks.")
        .supportedFamilies([.systemMedium])
    }
}

struct BillsView: View {
    let entry: TallyEntry

    var body: some View {
        if entry.snapshot == nil {
            SetUpView()
        } else {
            content(TallyDay(entry: entry))
        }
    }

    private func content(_ day: TallyDay) -> some View {
        let twoWeeks = entry.date.addingTimeInterval(14 * 86_400)
        let dueSoon = day.bills.filter { $0.due < twoWeeks }.reduce(0) { $0 + $1.bill.amount }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("Upcoming bills").font(.headline)
                Spacer()
                if dueSoon > 0 {
                    Text("\(Money.format(dueSoon)) in 14 days")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
            if day.bills.isEmpty {
                Text("Add bills and subscriptions in Tally → Plan to see them here.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
            } else {
                ForEach(day.bills.prefix(3), id: \.bill.id) { item in
                    BillRow(bill: item.bill, due: item.due, now: entry.date)
                }
                Spacer(minLength: 0)
            }
        }
        .widgetURL(TallyLink.plan)
    }
}

private struct BillRow: View {
    let bill: WidgetSnapshot.Bill
    let due: Date
    let now: Date

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(Color(hex: bill.tint)).frame(width: 8, height: 8)
            Text(bill.name).font(.callout).lineLimit(1)
            if bill.amount > bill.prevAmount {
                Image(systemName: "arrow.up.right")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Color.tallyWarn)
                    .accessibilityLabel("Price went up")
            }
            Spacer(minLength: 4)
            Text(dueLabel)
                .font(.caption)
                .foregroundStyle(isSoon ? Color.tallyWarn : .secondary)
            MoneyText(paise: bill.amount)
                .font(.callout.weight(.semibold))
                .frame(minWidth: 64, alignment: .trailing)
        }
    }

    private var days: Int {
        let calendar = Calendar.current
        return calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: due)).day ?? 0
    }

    private var isSoon: Bool { days <= 2 }

    private var dueLabel: String {
        switch days {
        case 0: "Today"
        case 1: "Tomorrow"
        default: "In \(days) days"
        }
    }
}
