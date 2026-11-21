import { describe, expect, it } from "vitest";
import { getState, likelyAccount, linkLedger, liveBalance, saveAccount, saveLedgerEntry, unlinkedLedger } from "./store";

const acct = (id: string) => getState().accounts.find((a) => a.id === id)!;

describe("money lent and borrowed through an account", () => {
  it("defaults to a real account rather than “UPI”, and “Bank” means your one bank", () => {
    const now = Date.now();
    const s0 = getState();
    // No accounts: the default payment method, whatever it is.
    expect(likelyAccount(s0, [])).toBe(s0.settings.defaultAccount);
    saveAccount({ id: "icici", name: "ICICI", kind: "bank", balance: 30_000_00, order: 0, updatedAt: now - 3_600_000, tracked: true });
    expect(likelyAccount(getState(), [undefined, "UPI"])).toBe("ICICI");
    saveAccount({ id: "purse", name: "Purse", kind: "cash", balance: 2_000_00, order: 1, updatedAt: now - 3_600_000, tracked: true });
    // The last account you actually used wins.
    expect(likelyAccount(getState(), ["UPI", "purse"])).toBe("Purse");

    saveLedgerEntry({ id: "r1", person: "Ravi", amount: 4_000_00, kind: "lent", note: "", occurredAt: now - 1000, createdAt: now, account: "Bank" });
    expect(getState().ledger.find((l) => l.id === "r1")?.account).toBe("ICICI");
    expect(liveBalance(acct("icici"))).toBe(26_000_00);
  });

  it("can move entries that went through “UPI” or nothing onto an account, with older ones applied only when asked", () => {
    const now = Date.now();
    saveLedgerEntry({ id: "u1", person: "Priya", amount: 1_500_00, kind: "lent", note: "", occurredAt: now - 500, createdAt: now, account: "UPI" });
    saveLedgerEntry({ id: "u2", person: "Priya", amount: -500_00, kind: "settled", note: "", occurredAt: now - 400, createdAt: now });
    saveLedgerEntry({ id: "old", person: "Arun", amount: 2_000_00, kind: "lent", note: "", occurredAt: now - 7_200_000, createdAt: now - 7_200_000, account: "UPI" });
    saveLedgerEntry({ id: "sw-abc-1", person: "Arun", amount: 300_00, kind: "lent", note: "", occurredAt: now, createdAt: now });
    // Splitwise shares aren't money that moved.
    expect(unlinkedLedger().map((l) => l.id).sort()).toEqual(["old", "u1", "u2"]);

    const icici = () => liveBalance(acct("icici"));
    const undo = linkLedger("icici", ["u1", "u2", "old"], false);
    // −1,500 lent, +500 paid back; the old one is taken to be in the balance.
    expect(icici()).toBe(25_000_00);
    expect(unlinkedLedger()).toHaveLength(0);
    undo();
    expect(icici()).toBe(26_000_00);
    expect(getState().ledger.find((l) => l.id === "u2")?.account).toBeUndefined();

    const undo2 = linkLedger("icici", ["u1", "u2", "old"], true);
    expect(icici()).toBe(23_000_00);
    undo2();
    expect(icici()).toBe(26_000_00);
  });
});

describe("what you record moves the balance, and removing it puts it back", () => {
  it("counts money lent today even when it's dated before the balance was entered, and undoes it when deleted", async () => {
    const { deleteLedgerEntry } = await import("./store");
    const now = Date.now();
    saveAccount({ id: "yes", name: "Yes Bank", kind: "bank", balance: 50_000_00, order: 7, updatedAt: now - 3_600_000, tracked: true });
    const yes = () => liveBalance(acct("yes"));
    // Lent a week ago, recorded now.
    saveLedgerEntry({ id: "wk", person: "Kiran", amount: 5_000_00, kind: "lent", note: "", occurredAt: now - 7 * 86_400_000, createdAt: now, account: "Yes Bank" });
    expect(yes()).toBe(45_000_00);
    // Borrowed, recorded now: comes in.
    saveLedgerEntry({ id: "bw", person: "Meera", amount: -2_000_00, kind: "borrowed", note: "", occurredAt: now, createdAt: now, account: "Yes Bank" });
    expect(yes()).toBe(47_000_00);
    deleteLedgerEntry("wk", false);
    expect(yes()).toBe(52_000_00);
    // Marked as already in the balance: doesn't move it.
    saveLedgerEntry({ id: "in", person: "Kiran", amount: 1_000_00, kind: "lent", note: "", occurredAt: now - 86_400_000, createdAt: now, account: "Yes Bank", inBalance: true });
    expect(yes()).toBe(52_000_00);
  });

  it("puts the balance back when income is deleted, even after a transfer from the account", async () => {
    const { addTransfer, deleteIncome, saveIncome } = await import("./store");
    const now = Date.now();
    saveAccount({ id: "idfc", name: "IDFC", kind: "bank", balance: 10_000_00, order: 8, updatedAt: now - 3_600_000, tracked: true });
    saveAccount({ id: "cash2", name: "Cash box", kind: "cash", balance: 0, order: 9, updatedAt: now - 3_600_000, tracked: true });
    const idfc = () => liveBalance(acct("idfc"));
    saveIncome({ id: "pay", amount: 30_000_00, source: "Salary", note: "", account: "IDFC", receivedAt: now - 5 * 86_400_000, createdAt: now });
    expect(idfc()).toBe(40_000_00);
    addTransfer({ fromId: "idfc", toId: "cash2", amount: 5_000_00, note: "ATM", occurredAt: now });
    expect(idfc()).toBe(35_000_00);
    expect(liveBalance(acct("cash2"))).toBe(5_000_00);
    // The salary was a mistake.
    deleteIncome("pay", false);
    expect(idfc()).toBe(5_000_00);
  });
});
