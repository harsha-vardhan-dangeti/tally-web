import { describe, expect, it } from "vitest";
import { firstSignInPlan, fromSyncData, nextCursor, pullFrom, rowsToApply, toSyncData, type RemoteRow } from "./syncCore";

const row = (over: Partial<RemoteRow>): RemoteRow => ({
  kind: "expense", record_id: "e1", data: { id: "e1" }, deleted: false,
  changed_at: "2026-10-24T10:00:00.000Z", synced_at: "2026-10-24T10:00:01.000Z", ...over,
});

describe("toSyncData / fromSyncData", () => {
  it("keys records by their ID, budgets by category, and only syncs the settings row of kv", () => {
    expect(toSyncData("expenses", { id: "e1", amount: 100 })).toEqual({ kind: "expense", id: "e1", data: { id: "e1", amount: 100 } });
    expect(toSyncData("budgets", { category: "food", limit: 5 })).toEqual({ kind: "budget", id: "food", data: { category: "food", limit: 5 } });
    expect(toSyncData("kv", { key: "syncAccount", userId: "u" })).toBeNull();
    expect(toSyncData("outbox", { key: "x" })).toBeNull();
  });

  it("keeps the passkey lock and backup date on their own device", () => {
    const up = toSyncData("kv", { key: "settings", value: { monthlyBudget: 5, lockCredentialId: "abc", lastBackupAt: 9 } });
    expect(up).toEqual({ kind: "settings", id: "settings", data: { monthlyBudget: 5 } });
    expect(fromSyncData("settings", { monthlyBudget: 7 }, { lockCredentialId: "mine", lastBackupAt: 3, monthlyBudget: 5 }))
      .toEqual({ key: "settings", value: { monthlyBudget: 7, lockCredentialId: "mine", lastBackupAt: 3 } });
  });
});

describe("rowsToApply", () => {
  it("lets a newer edit still waiting on this device win over a downloaded one", () => {
    const remote = [row({ record_id: "e1" }), row({ record_id: "e2" })];
    const pending = new Map([
      ["expense:e1", Date.parse("2026-10-24T10:05:00Z")], // edited here after the remote change
      ["expense:e2", Date.parse("2026-10-24T09:00:00Z")], // older than the remote change
    ]);
    expect(rowsToApply(remote, pending).map((r) => r.record_id)).toEqual(["e2"]);
  });

  it("applies deletions from other devices", () => {
    expect(rowsToApply([row({ deleted: true, data: null })], new Map())).toHaveLength(1);
  });
});

describe("cursor", () => {
  it("advances to the newest server time and pulls with a small overlap", () => {
    const rows = [row({ synced_at: "2026-10-24T10:00:03.000Z" }), row({ synced_at: "2026-10-24T10:00:09.000Z" })];
    expect(nextCursor(rows, "2026-10-24T10:00:00.000Z")).toBe("2026-10-24T10:00:09.000Z");
    expect(nextCursor([], "2026-10-24T10:00:00.000Z")).toBe("2026-10-24T10:00:00.000Z");
    expect(pullFrom("2026-10-24T10:00:09.000Z")).toBe("2026-10-24T10:00:04.000Z");
    expect(pullFrom(null)).toBeNull();
  });
});

describe("firstSignInPlan", () => {
  const local = [
    { store: "expenses" as const, value: { id: "only-here", amount: 100 } },
    { store: "expenses" as const, value: { id: "both", amount: 999 } },
    { store: "chips" as const, value: { id: "default-coffee", title: "Coffee", amount: 18_000 } },
    { store: "chips" as const, value: { id: "c-custom", title: "Metro card", amount: 50_000 } },
    { store: "kv" as const, value: { key: "settings", value: { monthlyBudget: 1 } } },
  ];

  it("uploads only what the account doesn't have, as the oldest possible edit", () => {
    const remote = [row({ record_id: "both" }), row({ kind: "chip", record_id: "c-remote", data: { title: "Tea" } }), row({ kind: "settings", record_id: "settings" })];
    const plan = firstSignInPlan(local, remote);
    expect(plan.uploads.map((u) => u.key)).toEqual(["expense:only-here", "chip:c-custom"]);
    expect(plan.uploads.every((u) => u.changedAt === 1)).toBe(true);
    // The fresh device's untouched Coffee repeat isn't added to an account that has repeats.
    expect(plan.dropChipIds).toEqual(["default-coffee"]);
  });

  it("uploads everything, defaults and settings included, to a new account", () => {
    const plan = firstSignInPlan(local, []);
    expect(plan.uploads.map((u) => u.key)).toEqual(["expense:only-here", "expense:both", "chip:default-coffee", "chip:c-custom", "settings:settings"]);
    expect(plan.dropChipIds).toEqual([]);
  });

  it("doesn't bring back a record the account has deleted", () => {
    // A deleted row is applied (removing the local copy) before the plan runs, so it isn't local any more;
    // if it still were, uploading it at changedAt 1 couldn't beat the newer deletion on the server.
    const plan = firstSignInPlan(local, [row({ record_id: "both", deleted: true, data: null })]);
    expect(plan.uploads.find((u) => u.key === "expense:both")?.changedAt).toBe(1);
  });
});
