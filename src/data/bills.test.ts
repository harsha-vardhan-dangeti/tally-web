import { describe, expect, it } from "vitest";
import { getState, logBill, runDueBills, saveBill, type Bill } from "./store";

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
