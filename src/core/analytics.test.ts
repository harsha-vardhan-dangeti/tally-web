import { describe, expect, it } from "vitest";
import type { Expense } from "../data/store";
import {
  categoryBreakdown, cumulative, insights, monthStats, monthlyTotals, paymentSplit, spentThroughDay, topMerchants, weekdayAverages,
} from "./analytics";

let n = 0;
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const ex = (when: number, amount: number, over: Partial<Expense> = {}): Expense => ({
  id: `e${n++}`, amount, merchant: "", note: "", category: "food", account: "UPI", occurredAt: when, createdAt: when,
  source: "manual", pending: false, splitWays: 1, splitWith: "", exclude: false, recurring: false, ...over,
});
const now = new Date(2026, 9, 24, 15); // Sat 24 Oct 2026

describe("monthStats", () => {
  const list = [
    ex(at(2026, 10, 1), 10_000),
    ex(at(2026, 10, 1), 30_000, { splitWays: 3 }),      // your share 10,000
    ex(at(2026, 10, 10), 50_000, { merchant: "Myntra", category: "shopping" }),
    ex(at(2026, 10, 24), 5_000),
    ex(at(2026, 10, 12), 99_000, { pending: true }),
    ex(at(2026, 10, 13), 99_000, { exclude: true }),
    ex(at(2026, 9, 30), 70_000),
  ];

  it("totals your share for the current month and projects month end", () => {
    const s = monthStats(list, now, now);
    expect(s).toMatchObject({ isCurrent: true, days: 31, elapsed: 24, total: 75_000, count: 4, dailyAvg: 3125, projected: 96_875 });
    expect(s.daily[0]).toBe(20_000);
    expect(s.biggest?.merchant).toBe("Myntra");
    // Days 1–23 have passed; spending on the 1st and 10th, so 21 no-spend days. Today doesn't count yet.
    expect(s.noSpendDays).toBe(21);
  });

  it("treats a finished month as whole, with no projection", () => {
    const s = monthStats(list, new Date(2026, 8, 1), now);
    expect(s).toMatchObject({ isCurrent: false, elapsed: 30, total: 70_000, projected: null, noSpendDays: 29 });
  });

  it("builds running totals and like-for-like comparisons", () => {
    expect(cumulative([1, 0, 2, 3])).toEqual([1, 1, 3, 6]);
    expect(spentThroughDay(list, now, 9)).toBe(20_000);
    expect(spentThroughDay(list, new Date(2026, 8, 1), 31)).toBe(70_000); // clipped to 30 Sept
  });

  it("lists monthly totals oldest first", () => {
    expect(monthlyTotals(list, now, 3).map((m) => m.total)).toEqual([0, 70_000, 75_000]);
  });
});

describe("categoryBreakdown", () => {
  it("compares each category with its average over earlier months and shows budgets", () => {
    const list = [
      ex(at(2026, 8, 5), 60_000), ex(at(2026, 9, 5), 30_000),        // food: Aug, Sept
      ex(at(2026, 10, 5), 80_000),
      ex(at(2026, 10, 6), 20_000, { category: "transport" }),
    ];
    const rows = categoryBreakdown(list, now, [{ category: "health", limit: 100_000 }]);
    expect(rows.map((r) => r.category)).toEqual(["food", "transport", "health"]);
    // Two months of history (Aug, Sept): food averages 45,000.
    expect(rows[0]).toMatchObject({ total: 80_000, share: 0.8, average: 45_000, limit: null });
    expect(rows[2]).toMatchObject({ total: 0, limit: 100_000 });
  });

  it("has no average for someone in their first month", () => {
    expect(categoryBreakdown([ex(at(2026, 10, 5), 1000)], now, [])[0].average).toBeNull();
  });
});

describe("weekdayAverages", () => {
  it("averages each weekday over the days since logging began", () => {
    // Logging began Mon 12 Oct; window runs to Sat 24 Oct: two Mondays, two Saturdays.
    const list = [ex(at(2026, 10, 12), 40_000), ex(at(2026, 10, 17), 10_000), ex(at(2026, 10, 24), 30_000)];
    const rows = weekdayAverages(list, now);
    expect(rows[0]).toMatchObject({ weekday: 0, total: 40_000, average: 20_000 });
    expect(rows[5]).toMatchObject({ weekday: 5, total: 40_000, average: 20_000 });
    expect(rows[6].average).toBe(0);
  });
});

describe("topMerchants and paymentSplit", () => {
  const [start, end] = [new Date(2026, 9, 1), new Date(2026, 10, 1)];
  const list = [
    ex(at(2026, 10, 2), 10_000, { merchant: "Starbucks" }),
    ex(at(2026, 10, 3), 12_000, { merchant: "starbucks ", account: "Credit card" }),
    ex(at(2026, 10, 4), 50_000, { note: "Rent share", category: "bills", account: "Cash" }),
    ex(at(2026, 10, 5), 1_000, { category: "transport", account: "Wallet" }),
    ex(at(2026, 10, 6), 2_000, { account: "Gift card" }),
  ];

  it("groups merchants regardless of case and spacing", () => {
    expect(topMerchants(list, start, end, 2)).toEqual([
      { name: "Rent share", count: 1, total: 50_000, category: "bills" },
      { name: "Starbucks", count: 2, total: 22_000, category: "food" },
    ]);
  });

  it("folds accounts past the fourth into Other", () => {
    expect(paymentSplit(list, start, end)).toEqual([
      { account: "Cash", total: 50_000 }, { account: "Credit card", total: 12_000 }, { account: "UPI", total: 10_000 },
      { account: "Other", total: 3_000 },
    ]);
  });
});

describe("insights", () => {
  it("warns when the month is on pace to go over budget and says what to keep to", () => {
    const list = Array.from({ length: 24 }, (_, i) => ex(at(2026, 10, i + 1), 300_000));
    const [first] = insights(list, now, now, 7_000_000, []);
    expect(first.tone).toBe("warn");
    expect(first.title).toBe("On pace to go ₹23,000 over budget");
    // 69,000 spent before today, 1,000 left for 8 days → ₹125 a day.
    expect(first.detail).toContain("Keep to ₹125 a day");
  });

  it("flags a category running well above its usual level", () => {
    const list = [ex(at(2026, 9, 10), 100_000), ex(at(2026, 10, 10), 200_000)];
    const found = insights(list, now, now, 0, []).find((i) => i.title.startsWith("Food"));
    // Usual is ₹1,000 a month; 24 of 31 days in, about ₹774 is expected and ₹2,000 is spent.
    expect(found).toMatchObject({ tone: "warn", title: "Food is up 158% on your usual" });
  });
});
