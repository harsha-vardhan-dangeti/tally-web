import { describe, expect, it } from "vitest";
import { getState, logRecurringIncome, runDueIncome, saveIncome, saveRecurringIncome, type RecurringIncome } from "./store";
import { parseBackup } from "./backup";
import { toSyncData } from "./syncCore";

const rule = (over: Partial<RecurringIncome>): RecurringIncome => ({
  id: "r", source: "Salary", amount: 12_000_000, day: 1, account: "HDFC", note: "", autoLog: true, lastLoggedMonth: "", ...over,
});
const added = (id: string) => getState().incomes.filter((x) => x.id.startsWith(`income-${id}-`));
const oct24 = new Date(2026, 9, 24, 15);

describe("regular income", () => {
  it("adds a month's income once, however often it's asked", () => {
    saveRecurringIncome(rule({ id: "salary" }));
    logRecurringIncome(getState().recurringIncomes.find((r) => r.id === "salary")!, oct24);
    runDueIncome(oct24);
    runDueIncome(oct24);
    expect(added("salary")).toHaveLength(1);
    expect(added("salary")[0]).toMatchObject({ id: "income-salary-2026-10", amount: 12_000_000, source: "Salary", account: "HDFC" });
    expect(new Date(added("salary")[0].receivedAt).getDate()).toBe(1);
  });

  it("adds income once its day has come, and leaves the rest", () => {
    saveRecurringIncome(rule({ id: "due", day: 20 }));
    saveRecurringIncome(rule({ id: "later", day: 28 }));
    saveRecurringIncome(rule({ id: "off", day: 2, autoLog: false }));
    runDueIncome(oct24);
    expect(added("due")).toHaveLength(1);
    expect(added("later")).toHaveLength(0);
    expect(added("off")).toHaveLength(0);
  });

  it("keeps a month's entry that was already edited (or added on another device)", () => {
    saveIncome({ id: "income-bonus-2026-10", amount: 13_500_000, source: "Salary", note: "with bonus", account: "HDFC", receivedAt: oct24.getTime(), createdAt: 1 });
    saveRecurringIncome(rule({ id: "bonus" }));
    runDueIncome(oct24);
    expect(added("bonus")).toHaveLength(1);
    expect(added("bonus")[0]).toMatchObject({ amount: 13_500_000, note: "with bonus" });
    expect(getState().recurringIncomes.find((r) => r.id === "bonus")!.lastLoggedMonth).toBe("2026-10");
  });

  it("adds again the next month", () => {
    saveRecurringIncome(rule({ id: "monthly", lastLoggedMonth: "2026-10" }));
    runDueIncome(new Date(2026, 10, 3, 9));
    expect(added("monthly").map((x) => x.id)).toEqual(["income-monthly-2026-11"]);
  });

  it("is kept in backups and synced as its own kind of record", () => {
    const b = parseBackup(JSON.stringify({ app: "tally", version: 1, expenses: [], recurringIncomes: [rule({ id: "r1" }), rule({ id: "bad", day: 31 })] }));
    expect(b.recurringIncomes.map((r) => r.id)).toEqual(["r1"]);
    expect(b.skipped).toBe(1);
    expect(toSyncData("recurringIncomes", rule({ id: "r1" }))).toMatchObject({ kind: "recurring_income", id: "r1" });
  });
});
