import Foundation

/// Budget maths, ported from src/core/budget.ts so the widgets agree with the app to the paisa.
struct BudgetView: Equatable {
    var budget: Int
    var spent: Int
    var spentToday: Int
    var left: Int
    /// Counting today.
    var daysLeft: Int
    var safePerDay: Int
    var leftToday: Int
    var fractionUsed: Double
    var isOver: Bool
    var hasBudget: Bool

    init(budget: Int, spent: Int, spentToday: Int, now: Date, calendar: Calendar = .current) {
        let day = calendar.component(.day, from: now)
        let daysInMonth = calendar.range(of: .day, in: .month, for: now)?.count ?? 30
        let daysLeft = max(daysInMonth - day + 1, 1)
        let availableFromToday = max(budget - (spent - spentToday), 0)
        let safePerDay = budget > 0 ? availableFromToday / daysLeft : 0
        self.budget = budget
        self.spent = spent
        self.spentToday = spentToday
        self.left = budget - spent
        self.daysLeft = daysLeft
        self.safePerDay = safePerDay
        self.leftToday = max(safePerDay - spentToday, 0)
        self.fractionUsed = budget > 0 ? Double(spent) / Double(budget) : 0
        self.isOver = budget > 0 && spent > budget
        self.hasBudget = budget > 0
    }
}

enum TallyDates {
    static func monthKey(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month], from: date)
        return String(format: "%04d-%02d", c.year ?? 0, c.month ?? 0)
    }

    static func dayKey(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Next date a bill is due on or after `from`. Same rule as `nextDue` in store.ts, including
    /// a day past the end of a short month rolling into the next month.
    static func nextDue(day: Int, from: Date, calendar: Calendar = .current) -> Date {
        let today = calendar.startOfDay(for: from)
        let c = calendar.dateComponents([.year, .month], from: from)
        let thisMonth = calendar.date(from: DateComponents(year: c.year, month: c.month, day: day)) ?? today
        if thisMonth >= today { return thisMonth }
        return calendar.date(from: DateComponents(year: c.year, month: (c.month ?? 1) + 1, day: day)) ?? today
    }
}
