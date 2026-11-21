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
    saveLedgerEntry({ id: "old", person: "Arun", amount: 2_000_00, kind: "lent", note: "", occurredAt: now - 7_200_000, createdAt: now, account: "UPI" });
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
