import { describe, expect, it } from "vitest";
import { parseSplitwise, planBalances, planSplitwise, guessMe } from "../core/splitwise";
import { people } from "../core/people";
import {
  addTransfer, getState, importSplitwise, investmentReturn, investmentsSummary, liveBalance, saveAccount, saveLedgerEntry, saveScheduledTransfer,
  type Account,
} from "./store";
import { parseBackup } from "./backup";

const CSV = `Date,Description,Category,Cost,Currency,Harsha D,Ravi,Priya

2026-10-01,Rent,Rent,30000.00,INR,20000.00,-10000.00,-10000.00
2026-10-03,Vegetables,Groceries,900.00,INR,-300.00,600.00,-300.00
2026-10-03,Vegetables,Groceries,900.00,INR,-300.00,600.00,-300.00
2026-10-05,Movie night,Movies,1200.00,INR,0.00,600.00,-600.00
2026-10-12,Ravi paid Harsha D,Payment,10000.00,INR,-10000.00,10000.00,0.00

2026-11-16,Total balance, , ,INR,9400.00,1800.00,-11200.00
`;

describe("Splitwise export", () => {
  const file = parseSplitwise(CSV)!;
  const plan = (has: (id: string) => boolean = () => false) => planSplitwise({
    file, me: 0, names: ["Harsha D", "Ravi", "Priya"], home: "INR", rates: {}, has, existing: [],
  });

  it("reads members, rows and the total", () => {
    expect(file.members).toEqual(["Harsha D", "Ravi", "Priya"]);
    expect(file.rows).toHaveLength(5);
    expect(file.rows[4].payment).toBe(true);
    expect(file.totals?.[0]).toBe(9_400_00);
    expect(guessMe(file.members, ["Harsha Vardhan Dangeti"])).toBe(0);
    expect(parseSplitwise("Date,Narration,Amount\n2026-10-01,x,1")).toBeNull();
  });

  it("turns rows into your share and who owes whom, matching Splitwise's total", () => {
    const rows = plan();
    // The movie night didn't include you.
    expect(rows.map((r) => r.description)).toEqual(["Rent", "Vegetables", "Vegetables", "Ravi paid Harsha D"]);
    expect(rows.map((r) => r.share)).toEqual([10_000_00, 300_00, 300_00, 0]);
    expect(rows[0].category).toBe("bills");
    expect(rows[1].category).toBe("groceries");
    expect(rows[0].entries.map((e) => [e.person, e.amount, e.kind])).toEqual([["Ravi", 10_000_00, "lent"], ["Priya", 10_000_00, "lent"]]);
    expect(rows[1].entries.map((e) => [e.person, e.amount, e.kind])).toEqual([["Ravi", -300_00, "borrowed"]]);
    expect(rows[3].entries.map((e) => [e.person, e.amount, e.kind])).toEqual([["Ravi", -10_000_00, "settled"]]);
    // The same row twice on the same day gets two IDs.
    expect(rows[1].key).not.toBe(rows[2].key);
    const b = planBalances(rows);
    expect(b.get("ravi")?.amount).toBe(-600_00);
    expect(b.get("priya")?.amount).toBe(10_000_00);
    expect([...b.values()].reduce((t, x) => t + x.amount, 0)).toBe(file.totals![0]);
  });

  it("adds them to spending and People once, however often the export is imported", async () => {
    const s0 = getState();
    const before = s0.expenses.length;
    const ids = await importSplitwise(plan(), { group: "Flat 302", addSpending: true });
    expect(ids.expenseIds).toHaveLength(3);
    expect(ids.ledgerIds).toHaveLength(5);
    const s = getState();
    expect(s.expenses.length - before).toBe(3);
    const rent = s.expenses.find((e) => e.id === ids.expenseIds[0])!;
    expect(rent).toMatchObject({ amount: 10_000_00, account: "Splitwise", note: "Splitwise · Flat 302", tags: ["splitwise"] });
    const folks = people(s.expenses, s.ledger);
    expect(folks.find((p) => p.key === "ravi")?.balance).toBe(-600_00);
    expect(folks.find((p) => p.key === "priya")?.balance).toBe(10_000_00);

    // Next month's export repeats these rows: nothing new to add.
    const again = plan((id) => getState().expenses.some((e) => e.id === id) || getState().ledger.some((l) => l.id === id));
    expect(again.every((r) => r.imported)).toBe(true);
    const second = await importSplitwise(again, { group: "Flat 302", addSpending: true });
    expect(second.expenseIds.length + second.ledgerIds.length).toBe(0);
  });

  it("flags rows you probably logged in Tally already", () => {
    const rows = planSplitwise({ file, me: 0, names: file.members, home: "INR", rates: {}, has: () => false,
      existing: [{ amount: 30_000_00, at: new Date(2026, 9, 1, 20).getTime() }] });
    expect(rows[0].maybeLogged).toBe(true);
    expect(rows[1].maybeLogged).toBe(false);
  });
});

