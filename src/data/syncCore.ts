import type { StoreName } from "./db";

/**
 * Pure rules for syncing Tally between devices through Supabase (see cloud.ts for the I/O).
 * Every record maps to one row: (kind, record_id) → JSON data. The newest edit wins; a
 * deletion is a row with deleted = true so other devices remove it too.
 */

export type SyncKind = "expense" | "income" | "chip" | "budget" | "bill" | "account" | "goal" | "settings";

export const KIND_OF: Partial<Record<StoreName, SyncKind>> = {
  expenses: "expense", incomes: "income", chips: "chip", budgets: "budget", bills: "bill", accounts: "account", goals: "goal", kv: "settings",
};
export const STORE_OF: Record<SyncKind, StoreName> = {
  expense: "expenses", income: "incomes", chip: "chips", budget: "budgets", bill: "bills", account: "accounts", goal: "goals", settings: "kv",
};

/** A local change waiting to be uploaded. Keyed so a later edit of the same record replaces it. */
export interface Change {
  key: string;
  kind: SyncKind;
  record_id: string;
  data: unknown | null;
  deleted: boolean;
  /** Epoch ms of the edit on this device. */
  changedAt: number;
}

export interface RemoteRow {
  kind: SyncKind;
  record_id: string;
  data: unknown | null;
  deleted: boolean;
  changed_at: string;
  synced_at: string;
}

export const changeKey = (kind: SyncKind, id: string) => `${kind}:${id}`;

/** Settings fields that belong to one device: the passkey lock and when this device last backed up. */
const DEVICE_ONLY = ["lockCredentialId", "lastBackupAt"] as const;

/** What gets uploaded for a stored value. Only the "settings" row of kv syncs. */
export function toSyncData(store: StoreName, value: unknown): { kind: SyncKind; id: string; data: unknown } | null {
  const kind = KIND_OF[store];
  if (!kind || !value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (store === "kv") {
    if (v.key !== "settings" || !v.value || typeof v.value !== "object") return null;
    const settings = { ...(v.value as Record<string, unknown>) };
    for (const k of DEVICE_ONLY) delete settings[k];
    return { kind, id: "settings", data: settings };
  }
  const id = store === "budgets" ? v.category : v.id;
  return typeof id === "string" && id ? { kind, id, data: value } : null;
}

/** The value to store locally for a downloaded row; settings keep this device's own fields. */
export function fromSyncData(kind: SyncKind, data: unknown, localSettings?: Record<string, unknown>): unknown {
  if (kind !== "settings") return data;
  const merged: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const k of DEVICE_ONLY) if (localSettings && k in localSettings) merged[k] = localSettings[k];
  return { key: "settings", value: merged };
}

/**
 * Which downloaded rows to apply. A row is skipped when this device has a newer edit of the same
 * record still waiting to upload; that edit will win on the server when it's pushed.
 */
export function rowsToApply(rows: RemoteRow[], pending: Map<string, number>): RemoteRow[] {
  return rows.filter((r) => {
    const local = pending.get(changeKey(r.kind, r.record_id));
    return local === undefined || local <= Date.parse(r.changed_at);
  });
}

/** The newest server time seen, for the next pull's cursor. */
export function nextCursor(rows: RemoteRow[], current: string | null): string | null {
  return rows.reduce<string | null>((max, r) => (max === null || r.synced_at > max ? r.synced_at : max), current);
}

/** Pull from a little before the cursor: rows committed in the same instant can arrive late. */
export function pullFrom(cursor: string | null, overlapMs = 5000): string | null {
  return cursor ? new Date(Date.parse(cursor) - overlapMs).toISOString() : null;
}

const DEFAULT_CHIPS = [["Coffee", 18_000], ["Auto", 12_000], ["Lunch", 35_000]] as const;
const isUntouchedDefaultChip = (data: unknown) => {
  const c = data as { title?: string; amount?: number };
  return DEFAULT_CHIPS.some(([title, amount]) => c?.title === title && c?.amount === amount);
};

export interface LocalRecord { store: StoreName; value: unknown }

/**
 * First sign-in on a device: after downloading the account's data, which local records to upload.
 * Anything the account already has stays as the account has it. A fresh device's default repeats
 * (Coffee, Auto, Lunch) aren't uploaded on top of an account that already has repeats; they're
 * removed from the device instead.
 */
export function firstSignInPlan(local: LocalRecord[], remote: RemoteRow[]): { uploads: Change[]; dropChipIds: string[] } {
  const remoteKeys = new Set(remote.filter((r) => !r.deleted).map((r) => changeKey(r.kind, r.record_id)));
  const accountHasChips = remote.some((r) => r.kind === "chip" && !r.deleted);
  const out: Change[] = [];
  const dropChipIds: string[] = [];
  for (const rec of local) {
    const s = toSyncData(rec.store, rec.value);
    if (!s) continue;
    const key = changeKey(s.kind, s.id);
    if (remoteKeys.has(key)) continue;
    if (s.kind === "chip" && accountHasChips && isUntouchedDefaultChip(s.data)) {
      dropChipIds.push(s.id);
      continue;
    }
    // Uploaded as the oldest possible edit, so any change made on another device wins over it.
    out.push({ key, kind: s.kind, record_id: s.id, data: s.data, deleted: false, changedAt: 1 });
  }
  return { uploads: out, dropChipIds };
}
