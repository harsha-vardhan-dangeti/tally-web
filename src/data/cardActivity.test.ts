import { describe, expect, it } from "vitest";
import { cardPeriods } from "../core/cards";
import {
  addExpense, addTransfer, cardActivity, cardSpendByMonth, getState, importTransactions, linkToCard, liveBalance, resolveAccount, saveAccount, unlinkedCardExpenses,
  type Expense,
} from "./store";

/** As if the expense had been recorded when it happened. */
const olderThanBalance = (e: Expense) => { void importTransactions([{ ...e, createdAt: e.occurredAt }], []); return e; };

const card = (id: string) => getState().accounts.find((a) => a.id === id)!;

describe("billing periods", () => {
  it("runs statement to statement, or by calendar month without a statement day", () => {
    const now = new Date(2026, 10, 16);
    const p = cardPeriods(20, 3, now);
    expect(p.map((x) => [x.start.toDateString(), x.end.toDateString()])).toEqual([
      [new Date(2026, 7, 20).toDateString(), new Date(2026, 8, 20).toDateString()],
      [new Date(2026, 8, 20).toDateString(), new Date(2026, 9, 20).toDateString()],
      [new Date(2026, 9, 20).toDateString(), new Date(2026, 10, 20).toDateString()],
    ]);
    const m = cardPeriods(undefined, 2, now);
    expect(m[1].start.toDateString()).toBe(new Date(2026, 10, 1).toDateString());
    expect(m[1].end.toDateString()).toBe(new Date(2026, 11, 1).toDateString());
    // A statement day past the month's end falls on its last day.
    expect(cardPeriods(31, 1, new Date(2026, 1, 10))[0].start.toDateString()).toBe(new Date(2026, 0, 31).toDateString());
  });
});

describe("expenses paid by credit card", () => {
  it("go on your card when you have just one, and stay unlinked when you have several", () => {
    const now = Date.now();
    saveAccount({ id: "hdfc", name: "HDFC Regalia", kind: "card", balance: 0, order: 0, updatedAt: now - 60_000, tracked: true, limit: 1_00_000_00 });
    expect(resolveAccount("Credit card")).toBe("HDFC Regalia");
    const e = addExpense({ amount: 1_200_00, category: "food", merchant: "Swiggy", account: "Credit card", source: "manual" });
    expect(e.account).toBe("HDFC Regalia");
    expect(liveBalance(card("hdfc"))).toBe(1_200_00);

    saveAccount({ id: "amex", name: "Amex", kind: "card", balance: 0, order: 1, updatedAt: now - 60_000, tracked: true });
    expect(resolveAccount("Credit card")).toBe("Credit card");
    expect(resolveAccount("UPI")).toBe("UPI");
    const loose = addExpense({ amount: 800_00, category: "shopping", merchant: "Myntra", account: "Credit card", source: "manual" });
    expect(loose.account).toBe("Credit card");
    expect(unlinkedCardExpenses().map((x) => x.id)).toContain(loose.id);
  });

  it("can be moved onto a card, with earlier ones added to the balance only when asked, and undone", () => {
    const now = Date.now();
    saveAccount({ id: "sbi", name: "SBI Card", kind: "card", balance: 5_000_00, order: 2, updatedAt: now - 3_600_000, tracked: true });
    // Recorded two hours ago, before the card's balance was entered.
    const before = olderThanBalance(addExpense({ amount: 2_000_00, category: "fun", merchant: "BookMyShow", account: "Credit card", source: "manual", occurredAt: now - 7_200_000 }));
    const after = addExpense({ amount: 500_00, category: "food", merchant: "Zomato", account: "Credit card", source: "manual", occurredAt: now - 60_000 });
    const sbi = () => liveBalance(card("sbi"));
    expect(sbi()).toBe(5_000_00);

    const undo = linkToCard("sbi", [before.id, after.id], false);
    expect(getState().expenses.find((x) => x.id === after.id)?.account).toBe("SBI Card");
    // Only the one after the balance was entered adds to it.
    expect(sbi()).toBe(5_500_00);
    undo();
    expect(sbi()).toBe(5_000_00);
    expect(getState().expenses.find((x) => x.id === before.id)?.account).toBe("Credit card");

    const undo2 = linkToCard("sbi", [before.id, after.id], true);
    expect(sbi()).toBe(7_500_00);
    undo2();
    expect(sbi()).toBe(5_000_00);
  });

  it("adds up a card's spending and payments by period and by category", () => {
    const now = new Date();
    saveAccount({ id: "icici", name: "ICICI Amazon", kind: "card", balance: 0, order: 3, updatedAt: now.getTime() - 40 * 86_400_000, tracked: true });
    saveAccount({ id: "bank", name: "Kotak", kind: "bank", balance: 50_000_00, order: 4, updatedAt: now.getTime() - 40 * 86_400_000, tracked: true });
    addExpense({ amount: 3_000_00, category: "groceries", merchant: "BigBasket", account: "ICICI Amazon", source: "manual", occurredAt: now.getTime() - 1000 });
    addExpense({ amount: 1_000_00, category: "food", merchant: "Swiggy", account: "ICICI Amazon", source: "manual", occurredAt: now.getTime() - 2000 });
    addExpense({ amount: 400_00, category: "food", merchant: "Shared dinner", account: "ICICI Amazon", source: "manual", paidBy: "Ravi", occurredAt: now.getTime() - 3000 });
    addTransfer({ fromId: "bank", toId: "icici", amount: 2_500_00, note: "Card bill", occurredAt: now.getTime() - 500 });

    const act = cardActivity(card("icici"), getState(), now, 3);
    expect(act.owed).toBe(1_500_00);
    expect(act.periods).toHaveLength(3);
    const cur = act.periods[2];
    // Someone else paid for the shared dinner: not on your card.
    expect(cur.spent).toBe(4_000_00);
    expect(cur.paid).toBe(2_500_00);
    expect(act.byCategory).toEqual([{ category: "groceries", amount: 3_000_00 }, { category: "food", amount: 1_000_00 }]);
    expect(act.payments).toHaveLength(1);

    const months = cardSpendByMonth(getState(), 2, now);
    expect(months).toHaveLength(2);
    expect(months[1].spent).toBeGreaterThanOrEqual(4_000_00);
  });
});