describe("money lent from an account", () => {
  it("moves a tracked account's balance, out when you lend and in when you're paid back", () => {
    const now = Date.now();
    const bank: Account = { id: "lend-bank", name: "Kotak", kind: "bank", balance: 50_000_00, order: 9, updatedAt: now - 60_000, tracked: true };
    saveAccount(bank);
    const kotak = () => getState().accounts.find((a) => a.id === "lend-bank")!;
    saveLedgerEntry({ id: "l1", person: "Arun", amount: 5_000_00, kind: "lent", note: "", occurredAt: now - 1000, createdAt: now, account: "Kotak" });
    expect(liveBalance(kotak())).toBe(45_000_00);
    saveLedgerEntry({ id: "l2", person: "Arun", amount: -2_000_00, kind: "settled", note: "", occurredAt: now - 500, createdAt: now, account: "Kotak" });
    expect(liveBalance(kotak())).toBe(47_000_00);
    // Without an account it only changes what you owe each other.
    saveLedgerEntry({ id: "l3", person: "Arun", amount: 1_000_00, kind: "lent", note: "", occurredAt: now - 400, createdAt: now });
    expect(liveBalance(kotak())).toBe(47_000_00);
    expect(people([], getState().ledger).find((p) => p.key === "arun")?.balance).toBe(4_000_00);
  });
});

describe("investments", () => {
  it("adds each SIP to what's invested and works out the gain", () => {
    const now = Date.now();
    saveAccount({ id: "inv-bank", name: "SBI", kind: "bank", balance: 1_00_000_00, order: 10, updatedAt: now });
    saveAccount({ id: "groww", name: "Groww", kind: "investment", balance: 1_20_000_00, order: 11, updatedAt: now, invested: 1_00_000_00, investedAt: now - 1 });
    saveAccount({ id: "ppf", name: "PPF", kind: "investment", balance: 50_000_00, order: 12, updatedAt: now });
    const groww = () => getState().accounts.find((a) => a.id === "groww")!;
    expect(investmentReturn(groww())).toMatchObject({ value: 1_20_000_00, invested: 1_00_000_00, gain: 20_000_00, pct: 0.2 });
    addTransfer({ fromId: "inv-bank", toId: "groww", amount: 5_000_00, note: "Flexi cap SIP", occurredAt: now });
    expect(investmentReturn(groww())).toMatchObject({ value: 1_25_000_00, invested: 1_05_000_00, gain: 20_000_00 });
    // No amount invested entered: no returns yet.
    expect(investmentReturn(getState().accounts.find((a) => a.id === "ppf")!)).toBeNull();

    saveScheduledTransfer({ id: "sip1", fromId: "inv-bank", toId: "groww", amount: 5_000_00, day: 5, note: "Flexi cap", lastLoggedMonth: "" });
    saveScheduledTransfer({ id: "sip2", fromId: "inv-bank", toId: "ppf", amount: 2_000_00, day: 10, note: "PPF", lastLoggedMonth: "" });
    expect(investmentsSummary()).toMatchObject({ count: 2, value: 1_75_000_00, invested: 1_05_000_00, gain: 20_000_00, withReturns: 1, sipCount: 2, sipMonthly: 7_000_00 });
  });

  it("keeps what's invested, money lent from an account and SIPs in a backup", () => {
    const b = parseBackup(JSON.stringify({ app: "tally",
      expenses: [],
      accounts: [{ id: "g", name: "Groww", kind: "investment", balance: 100, order: 0, updatedAt: 1, invested: 90, investedAt: 1 }],
      ledger: [{ id: "x", person: "Arun", amount: 500, kind: "lent", note: "", occurredAt: 1, createdAt: 1, account: "Kotak" }],
      settings: { scheduledTransfers: [{ id: "s", fromId: "a", toId: "g", amount: 100, day: 5, note: "SIP", lastLoggedMonth: "" }] },
    }));
    expect(b.accounts[0]).toMatchObject({ invested: 90, investedAt: 1 });
    expect(b.ledger[0].account).toBe("Kotak");
    expect(b.settings.scheduledTransfers).toHaveLength(1);
  });
});
