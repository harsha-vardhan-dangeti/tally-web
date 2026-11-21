import { describe, expect, it } from "vitest";
import {
  accountItems, addExpense, addTransfer, getState, linkIncomes, saveLedgerEntry, liveBalance, resolveAccount, saveAccount, saveIncome, saveRecurringIncome, unlinkedIncomeRules, unlinkedIncomes,
} from "./store";

const acct = (id: string) => getState().accounts.find((a) => a.id === id)!;

describe("income and the account it lands in", () => {
  it("goes into your bank when it says “Bank” and you have one bank account", () => {
    const now = Date.now();
    // No accounts yet: "Bank" stays as it is, and isn't one of your accounts.
    saveIncome({ id: "old", amount: 50_000_00, source: "Salary", note: "", account: "Bank", receivedAt: now - 7_200_000, createdAt: now - 7_200_000 });
    saveIncome({ id: "upi", amount: 2_000_00, source: "Refund", note: "", account: "UPI", receivedAt: now - 60_000, createdAt: now });
    saveRecurringIncome({ id: "salary", source: "Salary", amount: 50_000_00, day: 1, account: "Bank", note: "", autoLog: true, lastLoggedMonth: "" });
    expect(getState().incomes.find((x) => x.id === "old")?.account).toBe("Bank");

    saveAccount({ id: "hdfc", name: "HDFC Bank", kind: "bank", balance: 10_000_00, order: 0, updatedAt: now - 3_600_000, tracked: true });
    expect(resolveAccount("Bank")).toBe("HDFC Bank");
    expect(resolveAccount("bank account")).toBe("HDFC Bank");
    expect(resolveAccount("UPI")).toBe("UPI");
    saveIncome({ id: "new", amount: 1_000_00, source: "Interest", note: "", account: "Bank", receivedAt: now - 1000, createdAt: now });
    expect(getState().incomes.find((x) => x.id === "new")?.account).toBe("HDFC Bank");
    expect(liveBalance(acct("hdfc"))).toBe(11_000_00);

    expect(unlinkedIncomes().map((x) => x.id).sort()).toEqual(["old", "upi"]);
    // The salary says "Bank": with one bank account, each month's lands there.
    expect(unlinkedIncomeRules()).toHaveLength(0);
    saveRecurringIncome({ id: "rent-in", source: "Rent from flat", amount: 15_000_00, day: 5, account: "UPI", note: "", autoLog: true, lastLoggedMonth: "" });
    expect(unlinkedIncomeRules().map((r) => r.id)).toEqual(["rent-in"]);
  });

  it("can be moved into an account, with income from before its balance added only when asked, and undone", () => {
    const hdfc = () => liveBalance(acct("hdfc"));
    const undo = linkIncomes("hdfc", ["old", "upi"], ["rent-in"], false);
    // Only the refund came after the balance was entered.
    expect(hdfc()).toBe(13_000_00);
    expect(getState().recurringIncomes.find((r) => r.id === "rent-in")?.account).toBe("HDFC Bank");
    expect(unlinkedIncomes()).toHaveLength(0);
    undo();
    expect(hdfc()).toBe(11_000_00);
    expect(getState().recurringIncomes.find((r) => r.id === "rent-in")?.account).toBe("UPI");

    const undo2 = linkIncomes("hdfc", ["old", "upi"], [], true);
    expect(hdfc()).toBe(63_000_00);
    undo2();
    expect(hdfc()).toBe(11_000_00);
  });
});

describe("an account's money in and out", () => {
  it("lists income, expenses, transfers and money lent through it, newest first, and which moved the balance", () => {
    const now = Date.now();
    saveAccount({ id: "axis", name: "Axis", kind: "bank", balance: 20_000_00, order: 5, updatedAt: now - 3_600_000, balanceSetAt: now - 3_600_000, tracked: true });
    saveAccount({ id: "wallet", name: "Wallet", kind: "cash", balance: 1_000_00, order: 6, updatedAt: now - 3_600_000, tracked: true });
    saveIncome({ id: "ax-old", amount: 40_000_00, source: "Salary", note: "", account: "Axis", receivedAt: now - 7_200_000, createdAt: now - 7_200_000 });
    saveIncome({ id: "ax-new", amount: 3_000_00, source: "Freelance", note: "Logo", account: "Axis", receivedAt: now - 5000, createdAt: now });
    addExpense({ amount: 1_200_00, category: "food", merchant: "Swiggy", account: "Axis", source: "manual", occurredAt: now - 4000 });
    addExpense({ amount: 900_00, category: "food", merchant: "Dinner", account: "Axis", source: "manual", paidBy: "Ravi", occurredAt: now - 3500 });
    saveLedgerEntry({ id: "ax-l", person: "Arun", amount: 500_00, kind: "lent", note: "", occurredAt: now - 2000, createdAt: now, account: "Axis" });
    // A transfer re-sets the stored balance; what came before it still counts as having moved it.
    addTransfer({ fromId: "axis", toId: "wallet", amount: 2_000_00, note: "ATM", occurredAt: now - 3000 });

    const items = accountItems(acct("axis"));
    expect(items.map((x) => [x.kind, x.title, x.amount])).toEqual([
      ["ledger", "Lent to Arun", -500_00],
      ["transfer", "To Wallet", -2_000_00],
      ["expense", "Swiggy", -1_200_00],
      ["income", "Freelance", 3_000_00],
      ["income", "Salary", 40_000_00],
    ]);
    // The salary was dated before the balance was entered, so it's taken to be in it.
    expect(items.find((x) => x.title === "Salary")?.counted).toBe(false);
    expect(items.filter((x) => x.counted)).toHaveLength(4);
    // The balance agrees: 20,000 + 3,000 − 1,200 − 2,000 − 500.
    expect(liveBalance(acct("axis"))).toBe(19_300_00);
    expect(accountItems(acct("wallet")).map((x) => [x.title, x.amount])).toEqual([["From Axis", 2_000_00]]);
  });
});
