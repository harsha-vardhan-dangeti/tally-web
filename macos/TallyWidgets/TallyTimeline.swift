import WidgetKit
import SwiftUI

struct TallyEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    /// Logged from a widget but not yet added by Tally; counted in so totals update at once.
    let pending: [WidgetLog]
}

/// Widgets refresh when Tally saves a new snapshot or a widget button logs something. Beyond that,
/// "safe today", "days left" and bill due dates only change at midnight, so the timeline has an
/// entry for now and for each of the next two midnights.
struct TallyProvider: TimelineProvider {
    func placeholder(in context: Context) -> TallyEntry {
        TallyEntry(date: .now, snapshot: .sample, pending: [])
    }

    func getSnapshot(in context: Context, completion: @escaping (TallyEntry) -> Void) {
        let entry = current(at: .now)
        completion(context.isPreview && entry.snapshot == nil ? placeholder(in: context) : entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TallyEntry>) -> Void) {
        let now = Date.now
        let calendar = Calendar.current
        let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now
        let dates = [now, midnight, calendar.date(byAdding: .day, value: 1, to: midnight) ?? midnight]
        completion(Timeline(entries: dates.map(current(at:)), policy: .atEnd))
    }

    private func current(at date: Date) -> TallyEntry {
        TallyEntry(date: date, snapshot: SharedStore.loadSnapshot(), pending: SharedStore.pendingLogs())
    }
}

/// What the widgets show for one entry date, with month and day roll-over handled.
struct TallyDay {
    var budget: BudgetView
    var monthName: String
    var categories: [WidgetSnapshot.Category]
    var chips: [WidgetSnapshot.Chip]
    var bills: [(bill: WidgetSnapshot.Bill, due: Date)]
    var pendingCount: Int
    var spentToday: Int

    init(entry: TallyEntry, calendar: Calendar = .current) {
        let date = entry.date
        let s = entry.snapshot ?? .empty
        let month = TallyDates.monthKey(date, calendar: calendar)
        let day = TallyDates.dayKey(date, calendar: calendar)
        let sameMonth = s.month == month
        let pendingMonth = entry.pending.filter { TallyDates.monthKey($0.date, calendar: calendar) == month }
        let pendingToday = pendingMonth.filter { TallyDates.dayKey($0.date, calendar: calendar) == day }

        let spent = (sameMonth ? s.spentMonth : 0) + pendingMonth.reduce(0) { $0 + $1.amount }
        let today = (s.today == day ? s.spentToday : 0) + pendingToday.reduce(0) { $0 + $1.amount }
        budget = BudgetView(budget: s.budget, spent: spent, spentToday: today, now: date, calendar: calendar)
        spentToday = today
        monthName = date.formatted(.dateTime.month(.wide))
        categories = sameMonth ? s.categories : []
        chips = s.chips
        bills = s.bills
            .map { (bill: $0, due: TallyDates.nextDue(day: $0.day, from: date, calendar: calendar)) }
            .sorted { $0.due < $1.due }
        pendingCount = entry.pending.count
    }
}

extension WidgetSnapshot {
    static let empty = WidgetSnapshot(version: 1, generatedAt: 0, month: "", today: "", budget: 0, spentMonth: 0, spentToday: 0,
                                      categories: [], chips: [], bills: [], pendingInbox: 0)

    /// Shown in the widget gallery before Tally has sent real data.
    static var sample: WidgetSnapshot {
        let now = Date.now
        return WidgetSnapshot(
            version: 1, generatedAt: now.timeIntervalSince1970 * 1000,
            month: TallyDates.monthKey(now), today: TallyDates.dayKey(now),
            budget: 5_500_000, spentMonth: 3_412_000, spentToday: 26_000,
            categories: [
                .init(id: "food", title: "Food", amount: 1_120_000, tint: "#B34D0D"),
                .init(id: "groceries", title: "Groceries", amount: 840_000, tint: "#0B7A47"),
                .init(id: "transport", title: "Transport", amount: 512_000, tint: "#1D4FA8"),
            ],
            chips: [
                .init(id: "s1", title: "Coffee", amount: 18_000, category: "food", tint: "#B34D0D"),
                .init(id: "s2", title: "Auto", amount: 12_000, category: "transport", tint: "#1D4FA8"),
                .init(id: "s3", title: "Lunch", amount: 35_000, category: "food", tint: "#B34D0D"),
                .init(id: "s4", title: "Milk", amount: 6_800, category: "groceries", tint: "#0B7A47"),
            ],
            bills: [
                .init(id: "b1", name: "Netflix", amount: 64_900, prevAmount: 49_900, day: 28, isSubscription: true, tint: "#BF2E73"),
                .init(id: "b2", name: "Rent", amount: 2_500_000, prevAmount: 2_500_000, day: 5, isSubscription: false, tint: "#7A4BC2"),
                .init(id: "b3", name: "Airtel Fiber", amount: 117_800, prevAmount: 117_800, day: 12, isSubscription: true, tint: "#7A4BC2"),
            ],
            pendingInbox: 0)
    }
}
