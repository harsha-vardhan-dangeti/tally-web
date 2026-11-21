import { describe, expect, it } from "vitest";
import {
  addExpense, addTransfer, cardLimitUsage, cardStatus, deleteExpense, deleteTransfer, getState, liveBalance, runDueCardPayments, saveAccount, saveIncome,
  updateExpense,
} from "./store";

const acct = (id: string) => getState().accounts.find((a) => a.id === id)!;
const today = new Date();
// A fixed day in this month, so the statement (10th) and due date (28th) fall the same way whenever this runs.
const on = (day: number, hour = 12) => new Date(today.getFullYear(), today.getMonth(), day, hour);

describe("a credit card's balance", () => {
  it("goes up with each purchase, backdated or not, follows edits, and goes back down when one is deleted", () => {
    saveAccount({ id: "ace", name: "Axis Ace", kind: "card", balance: 10_000_00, order: 0, updatedAt: Date.now() - 1000, tracked: true, limit: 50_000_00 });
    const owed = () => liveBalance(acct("ace"));
    const a = addExpense({ amount: 1_500_00, category: "food", merchant: "Swiggy", account: "Axis Ace", source: "manual" });
    expect(owed()).toBe(11_500_00);
    // Bought ten days ago, logged now.
    const b = addExpense({ amount: 2_000_00, category: "shopping", merchant: "Myntra", account: "Axis Ace", source: "manual", occurredAt: Date.now() - 10 * 86_400_000 });
    expect(owed()).toBe(13_500_00);
    expect(cardLimitUsage(acct("ace"))).toMatchObject({ used: 13_500_00, available: 36_500_00 });
    updateExpense(a.id, { amount: 1_000_00 });
    expect(owed()).toBe(13_000_00);
    // Moved to another account: off this card.
    updateExpense(b.id, { account: "UPI" });
    expect(owed()).toBe(11_000_00);
    deleteExpense(a.id, false);
    expect(owed()).toBe(10_000_00);
    // A refund to the card lowers what's owed.
    saveIncome({ id: "refund", amount: 700_00, source: "Refund", note: "", account: "Axis Ace", receivedAt: Date.now(), createdAt: Date.now() });
    expect(owed()).toBe(9_300_00);
  });

  it("splits into the bill and what's spent since the statement, and a payment clears the bill", () => {
    saveAccount({ id: "bank", name: "HDFC Bank", kind: "bank", balance: 1_00_000_00, order: 1, updatedAt: Date.now() - 1000, tracked: true });
    saveAccount({ id: "visa", name: "Visa", kind: "card", balance: 0, order: 2, updatedAt: Date.now() - 1000, tracked: true, statementDay: 10, dueDay: 28 });
    addExpense({ amount: 4_000_00, category: "shopping", merchant: "Amazon", account: "Visa", source: "manual", occurredAt: on(5).getTime() });
    addExpense({ amount: 1_000_00, category: "food", merchant: "Zomato", account: "Visa", source: "manual", occurredAt: on(12).getTime() });
    const visa = () => acct("visa");
    expect(liveBalance(visa())).toBe(5_000_00);
    const bill = cardStatus(visa(), getState(), on(16));
    expect(bill?.due?.amount).toBe(4_000_00);
    expect(bill?.due?.date.getDate()).toBe(28);
    expect(bill?.unbilled).toBe(1_000_00);

    const pay = addTransfer({ fromId: "bank", toId: "visa", amount: 4_000_00, note: "Visa bill", occurredAt: on(16).getTime() })!;
    expect(liveBalance(visa())).toBe(1_000_00);
    expect(liveBalance(acct("bank"))).toBe(96_000_00);
    expect(cardStatus(visa(), getState(), on(16))?.due).toBeNull();
    // Removing the payment brings the bill back.
    deleteTransfer(pay.id, false);
    expect(liveBalance(visa())).toBe(5_000_00);
    expect(liveBalance(acct("bank"))).toBe(1_00_000_00);
    expect(cardStatus(visa(), getState(), on(16))?.due?.amount).toBe(4_000_00);
  });

  it("pays itself on the due date, once", () => {
    saveAccount({ ...acct("visa"), autoPay: true, payFrom: "bank" });
    runDueCardPayments(on(28, 11));
    runDueCardPayments(on(28, 18));
    const payments = getState().transfers.filter((t) => t.toId === "visa");
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(4_000_00);
    expect(liveBalance(acct("visa"))).toBe(1_000_00);
    expect(liveBalance(acct("bank"))).toBe(96_000_00);
  });

  it("on a card that doesn't follow transactions, only payments move it", () => {
    saveAccount({ id: "amex", name: "Amex", kind: "card", balance: 8_000_00, order: 3, updatedAt: Date.now() - 1000 });
    addExpense({ amount: 900_00, category: "food", merchant: "Starbucks", account: "Amex", source: "manual" });
    expect(liveBalance(acct("amex"))).toBe(8_000_00);
    addTransfer({ fromId: "bank", toId: "amex", amount: 3_000_00, note: "", occurredAt: Date.now() });
    expect(liveBalance(acct("amex"))).toBe(5_000_00);
  });
});
