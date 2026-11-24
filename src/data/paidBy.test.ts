import { describe, expect, it } from "vitest";
import { addExpense, clearPaidByAccounts, getState, liveBalance, saveAccount, unlinkedGroups, updateExpense } from "./store";
import { groupSpending } from "../core/reports";

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

  it("loses the account an older version saved on it, and Reports group it as paid by others", () => {
    // As an older version saved it: Ravi paid, but your default account is on it.
    const old = addExpense({ amount: 600_00, merchant: "Wifi", category: "bills", source: "manual", splitWays: 2, splitWith: "Ravi", paidBy: "Ravi", account: "HDFC Bank" });
    updateExpense(old.id, { account: "HDFC Bank" });
    expect(getState().expenses.find((e) => e.id === old.id)?.account).toBe("HDFC Bank");
    const byMethod = () => groupSpending(getState().expenses, "account").map((g) => g.label);
    expect(byMethod()).toContain("Paid by others");
    expect(clearPaidByAccounts()).toBeGreaterThan(0);
    expect(getState().expenses.find((e) => e.id === old.id)?.account).toBe("");
    expect(clearPaidByAccounts()).toBe(0);
    expect(getState().expenses.filter((e) => e.paidBy).every((e) => e.account === "")).toBe(true);
  });
});
