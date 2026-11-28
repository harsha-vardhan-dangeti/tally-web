import { describe, expect, it } from "vitest";
import { addExpense, getState, placeOldSettlements, saveGroup, saveLedgerEntry, type LedgerEntry } from "./store";
import { groupStanding } from "../core/groups";
import { people } from "../core/people";

const old = new Date(2026, 10, 20, 12).getTime();
const settle = (id: string, amount: number, at: number, person = "Ravi"): LedgerEntry =>
  ({ id, person, amount, kind: "settled", note: "", occurredAt: at, createdAt: at, account: "HDFC Bank" });

describe("settle-ups made in People before they counted toward groups", () => {
  it("are placed in the groups they paid off, once, leaving totals in People as they were", () => {
    saveGroup({ id: "flat", name: "Flat 302", members: ["Ravi", "Priya"], createdAt: 1 });
    saveGroup({ id: "goa", name: "Goa trip", members: ["Ravi"], createdAt: 2 });
    addExpense({ amount: 1800_00, category: "bills", merchant: "Rent", source: "manual", splitWays: 3, splitWith: "Ravi, Priya", group: "flat", account: "HDFC Bank", occurredAt: old - 86_400_000 });
    addExpense({ amount: 1000_00, category: "transport", merchant: "Cab", source: "manual", splitWays: 2, splitWith: "Ravi", group: "goa", account: "HDFC Bank", occurredAt: old - 86_400_000 });
    // Ravi paid 1,300 back in People: 600 for the flat, 500 for Goa, 200 more than he owed.
    saveLedgerEntry(settle("ravi-paid", -1300_00, old));
    // An imported Splitwise payment stays as it is.
    saveLedgerEntry(settle("sw-abc-ravi", -50_00, old));
    const total = () => people(getState().expenses, getState().ledger).find((p) => p.name === "Ravi")?.balance;
    const before = total();
    const standing = (id: string) => groupStanding(getState().settings.groups.find((g) => g.id === id)!, getState().expenses, getState().ledger)
      .members.find((m) => m.name === "Ravi")?.balance;
    expect(standing("flat")).toBe(600_00);

    expect(placeOldSettlements()).toBe(3);
    const parts = getState().ledger.filter((l) => l.id.startsWith("ravi-paid")).map((l) => [l.id, l.amount, l.group]).sort();
    expect(parts).toEqual([["ravi-paid", -600_00, "flat"], ["ravi-paid-1", -500_00, "goa"], ["ravi-paid-2", -200_00, undefined]]);
    expect(standing("flat")).toBe(0);
    expect(standing("goa")).toBe(0);
    expect(total()).toBe(before);
    expect(getState().ledger.find((l) => l.id === "sw-abc-ravi")?.group).toBeUndefined();
    // Running again changes nothing.
    expect(placeOldSettlements()).toBe(0);
  });
});
