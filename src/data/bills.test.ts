import { describe, expect, it } from "vitest";
import {
  addExpense, cancelBill, cancelledSavings, chargedAfterCancel, getState, logBill, restartBill, runDueBills, saveBill, scheduledFlows, unlinkedGroups, type Bill,
} from "./store";

const bill = (over: Partial<Bill>): Bill => ({
  id: "b", name: "Rent", amount: 2_500_000, prevAmount: 2_500_000, day: 5, category: "bills", account: "UPI",
  isSubscription: false, autoLog: true, lastLoggedMonth: "", ...over,
});
const loggedFor = (id: string) => getState().expenses.filter((e) => e.id.startsWith(`bill-${id}-`));

describe("bills become expenses", () => {
  const oct24 = new Date(2026, 9, 24, 15);

  it("logs a bill once per month, however often it's asked", () => {
    saveBill(bill({ id: "rent" }));
    logBill(getState().bills.find((b) => b.id === "rent")!, oct24);
    logBill(getState().bills.find((b) => b.id === "rent")!, oct24);
    runDueBills(oct24);
    expect(loggedFor("rent")).toHaveLength(1);
    expect(loggedFor("rent")[0]).toMatchObject({ id: "bill-rent-2026-10", amount: 2_500_000, merchant: "Rent", source: "recurring" });
    expect(new Date(loggedFor("rent")[0].occurredAt).getDate()).toBe(5);
    expect(getState().bills.find((b) => b.id === "rent")!.lastLoggedMonth).toBe("2026-10");
  });

  it("adds auto-log bills once their due day has come, and leaves the rest", () => {
    saveBill(bill({ id: "due", day: 20 }));
    saveBill(bill({ id: "later", day: 28 }));
    saveBill(bill({ id: "manual", day: 3, autoLog: false }));
    runDueBills(oct24);
    expect(loggedFor("due")).toHaveLength(1);
    expect(loggedFor("later")).toHaveLength(0);
    expect(loggedFor("manual")).toHaveLength(0);
  });

  it("dates a payment logged before its due day as today, not in the future", () => {
    saveBill(bill({ id: "early", day: 28, autoLog: false }));
    logBill(getState().bills.find((b) => b.id === "early")!, oct24);
    expect(loggedFor("early")[0].occurredAt).toBe(oct24.getTime());
  });

  it("logs again in the next month", () => {
    saveBill(bill({ id: "monthly", day: 1, lastLoggedMonth: "2026-10" }));
    runDueBills(new Date(2026, 10, 2, 10));
    expect(loggedFor("monthly").map((e) => e.id)).toEqual(["bill-monthly-2026-11"]);
  });
});

describe("cancelling a subscription", () => {
  const nov22 = new Date(2026, 10, 22, 10);
  const get = (id: string) => getState().bills.find((b) => b.id === id)!;

  it("stops it being due, reminded or added to expenses", () => {
    saveBill(bill({ id: "netflix", name: "Netflix", amount: 64_900, day: 10, isSubscription: true, lastLoggedMonth: "2026-09" }));
    cancelBill(get("netflix"), new Date(2026, 9, 5).getTime());
    runDueBills(nov22);
    expect(loggedFor("netflix")).toHaveLength(0);
    expect(scheduledFlows(getState(), nov22).some((f) => f.ref === "netflix")).toBe(false);
    expect(unlinkedGroups(getState()).some((g) => g.bills.some((b) => b.id === "netflix"))).toBe(false);
  });

  it("counts what it has saved: each due date since cancelling", () => {
    // Cancelled 5 Oct; 10 Oct and 10 Nov have passed by 22 Nov.
    expect(cancelledSavings(get("netflix"), nov22)).toEqual({ payments: 2, saved: 129_800 });
    expect(cancelledSavings(bill({ id: "x" }), nov22)).toEqual({ payments: 0, saved: 0 });
  });

  it("flags a charge from the merchant after cancelling, not Tally's own logged payments", () => {
    addExpense({ amount: 64_900, category: "fun", merchant: "NETFLIX.COM", occurredAt: new Date(2026, 10, 10).getTime(), source: "import" });
    addExpense({ id: "bill-netflix-2026-09", amount: 64_900, category: "fun", merchant: "Netflix", occurredAt: new Date(2026, 9, 20).getTime(), source: "recurring" });
    const late = chargedAfterCancel(get("netflix"));
    expect(late.map((e) => e.merchant)).toEqual(["NETFLIX.COM"]);
  });

  it("restarts from the next due date, without owing the ones it skipped", () => {
    restartBill(get("netflix"), nov22);
    const b = get("netflix");
    expect(b.cancelledAt).toBeUndefined();
    expect(b.lastLoggedMonth).toBe("2026-11"); // 10 Nov passed while cancelled
    runDueBills(nov22);
    expect(loggedFor("netflix").filter((e) => e.id !== "bill-netflix-2026-09")).toHaveLength(0);
    expect(scheduledFlows(getState(), nov22).find((f) => f.ref === "netflix")?.at).toBe(new Date(2026, 11, 10).getTime());
  });
});
