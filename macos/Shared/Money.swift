import Foundation

/// Rupee formatting, ported from src/core/money.ts: "₹1,23,456" with Indian digit grouping.
enum Money {
    static func format(_ paise: Int) -> String {
        let rupees = abs(paise) / 100
        let text = "₹" + groupIndian(rupees)
        return paise < 0 ? "−" + text : text
    }

    static func groupIndian(_ value: Int) -> String {
        let digits = String(value)
        guard digits.count > 3 else { return digits }
        var head = String(digits.dropLast(3))
        var groups: [String] = []
        while head.count > 2 {
            groups.insert(String(head.suffix(2)), at: 0)
            head = String(head.dropLast(2))
        }
        if !head.isEmpty { groups.insert(head, at: 0) }
        return (groups + [String(digits.suffix(3))]).joined(separator: ",")
    }
}
