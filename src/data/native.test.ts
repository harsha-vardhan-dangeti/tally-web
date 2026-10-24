import { describe, expect, it } from "vitest";
import { applyWidgetLogs, buildWidgetSnapshot } from "./native";
import { getState, type Expense, type State } from "./store";

const now = new Date(2026, 9, 24, 15, 0);
const expense = (over: Partial<Expense>): Expense => ({
  id: Math.random().toString(36), amount: 10_000, merchant: "", note: "", category: "food", account: "UPI",
  occurredAt: now.getTime(), createdAt: now.getTime(), source: "manual", pending: false, splitWays: 1, splitWith: "",
  exclude: false, recurring: false, ...over,
});
const state = (over: Partial<State>): State => ({ ...getState(), ready: true, ...over });

describe("buildWidgetSnapshot", () => {
  it("totals this month and today by your share, skipping pending and excluded", () => {
    const snap = buildWidgetSnapshot(state({
      settings: { ...getState().settings, monthlyBudget: 5_500_000 },
      expenses: [
        expense({ amount: 35_000, splitWays: 2 }),                                       // today, your share 17,500
        expense({ amount: 60_000, category: "transport", occurredAt: new Date(2026, 9, 2).getTime() }),
        expense({ amount: 99_999, pending: true }),
        expense({ amount: 88_888, exclude: true }),
        expense({ amount: 50_000, occurredAt: new Date(2026, 8, 30).getTime() }),     // last month
      ],
    }), now);
    expect(snap).toMatchObject({ month: "2026-10", today: "2026-10-24", budget: 5_500_000, spentMonth: 77_500, spentToday: 17_500, pendingInbox: 1 });
    expect(snap.categories.map((c) => c.id)).toEqual(["transport", "food"]);
  });

  it("orders bills by next due date", () => {
    const bill = (id: string, day: number) => ({ id, name: id, amount: 100, prevAmount: 100, day, category: "bills" as const,
      account: "", isSubscription: false, autoLog: false, lastLoggedMonth: "" });
    const snap = buildWidgetSnapshot(state({ bills: [bill("rent", 5), bill("netflix", 28), bill("wifi", 24)] }), now);
    expect(snap.bills.map((b) => b.id)).toEqual(["wifi", "netflix", "rent"]);
  });
});

describe("applyWidgetLogs", () => {
  it("adds each widget log once, even when delivered twice", () => {
    const log = { id: "widget-log-1", title: "Coffee", amount: 18_000, category: "food", loggedAt: now.getTime() };
    expect(applyWidgetLogs([log])).toEqual(["widget-log-1"]);
    expect(applyWidgetLogs([log])).toEqual(["widget-log-1"]);
    const added = getState().expenses.filter((e) => e.id === "widget-log-1");
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ amount: 18_000, note: "Coffee", source: "widget", occurredAt: now.getTime() });
  });

  it("ignores logs without a valid amount and maps unknown categories to Other", () => {
    applyWidgetLogs([
      { id: "bad", title: "x", amount: -5, category: "food", loggedAt: 1 },
      { id: "odd", title: "Thing", amount: 500, category: "snacks", loggedAt: 1 },
    ]);
    expect(getState().expenses.some((e) => e.id === "bad")).toBe(false);
    expect(getState().expenses.find((e) => e.id === "odd")?.category).toBe("other");
  });
});
