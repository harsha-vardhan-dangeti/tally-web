import { describe, expect, it } from "vitest";
import { cardUsage } from "../core/cards";
import {
  addExpense, cardLimitUsage, convertToEmi, deleteLoan, getState, liveBalance, monthSpent, saveAccount, scheduledFlows, type Account,
} from "./store";

describe("card purchases on EMI", () => {
  it("counts EMI principal against the limit", () => {
    expect(cardUsage(10_000_00, 1_00_000_00, 30_000_00)).toMatchObject({ used: 40_000_00, onEmi: 30_000_00, available: 60_000_00 });
  });

  it("moves the purchase off the card and the budget, charges EMIs instead, and can be undone", () => {
    const now = new Date();
    const card: Account = { id: "amex", name: "Amex", kind: "card", balance: 5_000_00, order: 0, updatedAt: now.getTime() - 60_000,
      tracked: true, limit: 1_00_000_00 };
    saveAccount(card);
    const spentBefore = monthSpent(getState().expenses, now);
    const phone = addExpense({ amount: 60_000_00, category: "shopping", merchant: "Phone", account: "Amex", source: "manual" });
    const amex = () => getState().accounts.find((a) => a.id === "amex")!;
    expect(liveBalance(amex())).toBe(65_000_00);
    expect(monthSpent(getState().expenses, now) - spentBefore).toBe(60_000_00);

    const first = new Date(now.getFullYear(), now.getMonth() + 1, 5, 12);
    const loan = convertToEmi(phone, { months: 6, ratePct: 0, fee: 0, firstDueAt: first.getTime() })!;
    expect(loan.emi).toBe(10_000_00);
    // Off the card's balance, still blocking the limit, out of this month's budget.
    expect(liveBalance(amex())).toBe(5_000_00);
    expect(cardLimitUsage(amex())).toMatchObject({ used: 65_000_00, onEmi: 60_000_00, available: 35_000_00 });
    expect(monthSpent(getState().expenses, now) - spentBefore).toBe(0);
    // The first EMI shows up under the card in Plan.
    const emiFlow = scheduledFlows(getState(), now, 45).find((f) => f.kind === "emi" && f.ref === loan.id);
    expect(emiFlow).toMatchObject({ account: "Amex", amount: 10_000_00, direction: "out" });

    // A second conversion of the same purchase isn't possible.
    expect(convertToEmi(getState().expenses.find((x) => x.id === phone.id)!, { months: 3, ratePct: 0, fee: 0, firstDueAt: first.getTime() })).toBeNull();

    deleteLoan(loan.id);
    const back = getState().expenses.find((x) => x.id === phone.id)!;
    expect(back.emiLoan).toBeUndefined();
    expect(back.exclude).toBe(false);
    expect(liveBalance(amex())).toBe(65_000_00);
  });

  it("takes a processing fee and, for a purchase already in the card's balance, lowers that balance", () => {
    const now = new Date();
    const purchase = addExpense({ amount: 24_000_00, category: "shopping", merchant: "Laptop", account: "Visa", source: "manual",
      occurredAt: now.getTime() - 3_600_000 });
    // The balance was set after the purchase, so it already includes it.
    saveAccount({ id: "visa", name: "Visa", kind: "card", balance: 30_000_00, order: 1, updatedAt: now.getTime() - 60_000, tracked: true, limit: 50_000_00 });
    const visa = () => getState().accounts.find((a) => a.id === "visa")!;
    convertToEmi(purchase, { months: 12, ratePct: 15, fee: 199_00, firstDueAt: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() });
    // ₹30,000 − ₹24,000 moved to EMI + ₹199 fee charged now.
    expect(liveBalance(visa())).toBe(6_199_00);
    expect(cardLimitUsage(visa())?.onEmi).toBe(24_000_00);
  });
});
