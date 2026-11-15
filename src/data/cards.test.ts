import { describe, expect, it } from "vitest";
import { cardUsage } from "../core/cards";
import { cardStatus, getState, scheduledFlows, type Account, type Expense, type State } from "./store";

const d = (y: number, m: number, day: number, h = 12) => new Date(y, m - 1, day, h);
const base = getState();
const expense = (id: string, amount: number, account: string, at: Date): Expense => ({
  id, amount, account, occurredAt: at.getTime(), createdAt: at.getTime(), merchant: id, note: "", category: "food", source: "manual",
  pending: false, splitWays: 1, splitWith: "", exclude: false, recurring: false,
});
const state = (patch: Partial<State>): State => ({ ...base, ...patch, settings: { ...base.settings, ...(patch.settings ?? {}) } });

describe("card limits", () => {
  it("works out what's used and what's left", () => {
    expect(cardUsage(45_000_00, 1_50_000_00)).toMatchObject({ available: 1_05_000_00, tone: "high" });
    expect(cardUsage(10_000_00, 1_00_000_00)?.tone).toBe("ok");
    expect(cardUsage(85_000_00, 1_00_000_00)?.tone).toBe("near");
    expect(cardUsage(1_10_000_00, 1_00_000_00)).toMatchObject({ available: -10_000_00, tone: "over" });
    expect(cardUsage(5_000_00, undefined)).toBeNull();
  });
});

describe("card bills after a payment", () => {
  // Statement on the 5th, due on the 25th; ₹12,000 owed at the statement, ₹2,000 spent since.
  const card: Account = { id: "c", name: "Amex", kind: "card", balance: 12_000_00, order: 0, updatedAt: d(2026, 11, 6).getTime(),
    tracked: true, statementDay: 5, dueDay: 25, limit: 1_00_000_00 };
  const charge = expense("dinner", 2_000_00, "Amex", d(2026, 11, 10));
  it("shows the statement amount as due", () => {
    const bill = cardStatus(card, state({ accounts: [card], expenses: [charge] }), d(2026, 11, 14));
    expect(bill?.due?.amount).toBe(12_000_00);
    expect(bill?.unbilled).toBe(2_000_00);
  });
  it("shows nothing due once the bill is paid, leaving only what's unbilled", () => {
    // Paying ₹12,000 resets the card's balance to what's still owed: the ₹2,000 since the statement.
    const paid: Account = { ...card, balance: 2_000_00, updatedAt: d(2026, 11, 20).getTime() };
    const bill = cardStatus(paid, state({ accounts: [paid], expenses: [charge] }), d(2026, 11, 21));
    expect(bill?.due).toBeNull();
    expect(bill?.unbilled).toBe(2_000_00);
  });
});

describe("scheduled flows by account", () => {
  const bank: Account = { id: "b", name: "HDFC", kind: "bank", balance: 50_000_00, order: 0, updatedAt: d(2026, 11, 1).getTime(), tracked: true };
  const card: Account = { id: "c", name: "Amex", kind: "card", balance: 12_000_00, order: 1, updatedAt: d(2026, 11, 6).getTime(),
    tracked: true, statementDay: 5, dueDay: 25, autoPay: true, payFrom: "b" };
  it("lists bills, transfers, income and card payments under the account each uses", () => {
    const s = state({
      accounts: [bank, card],
      bills: [
        { id: "rent", name: "Rent", amount: 15_000_00, prevAmount: 15_000_00, day: 1, category: "bills", account: "HDFC", isSubscription: false, autoLog: true, lastLoggedMonth: "2026-11" },
        { id: "nf", name: "Netflix", amount: 649_00, prevAmount: 649_00, day: 20, category: "fun", account: "Amex", isSubscription: true, autoLog: true, lastLoggedMonth: "" },
      ],
      recurringIncomes: [{ id: "sal", source: "Salary", amount: 90_000_00, day: 30, account: "HDFC", note: "", autoLog: true, lastLoggedMonth: "" }],
      settings: { ...base.settings, scheduledTransfers: [{ id: "sip", fromId: "b", toId: "c", amount: 1_000_00, day: 28, note: "SIP", lastLoggedMonth: "" }] },
    });
    const flows = scheduledFlows(s, d(2026, 11, 14), 30);
    const summary = flows.map((f) => `${f.account}:${f.direction}:${f.label}:${new Date(f.at).getDate()}`);
    expect(summary).toEqual([
      "Amex:out:Netflix:20",
      "HDFC:out:Amex bill:25", "Amex:in:Bill payment:25",
      "HDFC:out:SIP:28", "Amex:in:SIP:28",
      "HDFC:in:Salary:30",
      "HDFC:out:Rent:1", // November's rent is already in, so December's is next
    ]);
    expect(flows.find((f) => f.label === "Amex bill")?.amount).toBe(12_000_00);
  });
});
