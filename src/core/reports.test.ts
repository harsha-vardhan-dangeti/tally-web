import { describe, expect, it } from "vitest";
import { groupSpending, monthlyCashFlow, netWorthSeries, periodRange, savingsRate } from "./reports";
import type { Account, Expense, Income } from "../data/store";

const at = (m: number, d: number) => new Date(2026, m - 1, d, 12).getTime();
const exp = (over: Partial<Expense>): Expense => ({
  id: Math.random().toString(36), amount: 10_000, merchant: "", note: "", category: "food", account: "UPI", occurredAt: at(10, 5), createdAt: 0,
  source: "manual", pending: false, splitWays: 1, splitWith: "", exclude: false, recurring: false, ...over,
});
const inc = (amount: number, m: number): Income => ({ id: Math.random().toString(36), amount, source: "Salary", note: "", account: "HDFC", receivedAt: at(m, 1), createdAt: 0 });

describe("reports", () => {
  const now = new Date(2026, 9, 20);

  it("turns periods into date ranges", () => {
    const [a, b] = periodRange("3m", now);
    expect([a.getMonth(), b.getMonth()]).toEqual([7, 10]);
    const [c, d] = periodRange("custom", now, { from: new Date(2026, 9, 10), to: new Date(2026, 9, 3) });
    expect([c.getDate(), d.getDate()]).toEqual([3, 11]);
  });

  it("groups spending by category, place or payment method, counting only your share", () => {
    const list = [
      exp({ merchant: "Swiggy", amount: 60_000, splitWays: 2 }), exp({ merchant: "swiggy", amount: 20_000 }),
      exp({ merchant: "Uber", category: "transport", amount: 50_000, account: "Card" }),
    ];
    expect(groupSpending(list, "category").map((r) => [r.key, r.total, r.count])).toEqual([["food", 50_000, 2], ["transport", 50_000, 1]]);
    expect(groupSpending(list, "merchant")[0]).toMatchObject({ label: "Swiggy", total: 50_000, count: 2, share: 0.5 });
    expect(groupSpending(list, "account").map((r) => r.key)).toEqual(["UPI", "Card"]);
  });

  it("works out cash flow month by month, leaving out pending and excluded spending", () => {
    const flow = monthlyCashFlow(
      [exp({ amount: 30_000, occurredAt: at(9, 3) }), exp({ amount: 99_999, occurredAt: at(9, 4), pending: true }), exp({ amount: 40_000 })],
      [inc(100_000, 9), inc(100_000, 10)],
      periodRange("last-month", now).map((d, i) => (i === 0 ? d : new Date(2026, 10, 1))) as [Date, Date],
    );
    expect(flow.map((f) => [f.month.getMonth(), f.income, f.spending, f.net])).toEqual([[8, 100_000, 30_000, 70_000], [9, 100_000, 40_000, 60_000]]);
    expect(savingsRate(100_000, 40_000)).toBe(0.6);
    expect(savingsRate(0, 40_000)).toBeNull();
  });

  it("builds net worth over time from each account's monthly balances", () => {
    const accounts: Account[] = [
      { id: "b", name: "HDFC", kind: "bank", balance: 500_000, order: 0, updatedAt: new Date(2026, 9, 10).getTime(), history: { "2026-08": 300_000, "2026-09": 400_000 } },
      { id: "c", name: "Card", kind: "card", balance: 50_000, order: 1, updatedAt: new Date(2026, 9, 2).getTime(), history: { "2026-09": 80_000 } },
    ];
    expect(netWorthSeries(accounts, now, 4).map((p) => p.net)).toEqual([0, 300_000, 320_000, 450_000]);
  });
});
