import { describe, expect, it } from "vitest";
import { addExpense, getState, liveBalance, saveAccount, unlinkedGroups } from "./store";

describe("a bill someone else paid", () => {
  it("isn't put on any of your accounts", () => {
    const now = Date.now();
    saveAccount({ id: "hdfc", name: "HDFC Bank", kind: "bank", balance: 10_000_00, order: 0, updatedAt: now - 3_600_000, tracked: true });
    const theirs = addExpense({ amount: 1_200_00, merchant: "Electricity", category: "bills", source: "manual", splitWays: 3, splitWith: "Ravi, Priya", paidBy: "Ravi", account: null, group: "flat" });
    const mine = addExpense({ amount: 900_00, merchant: "Groceries", category: "groceries", source: "manual", splitWays: 3, splitWith: "Ravi, Priya", account: "HDFC Bank", group: "flat" });
    expect(theirs.account).toBe("");
    expect(mine.account).toBe("HDFC Bank");
    // Only your own bill comes out of HDFC, and Ravi's isn't flagged as needing an account.
    expect(liveBalance(getState().accounts.find((a) => a.id === "hdfc")!)).toBe(9_100_00);
    expect(unlinkedGroups().flatMap((g) => g.expenses).some((e) => e.id === theirs.id)).toBe(false);
  });
});
