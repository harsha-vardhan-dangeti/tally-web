import { describe, expect, it } from "vitest";
import { BackupError, parseBackup } from "./backup";

const expense = (over: Record<string, unknown> = {}) => ({
  id: "e1", amount: 35_000, merchant: "Chutneys", note: "Lunch", category: "food", account: "UPI",
  occurredAt: 1_760_000_000_000, createdAt: 1_760_000_000_000, source: "smart", pending: false,
  splitWays: 2, splitWith: "Arjun", exclude: false, recurring: false, ...over,
});
const file = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ app: "tally", version: 1, exportedAt: "2026-10-01T10:00:00.000Z", expenses: [expense()], ...over });

describe("parseBackup", () => {
  it("reads a backup made by Tally", () => {
    const b = parseBackup(file({ settings: { monthlyBudget: 5_500_000, lockCredentialId: "x" } }));
    expect(b.expenses).toHaveLength(1);
    expect(b.expenses[0]).toMatchObject({ id: "e1", amount: 35_000, category: "food", splitWays: 2 });
    expect(b.settings).toEqual({ monthlyBudget: 5_500_000 });
    expect(b.exportedAt).toBe("2026-10-01T10:00:00.000Z");
  });

  it("rejects files that aren't Tally backups", () => {
    expect(() => parseBackup("not json")).toThrow(BackupError);
    expect(() => parseBackup(JSON.stringify({ app: "other", expenses: [] }))).toThrow(/isn't a Tally backup/);
    expect(() => parseBackup(JSON.stringify({ app: "tally" }))).toThrow(BackupError);
  });

  it("rejects backups from a newer version", () => {
    expect(() => parseBackup(file({ version: 2 }))).toThrow(/newer version/);
  });

  it("names the broken expense instead of restoring part of the file", () => {
    const bad = file({ expenses: [expense(), expense({ id: "e2", amount: "350" })] });
    expect(() => parseBackup(bad)).toThrow("Expense 2 in this file has no valid amount.");
    expect(() => parseBackup(file({ expenses: [expense({ occurredAt: null })] }))).toThrow(/no valid date/);
  });

  it("fills defaults for fields older backups don't have", () => {
    const b = parseBackup(file({ expenses: [{ id: "old", amount: 18_000, occurredAt: 1_700_000_000_000, category: "snacks" }] }));
    expect(b.expenses[0]).toMatchObject({ category: "other", source: "import", splitWays: 1, pending: false, createdAt: 1_700_000_000_000 });
  });

  it("drops unreadable optional rows and counts them", () => {
    const b = parseBackup(file({
      bills: [{ id: "b1", name: "Rent", amount: 2_500_000, day: 5 }, { id: "b2", name: "Bad", amount: 100, day: 40 }],
      chips: "oops",
    }));
    expect(b.bills.map((x) => x.id)).toEqual(["b1"]);
    expect(b.skipped).toBe(2);
  });

  it("reads income entries and treats older backups as having none", () => {
    expect(parseBackup(file()).incomes).toEqual([]);
    const b = parseBackup(file({
      incomes: [
        { id: "i1", amount: 12_000_000, source: "Salary", account: "HDFC", receivedAt: 1_761_000_000_000 },
        { id: "i2", amount: 0, source: "Bad", receivedAt: 1_761_000_000_000 },
        { id: "i3", amount: 500_000, source: "Refund" },
      ],
    }));
    expect(b.incomes).toEqual([{ id: "i1", amount: 12_000_000, source: "Salary", note: "", account: "HDFC",
      receivedAt: 1_761_000_000_000, createdAt: 1_761_000_000_000 }]);
    expect(b.skipped).toBe(2);
  });

  it("keeps one copy of a repeated expense ID", () => {
    const b = parseBackup(file({ expenses: [expense({ amount: 100 }), expense({ amount: 200 })] }));
    expect(b.expenses).toHaveLength(1);
    expect(b.expenses[0].amount).toBe(200);
  });

  it("keeps the file's own categories and transfers, checked", () => {
    const gym = { id: "c-gym", title: "Gym", icon: "dumbbell", tint: "#0E7C86", keywords: ["cult"], hidden: false };
    const b = parseBackup(file({
      expenses: [expense({ category: "c-gym" }), expense({ id: "e2", category: "c-unknown" })],
      budgets: [{ category: "c-gym", limit: 300_000 }, { category: "c-unknown", limit: 100 }],
      transfers: [
        { id: "t1", fromId: "a1", toId: "a2", fromName: "HDFC", toName: "Card", amount: 500_000, note: "Card bill", occurredAt: 1_760_000_000_000 },
        { id: "t2", fromId: "a1", toId: "a1", amount: 100, occurredAt: 1_760_000_000_000 },
      ],
      settings: { categories: [gym, { id: "fun", title: "Going out", hidden: true }, { id: "<script>", title: "x" }] },
    }));
    expect(b.expenses.map((e) => e.category)).toEqual(["c-gym", "other"]);
    expect(b.budgets).toEqual([{ category: "c-gym", limit: 300_000 }]);
    expect(b.transfers).toEqual([expect.objectContaining({ id: "t1", amount: 500_000, note: "Card bill" })]);
    expect(b.settings.categories?.map((c) => [c.id, c.title, c.hidden])).toEqual([["fun", "Going out", true], ["c-gym", "Gym", false]]);
  });
});
