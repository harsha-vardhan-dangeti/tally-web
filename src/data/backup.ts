import { isCustomId, resolveCategories, type Category } from "../core/categories";
import type { Account, AccountKind, Bill, CategoryBudget, Chip, Expense, Goal, Income, RecurringIncome, Settings, Source, Transfer } from "./store";

/** Checks a backup file completely before anything on the device is replaced. Pure: no storage access. */

export const BACKUP_VERSION = 1;

export interface Backup {
  exportedAt: string | null;
  expenses: Expense[];
  chips: Chip[];
  budgets: CategoryBudget[];
  bills: Bill[];
  accounts: Account[];
  goals: Goal[];
  incomes: Income[];
  recurringIncomes: RecurringIncome[];
  transfers: Transfer[];
  settings: Partial<Settings>;
  /** Rows outside expenses that were unreadable and left out. */
  skipped: number;
}

export class BackupError extends Error {}

const SOURCES: Source[] = ["manual", "smart", "shortcut", "capture", "receipt", "recurring", "import"];
const KINDS: AccountKind[] = ["bank", "card", "cash", "investment"];

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const bool = (v: unknown) => v === true;
const paise = (v: unknown) => (Number.isSafeInteger(v) && (v as number) > 0 ? (v as number) : null);
const int = (v: unknown, fallback: number) => (Number.isSafeInteger(v) ? (v as number) : fallback);
const time = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const id = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

function expense(r: unknown, i: number, category: (v: unknown) => Category): Expense {
  const where = `Expense ${i + 1} in this file`;
  if (!isRow(r)) throw new BackupError(`${where} is unreadable.`);
  const rowId = id(r.id), amount = paise(r.amount), occurredAt = time(r.occurredAt);
  if (!rowId) throw new BackupError(`${where} has no ID.`);
  if (amount === null) throw new BackupError(`${where} has no valid amount.`);
  if (occurredAt === null) throw new BackupError(`${where} has no valid date.`);
  return {
    id: rowId, amount, occurredAt,
    merchant: str(r.merchant), note: str(r.note), category: category(r.category), account: str(r.account),
    createdAt: time(r.createdAt) ?? occurredAt,
    source: SOURCES.includes(r.source as Source) ? (r.source as Source) : "import",
    pending: bool(r.pending), splitWays: Math.max(int(r.splitWays, 1), 1), splitWith: str(r.splitWith),
    exclude: bool(r.exclude), recurring: bool(r.recurring),
  };
}

function optionalRows<T>(list: unknown, read: (r: Row) => T | null): { rows: T[]; skipped: number } {
  if (list === undefined) return { rows: [], skipped: 0 };
  if (!Array.isArray(list)) return { rows: [], skipped: 1 };
  const rows = list.map((r) => (isRow(r) ? read(r) : null)).filter((r): r is T => r !== null);
  return { rows, skipped: list.length - rows.length };
}

/** Last row wins when a file lists the same ID twice. */
const uniqueBy = <T,>(rows: T[], key: (r: T) => string) => [...new Map(rows.map((r) => [key(r), r])).values()];

