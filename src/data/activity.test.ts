import { describe, expect, it } from "vitest";
import { activityItems, ledgerTitle } from "./activity";
import { billPayments, type Account, type Bill, type Expense, type Income, type LedgerEntry, type Transfer } from "./store";

const at = (day: number, h = 12) => new Date(2026, 10, day, h).getTime();
const expense = (id: string, day: number, o: Partial<Expense> = {}): Expense => ({
  id, amount: 500_00, account: "HDFC Bank", occurredAt: at(day), createdAt: at(day), merchant: id, note: "", category: "food", source: "manual",
  pending: false, splitWays: 1, splitWith: "", exclude: false, recurring: false, ...o,
});
const accounts: Account[] = [
  { id: "hdfc", name: "HDFC Bank", kind: "bank", balance: 0, order: 0, updatedAt: 0 },
  { id: "amex", name: "Amex", kind: "card", balance: 0, order: 1, updatedAt: 0 },
];
const income: Income = { id: "sal", amount: 90_000_00, source: "Salary", note: "", account: "HDFC Bank", receivedAt: at(1), createdAt: at(1) };
const transfer: Transfer = { id: "pay", fromId: "hdfc", toId: "amex", fromName: "HDFC Bank", toName: "Old name", amount: 12_000_00, note: "Card bill", occurredAt: at(5), createdAt: at(5) };
const ledger = (id: string, kind: LedgerEntry["kind"], amount: number, day: number): LedgerEntry =>
  ({ id, person: "Ravi", amount, kind, note: "", occurredAt: at(day), createdAt: at(day) });

describe("the Activity list", () => {
  const s = {
    accounts, incomes: [income], transfers: [transfer],
    expenses: [expense("lunch", 3), expense("later", 9, { pending: true }), expense("october", 1, { occurredAt: new Date(2026, 9, 20).getTime() })],
    ledger: [ledger("back", "settled", -300_00, 7), ledger("paid", "settled", 200_00, 8), ledger("lent", "lent", 1_000_00, 2), ledger("zero", "settled", 0, 4)],
  };
  const items = activityItems(s, new Date(2026, 10, 1).getTime(), new Date(2026, 11, 1).getTime());

  it("has expenses, income, transfers and money with people for the month, newest first", () => {
    expect(items.map((x) => x.key)).toEqual(["l-paid", "l-back", "t-pay", "e-lunch", "l-lent", "i-sal"]);
  });
  it("names a transfer's accounts as they're called now, and says which way money with people went", () => {
    const t = items.find((x) => x.kind === "transfer");
    expect(t && t.kind === "transfer" && `${t.from} → ${t.to}`).toBe("HDFC Bank → Amex");
    const people = Object.fromEntries(items.flatMap((x) => (x.kind === "people" ? [[x.entry.id, [x.title, x.amount]]] : [])));
    expect(people).toEqual({
      back: ["Ravi paid you back", 300_00], paid: ["You paid Ravi back", -200_00], lent: ["Lent to Ravi", -1_000_00],
    });
    expect(ledgerTitle({ kind: "borrowed", person: "Priya", amount: -50_00 })).toBe("Borrowed from Priya");
  });
});

describe("a bill's payments", () => {
  const bill: Bill = { id: "nf", name: "Netflix", amount: 649_00, prevAmount: 0, day: 25, category: "entertainment", account: "Amex", isSubscription: true, autoLog: true, lastLoggedMonth: "" };
  it("are the ones Tally logged for it and ones logged under its name", () => {
    const list = [
      expense("bill-nf-2026-10", 25, { merchant: "Netflix", amount: 649_00 }),
      expense("manual", 26, { merchant: "netflix.com", amount: 649_00 }),
      expense("other", 26, { merchant: "Spotify" }),
    ];
    expect(billPayments(bill, list).map((e) => e.id)).toEqual(["bill-nf-2026-10", "manual"]);
  });
});
