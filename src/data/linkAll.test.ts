import { describe, expect, it } from "vitest";
import {
  addExpense, getState, importTransactions, linkGroups, liveBalance, previewLink, resolveAccount, saveAccount, saveBill, saveLedgerEntry,
  suggestAccount, unlinkedGroups, type Expense, type Income,
} from "./store";

const now = Date.now();
const acct = (id: string) => getState().accounts.find((a) => a.id === id)!;
let n = 0;
const exp = (account: string, amount: number, over: Partial<Expense> = {}): Expense => ({
  id: `x${n++}`, amount, merchant: `Shop ${n}`, note: "", category: "food", account, occurredAt: now - 5000, createdAt: now - 1000,
  source: "manual", pending: false, splitWays: 1, splitWith: "", exclude: false, recurring: false, ...over,
});

describe("linking everything to your accounts", () => {
  it("groups what isn't on an account, suggests where each goes, previews and links it, and can be undone", async () => {
    saveAccount({ id: "hdfc", name: "HDFC Bank", kind: "bank", balance: 50_000_00, order: 0, updatedAt: now - 3_600_000, tracked: true });
    saveAccount({ id: "wallet", name: "Wallet", kind: "cash", balance: 2_000_00, order: 1, updatedAt: now - 3_600_000, tracked: true });
    saveAccount({ id: "ace", name: "Axis Ace", kind: "card", balance: 0, order: 2, updatedAt: now - 3_600_000, tracked: true });
    const income: Income = { id: "sal", amount: 20_000_00, source: "Salary", note: "", account: "Bank", receivedAt: now - 5000, createdAt: now - 1000 };
    await importTransactions([
      exp("UPI", 1_000_00, { createdAt: now - 7_200_000, occurredAt: now - 7_200_000 }), // logged before the balance was entered
      exp("UPI", 500_00),
      exp("Cash", 200_00),
      exp("Credit card", 3_000_00),
      exp("", 100_00),
      exp("Splitwise", 400_00),
      exp("UPI", 900_00, { paidBy: "Ravi", splitWays: 2 }),
    ], [income]);
    saveLedgerEntry({ id: "lend", person: "Arun", amount: 1_500_00, kind: "lent", note: "", occurredAt: now - 4000, createdAt: now - 1000, account: "UPI" });
    saveBill({ id: "ins", name: "TATA AIA", amount: 1_250_00, prevAmount: 1_250_00, day: 5, category: "bills", account: "UPI", isSubscription: false, autoLog: true, lastLoggedMonth: "" });

    const groups = unlinkedGroups();
    // Splitwise shares and what someone else paid aren't money you moved.
    expect(groups.map((g) => g.key).sort()).toEqual(["", "bank", "cash", "credit card", "upi"]);
    const upi = groups.find((g) => g.key === "upi")!;
    expect(upi).toMatchObject({ out: 3_000_00 });
    expect(upi.expenses).toHaveLength(2);
    expect(upi.ledger).toHaveLength(1);
    expect(upi.bills.map((b) => b.id)).toEqual(["ins"]);

    expect(suggestAccount("upi")).toBe("hdfc");
    expect(suggestAccount("bank")).toBe("hdfc");
    expect(suggestAccount("cash")).toBe("wallet");
    expect(suggestAccount("credit card")).toBe("ace");
    expect(suggestAccount("paytm wallet")).toBe("");

    const choices = [
      { key: "upi", accountId: "hdfc", remember: true },
      { key: "bank", accountId: "hdfc", remember: false },
      { key: "cash", accountId: "wallet", remember: true },
      { key: "credit card", accountId: "ace", remember: false },
    ];
    // HDFC: −500 (the UPI one logged after the balance) −1,500 lent +20,000 salary. The older ₹1,000 is in the balance.
    const preview = previewLink(choices, false);
    expect(preview.find((p) => p.account.id === "hdfc")).toMatchObject({ before: 50_000_00, after: 68_000_00 });
    expect(preview.find((p) => p.account.id === "ace")).toMatchObject({ before: 0, after: 3_000_00 });
    expect(previewLink(choices, true).find((p) => p.account.id === "hdfc")?.after).toBe(67_000_00);

    const undo = linkGroups(choices, false);
    expect(liveBalance(acct("hdfc"))).toBe(68_000_00);
    expect(liveBalance(acct("wallet"))).toBe(1_800_00);
    expect(liveBalance(acct("ace"))).toBe(3_000_00);
    expect(getState().bills.find((b) => b.id === "ins")?.account).toBe("HDFC Bank");
    expect(unlinkedGroups().map((g) => g.key)).toEqual([""]);
    // From now on, UPI means HDFC Bank.
    expect(resolveAccount("UPI")).toBe("HDFC Bank");
    expect(addExpense({ amount: 300_00, category: "food", merchant: "Chai", account: "UPI", source: "manual" }).account).toBe("HDFC Bank");
    expect(liveBalance(acct("hdfc"))).toBe(67_700_00);

    undo();
    expect(resolveAccount("UPI")).toBe("UPI");
    expect(getState().bills.find((b) => b.id === "ins")?.account).toBe("UPI");
    expect(liveBalance(acct("ace"))).toBe(0);
    // The chai was logged after linking, so it stays on HDFC.
    expect(liveBalance(acct("hdfc"))).toBe(49_700_00);
  });
});