export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError("This file isn't a Tally backup. Choose a file named like tally-backup-2026-10-24.json.");
  }
  if (!isRow(data) || data.app !== "tally" || !Array.isArray(data.expenses)) {
    throw new BackupError("This file isn't a Tally backup. Choose a file named like tally-backup-2026-10-24.json.");
  }
  if (typeof data.version === "number" && data.version > BACKUP_VERSION) {
    throw new BackupError("This backup was made by a newer version of Tally. Reload Tally to update it, then restore again.");
  }

  // The file's own categories come first: its expenses may use ones the user added.
  const s = isRow(data.settings) ? data.settings : {};
  const defs = resolveCategories(s.categories);
  const known = new Set(defs.map((d) => d.id));
  const category = (v: unknown): Category => (typeof v === "string" && known.has(v) ? v : "other");

  const expenses = uniqueBy(data.expenses.map((r, i) => expense(r, i, category)), (e) => e.id);
  const chips = optionalRows<Chip>(data.chips, (r) => {
    const rowId = id(r.id), amount = paise(r.amount);
    return rowId && amount && str(r.title) ? { id: rowId, title: str(r.title), amount, category: category(r.category), order: int(r.order, 0) } : null;
  });
  const budgets = optionalRows<CategoryBudget>(data.budgets, (r) => {
    const limit = paise(r.limit);
    return typeof r.category === "string" && known.has(r.category) && limit ? { category: r.category, limit } : null;
  });
  const bills = optionalRows<Bill>(data.bills, (r) => {
    const rowId = id(r.id), amount = paise(r.amount), day = int(r.day, 0);
    if (!rowId || !amount || !str(r.name) || day < 1 || day > 31) return null;
    return {
      id: rowId, name: str(r.name), amount, prevAmount: paise(r.prevAmount) ?? amount, day, category: category(r.category),
      account: str(r.account), isSubscription: bool(r.isSubscription), autoLog: bool(r.autoLog), lastLoggedMonth: str(r.lastLoggedMonth),
    };
  });
  const accounts = optionalRows<Account>(data.accounts, (r) => {
    const rowId = id(r.id);
    if (!rowId || !str(r.name) || !KINDS.includes(r.kind as AccountKind) || !Number.isSafeInteger(r.balance)) return null;
    return { id: rowId, name: str(r.name), kind: r.kind as AccountKind, balance: r.balance as number, order: int(r.order, 0), updatedAt: time(r.updatedAt) ?? Date.now() };
  });
  const goals = optionalRows<Goal>(data.goals, (r) => {
    const rowId = id(r.id), target = paise(r.target);
    if (!rowId || !target || !str(r.name)) return null;
    return { id: rowId, name: str(r.name), target, saved: Math.max(int(r.saved, 0), 0), deadline: time(r.deadline) };
  });

  // Backups from before income entries existed simply have none.
  const incomes = optionalRows<Income>(data.incomes, (r) => {
    const rowId = id(r.id), amount = paise(r.amount), receivedAt = time(r.receivedAt);
    if (!rowId || !amount || receivedAt === null) return null;
    return { id: rowId, amount, receivedAt, source: str(r.source), note: str(r.note), account: str(r.account), createdAt: time(r.createdAt) ?? receivedAt };
  });

  const recurringIncomes = optionalRows<RecurringIncome>(data.recurringIncomes, (r) => {
    const rowId = id(r.id), amount = paise(r.amount), day = int(r.day, 0);
    if (!rowId || !amount || day < 1 || day > 28) return null;
    return { id: rowId, amount, day, source: str(r.source), account: str(r.account), note: str(r.note),
      autoLog: r.autoLog !== false, lastLoggedMonth: str(r.lastLoggedMonth) };
  });

  const transfers = optionalRows<Transfer>(data.transfers, (r) => {
    const rowId = id(r.id), fromId = id(r.fromId), toId = id(r.toId), amount = paise(r.amount), occurredAt = time(r.occurredAt);
    if (!rowId || !fromId || !toId || fromId === toId || !amount || occurredAt === null) return null;
    return { id: rowId, fromId, toId, fromName: str(r.fromName), toName: str(r.toName), amount, note: str(r.note), occurredAt,
      createdAt: time(r.createdAt) ?? occurredAt };
  });

  const settings: Partial<Settings> = {};
  if (typeof s.onboarded === "boolean") settings.onboarded = s.onboarded;
  if (Number.isSafeInteger(s.monthlyBudget) && (s.monthlyBudget as number) >= 0) settings.monthlyBudget = s.monthlyBudget as number;
  if (Number.isSafeInteger(s.monthlyIncome) && (s.monthlyIncome as number) >= 0) settings.monthlyIncome = s.monthlyIncome as number;
  if (typeof s.defaultAccount === "string" && s.defaultAccount) settings.defaultAccount = s.defaultAccount;
  // Only what differs from the built-ins is kept, in the checked form.
  if (Array.isArray(s.categories)) settings.categories = defs.filter((d) => isCustomId(d.id) || (s.categories as unknown[]).some((c) => isRow(c) && c.id === d.id));

  return {
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : null,
    expenses,
    chips: uniqueBy(chips.rows, (r) => r.id),
    budgets: uniqueBy(budgets.rows, (r) => r.category),
    bills: uniqueBy(bills.rows, (r) => r.id),
    accounts: uniqueBy(accounts.rows, (r) => r.id),
    goals: uniqueBy(goals.rows, (r) => r.id),
    incomes: uniqueBy(incomes.rows, (r) => r.id),
    recurringIncomes: uniqueBy(recurringIncomes.rows, (r) => r.id),
    transfers: uniqueBy(transfers.rows, (r) => r.id),
    settings,
    skipped: chips.skipped + budgets.skipped + bills.skipped + accounts.skipped + goals.skipped + incomes.skipped + recurringIncomes.skipped
      + transfers.skipped,
  };
}
