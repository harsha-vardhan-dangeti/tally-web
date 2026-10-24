import Foundation

/// The summary Tally's web app sends after every change. Mirrors `WidgetSnapshot` in src/data/native.ts.
/// Amounts are whole paise; times are milliseconds since 1970, as in the web app.
struct WidgetSnapshot: Codable, Equatable {
    var version: Int
    var generatedAt: Double
    /// "2026-10": the month `spentMonth` and `categories` belong to.
    var month: String
    /// "2026-10-24": the day `spentToday` belongs to.
    var today: String
    var budget: Int
    var spentMonth: Int
    var spentToday: Int
    var categories: [Category]
    var chips: [Chip]
    var bills: [Bill]
    var pendingInbox: Int

    struct Category: Codable, Equatable, Identifiable {
        var id: String
        var title: String
        var amount: Int
        var tint: String
    }

    struct Chip: Codable, Equatable, Identifiable {
        var id: String
        var title: String
        var amount: Int
        var category: String
        var tint: String
    }

    struct Bill: Codable, Equatable, Identifiable {
        var id: String
        var name: String
        var amount: Int
        var prevAmount: Int
        var day: Int
        var isSubscription: Bool
        var tint: String
    }
}

/// An expense logged from a widget button, waiting for the web app to add it. Mirrors `WidgetLog` in native.ts.
struct WidgetLog: Codable, Equatable, Identifiable {
    var id: String
    var title: String
    var amount: Int
    var category: String
    var loggedAt: Double

    var date: Date { Date(timeIntervalSince1970: loggedAt / 1000) }
}

/// Files in the App Group container shared by Tally for Mac and its widgets. Nothing here leaves the Mac.
enum SharedStore {
    /// Posted by a widget after it queues a log, so a running Tally adds it straight away.
    static let pendingLogsNotification = "app.tally.widget-logs-changed"

    static var groupID: String { Bundle.main.object(forInfoDictionaryKey: "TallyAppGroup") as? String ?? "" }

    private static func file(_ name: String) -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID)?.appendingPathComponent(name)
    }

    private static let snapshotFile = "snapshot.json"
    private static let pendingFile = "pending-logs.json"

    static func loadSnapshot() -> WidgetSnapshot? {
        guard let url = file(snapshotFile), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    /// Saves the snapshot. Returns false when only the timestamp changed, so callers can skip reloading widgets.
    @discardableResult
    static func save(_ snapshot: WidgetSnapshot) -> Bool {
        guard let url = file(snapshotFile) else { return false }
        if var old = loadSnapshot() {
            var new = snapshot
            old.generatedAt = 0
            new.generatedAt = 0
            if old == new { return false }
        }
        guard let data = try? JSONEncoder().encode(snapshot) else { return false }
        return (try? data.write(to: url, options: .atomic)) != nil
    }

    static func pendingLogs() -> [WidgetLog] {
        var logs: [WidgetLog] = []
        updatePendingLogs { logs = $0 }
        return logs
    }

    /// Read-modify-write of the queue, coordinated so the app and a widget can't overwrite each other.
    static func updatePendingLogs(_ change: (inout [WidgetLog]) -> Void) {
        guard let url = file(pendingFile) else { return }
        var error: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forMerging, error: &error) { url in
            let before = (try? Data(contentsOf: url)).flatMap { try? JSONDecoder().decode([WidgetLog].self, from: $0) } ?? []
            var logs = before
            change(&logs)
            if logs != before, let data = try? JSONEncoder().encode(logs) {
                try? data.write(to: url, options: .atomic)
            }
        }
    }

    static func notifyApp() {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(pendingLogsNotification as CFString), nil, nil, true)
    }
}
