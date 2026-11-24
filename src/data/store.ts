import { useSyncExternalStore } from "react";
import { db, type StoreName } from "./db";
import { categoryMeta, guessCategory, isCategory, setCategoryDefs, toCategory, type Category, type CategoryDef } from "../core/categories";
import { matchRule, sanitizeRules, setRules, type Rule } from "../core/rules";
import { detectRecurring, merchantKey, type RecurringCharge } from "../core/recurring";
import type { ColumnMap } from "../core/statement";
import {
  crossedThreshold, monthKey, monthRange, periodBounds, sameDay, setMonthStartDay, snapshot, type BudgetPeriod, type BudgetSnapshot,
} from "../core/budget";
import { dueInPeriod, nextDueDate, periodKey, type Every } from "../core/schedule";
import { cardBill, cardCycle, cardPeriods, cardUsage, type CardBill, type CardUsage } from "../core/cards";
import { dueDate as emiDate } from "../core/loans";
import { formatMoney, isCurrency, setCurrency } from "../core/money";
import { myShareOf } from "../core/smartParser";
import type { PlannedRow } from "../core/splitwise";
import { emiFor, loanStatus, dueDate, type LoanTerms } from "../core/loans";
import type { LedgerKind } from "../core/people";
import { isLang, setLanguage, type Lang } from "../i18n";
import { track } from "./telemetry";
import { parseBackup, type Backup } from "./backup";

export type Source = "manual" | "smart" | "shortcut" | "capture" | "receipt" | "recurring" | "import";
export const SOURCE_LABEL: Record<Source, string> = {
  manual: "Logged in Tally", smart: "Smart add", shortcut: "Logged from a Shortcut",
  capture: "Captured payment", receipt: "Scanned receipt", recurring: "Recurring bill", import: "Imported",
};

export interface Expense {
  id: string;
  amount: number; // paise
  merchant: string;
  note: string;
  category: Category;
  account: string;
  occurredAt: number; // epoch ms
  createdAt: number;
  source: Source;
  pending: boolean;
  splitWays: number;
  splitWith: string;
  exclude: boolean;
  recurring: boolean;
  /** Split, and someone else paid: their name. Empty or missing: you paid. */
  paidBy?: string;
  /** A bill in one of your groups (Settings.groups id). */
  group?: string;
  /** Unequal split: your part (what counts as your spending) and each other person's, by name. Missing: equal shares. */
  myShare?: number;
  shares?: Record<string, number>;
  /** Paid in another currency: what was paid and the rate used (home currency per unit). */
  fx?: { currency: string; amount: number; rate: number };
  /** A subcategory of `category` (Settings → Categories). */
  sub?: string;
  /** Lowercase, without "#". */
  tags?: string[];
  /** A card purchase converted to EMI: the loan that now carries it. It no longer adds to the card's
   *  balance or the budget; each month's EMI does instead. */
  emiLoan?: string;
  /** true: already in the account's balance as entered, so it doesn't move it; false: moves it even though
   *  it was recorded before the balance was entered. Missing: the usual rule (see `applies`). */
  inBalance?: boolean;
}
export interface Chip { id: string; title: string; amount: number; category: Category; order: number }
export interface CategoryBudget {
  category: Category;
  limit: number;
  /** Missing: monthly. */
  period?: BudgetPeriod;
}
export interface Bill {
  id: string; name: string; amount: number; prevAmount: number; day: number; category: Category;
  account: string; isSubscription: boolean; autoLog: boolean;
  /** Key of the last period whose payment was added (see core/schedule.ts): "2026-11", "2026" or "w2026-11-09". */
  lastLoggedMonth: string;
  /** Missing: every month on `day`. */
  every?: Every;
  weekday?: number;
  month?: number;
  /** When it was cancelled: no payments are due after this, and it's out of reminders and totals. */
  cancelledAt?: number;
}
export type AccountKind = "bank" | "card" | "cash" | "investment";
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = { bank: "Bank", card: "Credit card", cash: "Cash", investment: "Investment" };
export interface Account {
  id: string; name: string; kind: AccountKind; balance: number; order: number; updatedAt: number;
  /** Balance at the last update in each month ("2026-10" → paise), for net worth over time. */
  history?: Record<string, number>;
  /**
   * Follows its transactions: expenses paid from it and income into it (matched by name) move the
   * balance on from `balance` as of `updatedAt`.
   */
  tracked?: boolean;
  /** When you last entered the balance yourself (transfers also re-set `updatedAt`; this stays). */
  balanceSetAt?: number;
  /** Balance kept in another currency; net worth converts it at the rate in settings.fxRates. */
  currency?: string;
  /** Credit cards: day the statement is made and day the bill is due (1–31). */
  statementDay?: number;
  dueDay?: number;
  /** Credit cards: the credit limit, in paise. */
  limit?: number;
  /** Credit cards: the account that pays the bill, and whether Tally records that payment on the due date. */
  payFrom?: string;
  autoPay?: boolean;
  /**
   * Investments: money put in so far, as of `investedAt`. Transfers in (like each SIP) add to it and
   * transfers out take from it, so returns are the balance (its value) minus what went in.
   */
  invested?: number;
  investedAt?: number;
}
/** A transfer that repeats every month on `day`, like a SIP. */
export interface ScheduledTransfer {
  id: string; fromId: string; toId: string; amount: number; day: number; note: string; lastLoggedMonth: string;
}
export interface Goal { id: string; name: string; target: number; saved: number; deadline: number | null }
/** Money moved between two of the user's accounts. Not spending: it only changes the two balances. */
export interface Transfer {
  id: string;
  fromId: string;
  toId: string;
  /** Account names when it was made, for the history after an account is renamed or deleted. */
  fromName: string;
  toName: string;
  amount: number; // paise
  note: string;
  occurredAt: number; // epoch ms
  createdAt: number;
}
/** Income that arrives every month, like a salary. Added to income on its day, once per month. */
export interface RecurringIncome {
  id: string;
  source: string;
  amount: number; // paise
  day: number; // 1–28
  account: string;
  note: string;
  autoLog: boolean;
  lastLoggedMonth: string;
}
/** Money received on a given day: salary, a refund, freelance work. */
export interface Income {
  id: string;
  amount: number; // paise
  source: string;
  note: string;
  account: string;
  receivedAt: number; // epoch ms
  createdAt: number;
  /** From a bank statement import: goes by its date, not when it was added. */
  imported?: boolean;
  /** See Expense.inBalance. */
  inBalance?: boolean;
}
/** Money lent to or borrowed from someone, or paid back (see core/people.ts). */
export interface LedgerEntry {
  id: string;
  person: string;
  /** Change in what the person owes you, in paise: lent +, borrowed −, paid back moves it toward 0. */
  amount: number;
  kind: LedgerKind;
  note: string;
  occurredAt: number;
  createdAt: number;
  /**
   * The account the money left (amount +: you lent, or paid them back) or came into (amount −: you
   * borrowed, or they paid you back). A tracked account's balance moves with it.
   */
  account?: string;
  /** See Expense.inBalance. */
  inBalance?: boolean;
  /** A payment or share in one of your groups (Settings.groups id). */
  group?: string;
}
/** A loan repaid in EMIs (see core/loans.ts). Each month's EMI can be added to expenses on its day. */
export interface Loan extends LoanTerms {
  id: string;
  name: string;
  lender: string;
  category: Category;
  account: string;
  autoLog: boolean;
  /** "2026-11": the last month whose EMI was added to expenses. */
  lastLoggedMonth: string;
  createdAt: number;
  /** A credit card purchase converted to EMI: the expense it came from. */
  fromExpense?: string;
}

export interface Settings {
  onboarded: boolean;
  monthlyBudget: number;
  monthlyIncome: number;
  defaultAccount: string;
  lockCredentialId: string | null;
  lastBackupAt: number | null;
  /** Changes to the built-in categories and the user's own categories (see resolveCategories). */
  categories: CategoryDef[];
  /** "Swiggy is always Food" (see rules.ts). */
  rules: Rule[];
  /** Repeating charges the user said aren't subscriptions (merchant keys from recurring.ts). */
  dismissedRecurring: string[];
  /** Column layouts the user confirmed for a bank's statement, keyed by its header row. */
  importLayouts: ImportLayout[];
  /** ISO code of the currency every amount is in. */
  currency: string;
  language: Lang;
  /** For payment requests: the name and UPI ID people pay. */
  payName: string;
  upiId: string;
  /** Last rate used per foreign currency (home currency per unit), to prefill the next one. */
  fxRates: Record<string, number>;
  /** Day the budget month starts, 1–28. */
  monthStartDay: number;
  /** Category id → its subcategory names. */
  subcategories: Record<string, string[]>;
  scheduledTransfers: ScheduledTransfer[];
  /** Minutes away before the app lock asks again (0: every time). */
  lockAfter: number;
  /** A payment method that always comes out of one account: "upi" → the HDFC account's id. */
  methodAccounts: Record<string, string>;
  /** Splitwise-style groups: a flat, a trip. Their bills are split expenses with `group` set. */
  groups: SplitGroup[];
}
/** People you share bills with. Members are names as in People; you aren't in the list. */
export interface SplitGroup { id: string; name: string; members: string[]; createdAt: number }
export interface ImportLayout { signature: string; columns: ColumnMap; account: string }

export interface State {
  ready: boolean;
  expenses: Expense[];
  chips: Chip[];
  budgets: CategoryBudget[];
  bills: Bill[];
  accounts: Account[];
  goals: Goal[];
  incomes: Income[];
  recurringIncomes: RecurringIncome[];
  transfers: Transfer[];
  ledger: LedgerEntry[];
  loans: Loan[];
  settings: Settings;
  /** When the last restore replaced this device's data; that data can be put back until the next restore. */
  restorePointAt: number | null;
}

const DEFAULT_SETTINGS: Settings = {
  onboarded: false, monthlyBudget: 0, monthlyIncome: 0, defaultAccount: "UPI", lockCredentialId: null, lastBackupAt: null, categories: [], rules: [], dismissedRecurring: [], importLayouts: [],
  currency: "INR", language: "en", payName: "", upiId: "", fxRates: {},
  monthStartDay: 1, subcategories: {}, scheduledTransfers: [], lockAfter: 0, methodAccounts: {}, groups: [],
};

let state: State = {
  ready: false, expenses: [], chips: [], budgets: [], bills: [], accounts: [], goals: [], incomes: [], recurringIncomes: [], transfers: [], ledger: [], loans: [],
  settings: DEFAULT_SETTINGS, restorePointAt: null,
};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function set(patch: Partial<State>) {
  if (patch.settings && patch.settings !== state.settings) {
    applySettings(patch.settings);
  }
  state = { ...state, ...patch };
  emit();
}

/** Module-level settings the formatting helpers read. */
function applySettings(settings: Settings) {
  setCategoryDefs(settings.categories);
  setRules(settings.rules);
  setCurrency(settings.currency);
  setLanguage(settings.language);
  setMonthStartDay(settings.monthStartDay);
}

/** Calls `l` after every state change; returns an unsubscribe function. */
export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useTally(): State {
  return useSyncExternalStore(subscribe, () => state);
}
export const getState = () => state;

export const uid = () =>
  (globalThis.crypto && "randomUUID" in crypto) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

const sortExpenses = (list: Expense[]) => [...list].sort((a, b) => b.occurredAt - a.occurredAt);

// ---------- load ----------

export async function load() {
  const [expenses, chips, budgets, bills, accounts, goals, incomes, recurringIncomes, transfers, ledger, loans, kv] = await Promise.all([
    db.all<Expense>("expenses"), db.all<Chip>("chips"), db.all<CategoryBudget>("budgets"), db.all<Bill>("bills"),
    db.all<Account>("accounts"), db.all<Goal>("goals"), db.all<Income>("incomes"),
    db.all<RecurringIncome>("recurringIncomes"), db.all<Transfer>("transfers"), db.all<LedgerEntry>("ledger"), db.all<Loan>("loans"),
    db.all<{ key: string; value: unknown }>("kv"),
  ]);
  const settingsRow = kv.find((r) => r.key === "settings");
  const settings = readSettings(settingsRow?.value);
  const restorePoint = kv.find((r) => r.key === RESTORE_POINT)?.value as RestorePoint | undefined;
  // Rows can arrive from links and other devices, so an unknown category never reaches the screens.
  applySettings(settings);
  const fix = <T extends { category: Category }>(x: T): T => ({ ...x, category: toCategory(x.category) });
  set({
    ready: true,
    expenses: sortExpenses(expenses.map(fix)),
    chips: chips.map(fix).sort((a, b) => a.order - b.order),
    budgets: budgets.filter((b) => isCategory(b.category)), bills: bills.map(fix),
    accounts: [...accounts].sort((a, b) => a.order - b.order), goals, incomes: sortIncomes(incomes), recurringIncomes,
    transfers: sortTransfers(transfers), ledger: sortLedger(ledger), loans: loans.map(fix).sort((a, b) => a.createdAt - b.createdAt), settings,
    restorePointAt: restorePoint?.savedAt ?? null,
  });
  if (chips.length === 0) await seedChips();
  runDueBills();
  runDueIncome();
  runDueLoans();
  runDueTransfers();
  runDueCardPayments();
  // Ask the browser not to evict our data under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
}

/** Settings as stored (perhaps by another device or an older version), with every list made safe to use. */
function readSettings(stored: unknown): Settings {
  const v = { ...DEFAULT_SETTINGS, ...(stored && typeof stored === "object" ? (stored as Partial<Settings>) : {}) };
  const list = <T,>(x: unknown, ok: (item: unknown) => boolean): T[] => (Array.isArray(x) ? (x.filter(ok) as T[]) : []);
  return {
    ...v,
    categories: list<CategoryDef>(v.categories, (c) => !!c && typeof c === "object"),
    rules: sanitizeRules(v.rules),
    dismissedRecurring: list<string>(v.dismissedRecurring, (k) => typeof k === "string"),
    importLayouts: list<ImportLayout>(v.importLayouts, (l) => !!l && typeof l === "object" && typeof (l as ImportLayout).signature === "string"
      && !!(l as ImportLayout).columns && typeof (l as ImportLayout).columns === "object"),
    currency: isCurrency(v.currency) ? v.currency : "INR",
    language: isLang(v.language) ? v.language : "en",
    payName: typeof v.payName === "string" ? v.payName.slice(0, 60) : "",
    upiId: typeof v.upiId === "string" ? v.upiId.slice(0, 100) : "",
    fxRates: v.fxRates && typeof v.fxRates === "object"
      ? Object.fromEntries(Object.entries(v.fxRates).filter(([k, r]) => isCurrency(k) && typeof r === "number" && r > 0 && Number.isFinite(r)))
      : {},
    monthStartDay: Number.isInteger(v.monthStartDay) && v.monthStartDay >= 1 && v.monthStartDay <= 28 ? v.monthStartDay : 1,
    subcategories: readSubcategories(v.subcategories),
    scheduledTransfers: readScheduledTransfers(v.scheduledTransfers),
    lockAfter: [0, 1, 5, 15, 60].includes(v.lockAfter) ? v.lockAfter : 0,
    methodAccounts: readMethodAccounts(v.methodAccounts),
  };
}

/** Payment method → account id, as stored, with anything malformed dropped. */
export function readMethodAccounts(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([k, id]) => typeof k === "string" && k.trim() && typeof id === "string" && id).slice(0, 50)) as Record<string, string>;
}

/** Repeating transfers as stored, with anything malformed dropped. */
export function readScheduledTransfers(v: unknown): ScheduledTransfer[] {
  if (!Array.isArray(v)) return [];
  return v.filter((t) => {
    const x = t as ScheduledTransfer;
    return !!x && typeof x.id === "string" && typeof x.fromId === "string" && typeof x.toId === "string" && x.fromId !== x.toId
      && Number.isSafeInteger(x.amount) && x.amount > 0 && Number.isInteger(x.day) && x.day >= 1 && x.day <= 28;
  }).map((x: ScheduledTransfer) => ({ id: x.id, fromId: x.fromId, toId: x.toId, amount: x.amount, day: x.day,
    note: typeof x.note === "string" ? x.note : "", lastLoggedMonth: typeof x.lastLoggedMonth === "string" ? x.lastLoggedMonth : "" }));
}

/** { food: ["Coffee", "Groceries"] } with only short, unique names. */
export function readSubcategories(v: unknown): Record<string, string[]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, names] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(names)) continue;
    const clean = [...new Set(names.filter((n): n is string => typeof n === "string").map((n) => n.trim().slice(0, 30)).filter(Boolean))].slice(0, 30);
    if (clean.length) out[k] = clean;
  }
  return out;
}

async function seedChips() {
  const chips: Chip[] = [
    // Fixed IDs: every device starts with the same three repeats, so syncing doesn't duplicate them.
    { id: "default-coffee", title: "Coffee", amount: 18_000, category: "food", order: 0 },
    { id: "default-auto", title: "Auto", amount: 12_000, category: "transport", order: 1 },
    { id: "default-lunch", title: "Lunch", amount: 35_000, category: "food", order: 2 },
  ];
  await db.putMany("chips", chips);
  set({ chips });
}

// ---------- selectors ----------

export const counts = (e: Expense) => !e.pending && !e.exclude;
export const share = (e: Expense) => myShareOf(e);
export const expenseTitle = (e: Expense) => e.merchant || e.note || categoryMeta(e.category).title;

export function inMonth(list: Expense[], d: Date) {
  const [start, end] = monthRange(d);
  return list.filter((e) => e.occurredAt >= start.getTime() && e.occurredAt < end.getTime());
}

export function monthSpent(list: Expense[], d: Date) {
  return inMonth(list, d).filter(counts).reduce((s, e) => s + share(e), 0);
}

export function budgetSnapshot(s: State, now = new Date()): BudgetSnapshot {
  const month = inMonth(s.expenses, now).filter(counts);
  const spent = month.reduce((t, e) => t + share(e), 0);
  const today = month.filter((e) => sameDay(new Date(e.occurredAt), now)).reduce((t, e) => t + share(e), 0);
  return snapshot(s.settings.monthlyBudget, spent, today, now);
}

/**
 * Repeating charges found in the expenses that aren't tracked as bills yet and that the user hasn't
 * dismissed. Bills' own auto-logged payments are left out, so a bill never suggests itself.
 */
export function recurringSuggestions(s: State, now = Date.now()): RecurringCharge[] {
  const tracked = new Set(s.bills.map((b) => merchantKey(b.name)));
  const charges = s.expenses
    .filter((e) => !e.pending && !e.id.startsWith("bill-"))
    .map((e) => ({ id: e.id, name: expenseTitle(e), amount: e.amount, occurredAt: e.occurredAt, category: e.category, account: e.account }));
  return detectRecurring(charges, { now, ignore: [...s.settings.dismissedRecurring, ...tracked] });
}

// ---------- toast ----------

export interface Toast { id: number; message: string; undo?: () => void }
let toast: Toast | null = null;
const toastListeners = new Set<() => void>();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(message: string, undo?: () => void) {
  toast = { id: Date.now(), message, undo };
  toastListeners.forEach((l) => l());
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast = null; toastListeners.forEach((l) => l()); }, 5000);
}
export function dismissToast() { toast = null; toastListeners.forEach((l) => l()); }
export function useToast() {
  return useSyncExternalStore((l) => { toastListeners.add(l); return () => toastListeners.delete(l); }, () => toast);
}

// ---------- writes ----------

// ---------- change tracking (for sync) ----------

type ChangeListener = (store: StoreName, key: string, value: unknown | null) => void;
let changeListener: ChangeListener | null = null;
/** While signed in, cloud.ts hears about every local write so it can upload it. */
export function onLocalChange(fn: ChangeListener | null) { changeListener = fn; }

const keyOf = (store: StoreName, value: unknown) => {
  const v = value as Record<string, string>;
  return store === "budgets" ? v.category : store === "kv" ? v.key : v.id;
};

async function persist<T>(store: StoreName, value: T) {
  try {
    await db.put(store, value);
    changeListener?.(store, keyOf(store, value), value);
  } catch {
    showToast("Couldn't save to this browser's storage");
  }
}

async function remove(store: StoreName, key: string) {
  try {
    await db.delete(store, key);
    changeListener?.(store, key, null);
  } catch {
    showToast("Couldn't save to this browser's storage");
  }
}

/** Every record in the app, for the first upload when a device signs in. */
export function allRecords(): { store: StoreName; value: unknown }[] {
  const { expenses, incomes, recurringIncomes, chips, budgets, bills, accounts, goals, transfers, ledger, loans, settings } = state;
  return [
    ...expenses.map((value) => ({ store: "expenses" as const, value })),
    ...incomes.map((value) => ({ store: "incomes" as const, value })),
    ...recurringIncomes.map((value) => ({ store: "recurringIncomes" as const, value })),
    ...chips.map((value) => ({ store: "chips" as const, value })),
    ...budgets.map((value) => ({ store: "budgets" as const, value })),
    ...bills.map((value) => ({ store: "bills" as const, value })),
    ...accounts.map((value) => ({ store: "accounts" as const, value })),
    ...goals.map((value) => ({ store: "goals" as const, value })),
    ...transfers.map((value) => ({ store: "transfers" as const, value })),
    ...ledger.map((value) => ({ store: "ledger" as const, value })),
    ...loans.map((value) => ({ store: "loans" as const, value })),
    { store: "kv" as const, value: { key: "settings", value: settings } },
  ];
}

/** After a restore, undo or erase, report what disappeared and what's there now. */
function reportReplaced(before: { store: StoreName; value: unknown }[]) {
  if (!changeListener) return;
  const after = allRecords();
  const now = new Set(after.map((r) => `${r.store}:${keyOf(r.store, r.value)}`));
  for (const r of before) {
    const key = keyOf(r.store, r.value);
    if (!now.has(`${r.store}:${key}`)) changeListener(r.store, key, null);
  }
  for (const r of after) changeListener(r.store, keyOf(r.store, r.value), r.value);
}

export interface NewExpense {
  amount: number; category: Category; merchant?: string; note?: string; account?: string | null;
  occurredAt?: number; source: Source; pending?: boolean; splitWays?: number; splitWith?: string; paidBy?: string;
  sub?: string; tags?: string[]; group?: string; myShare?: number; shares?: Record<string, number>;
  /** For callers that may log the same expense twice, e.g. a bill auto-logged on two devices. */
  id?: string;
  /** Already in the paying account's balance as entered (see Expense.inBalance). */
  inBalance?: boolean;
}

/** The single write path for every way of logging. */
export function addExpense(input: NewExpense): Expense {
  const existing = input.id ? state.expenses.find((x) => x.id === input.id) : undefined;
  if (existing) return existing;
  const before = monthSpent(state.expenses, new Date());
  const e: Expense = {
    id: input.id ?? uid(), amount: input.amount, merchant: input.merchant ?? "", note: input.note ?? "",
    category: toCategory(input.category), account: resolveAccount(input.account || state.settings.defaultAccount),
    occurredAt: input.occurredAt ?? Date.now(), createdAt: Date.now(), source: input.source,
    pending: input.pending ?? false, splitWays: Math.max(input.splitWays ?? 1, 1), splitWith: input.splitWith ?? "",
    exclude: false, recurring: false, ...(input.paidBy ? { paidBy: input.paidBy } : {}),
    ...(input.sub ? { sub: input.sub } : {}), ...(input.tags?.length ? { tags: input.tags } : {}),
    ...(input.inBalance ? { inBalance: true } : {}), ...(input.group ? { group: input.group } : {}),
    ...(input.myShare !== undefined && input.shares ? { myShare: input.myShare, shares: input.shares } : {}),
  };
  set({ expenses: sortExpenses([e, ...state.expenses]) });
  void persist("expenses", e);
  checkThreshold(before);
  checkCardLimit(e);
  track("expense_added", { source: e.source, split: e.splitWays > 1 });
  return e;
}

function checkThreshold(before: number) {
  const after = monthSpent(state.expenses, new Date());
  const pct = crossedThreshold(before, after, state.settings.monthlyBudget);
  if (pct) {
    const left = state.settings.monthlyBudget - after;
    setTimeout(() => showToast(pct === 100
      ? `Monthly budget used up · ${formatMoney(-left)} over`
      : `80% of budget used · ${formatMoney(left)} left`), 1200);
  }
}

export function updateExpense(id: string, patch: Partial<Expense>) {
  const list = state.expenses.map((e) => (e.id === id ? keepShares(e, { ...e, ...patch }) : e));
  set({ expenses: sortExpenses(list) });
  const updated = list.find((e) => e.id === id);
  if (updated) void persist("expenses", updated);
}

/**
 * An unequal split stays consistent through edits: a new amount scales every share (you take the
 * rounding); changing who it's split with, or how many ways, makes it an equal split again.
 */
export function keepShares(before: Expense, after: Expense): Expense {
  if (!after.shares || after.myShare === undefined) return after;
  const { myShare: _m, shares: _s, ...equal } = after;
  if (after.splitWays !== before.splitWays || after.splitWith !== before.splitWith || after.splitWays < 2) return equal;
  if (after.amount === before.amount || before.amount <= 0) return after;
  const shares = Object.fromEntries(Object.entries(after.shares).map(([n, v]) => [n, Math.floor((v * after.amount) / before.amount)]));
  const others = Object.values(shares).reduce((t, v) => t + v, 0);
  return { ...after, shares, myShare: Math.max(after.amount - others, 0) };
}

export function deleteExpense(id: string, withUndo = true) {
  const victim = state.expenses.find((e) => e.id === id);
  if (!victim) return;
  set({ expenses: state.expenses.filter((e) => e.id !== id) });
  void remove("expenses", id);
  if (withUndo) {
    showToast(`Deleted ${expenseTitle(victim)} · ${formatMoney(victim.amount)}`, () => {
      set({ expenses: sortExpenses([victim, ...state.expenses]) });
      void persist("expenses", victim);
    });
  }
}

export function setSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  set({ settings });
  void persist("kv", { key: "settings", value: settings });
}

export function saveChip(chip: Chip) {
  const exists = state.chips.some((c) => c.id === chip.id);
  const chips = exists ? state.chips.map((c) => (c.id === chip.id ? chip : c)) : [...state.chips, chip];
  set({ chips });
  void persist("chips", chip);
}
export function deleteChip(id: string) {
  set({ chips: state.chips.filter((c) => c.id !== id) });
  void remove("chips", id);
}

export function saveBudget(b: CategoryBudget) {
  set({ budgets: [...state.budgets.filter((x) => x.category !== b.category), b] });
  void persist("budgets", b);
}
export function deleteBudget(category: Category) {
  set({ budgets: state.budgets.filter((b) => b.category !== category) });
  void remove("budgets", category);
}

export function saveBill(bill: Bill) {
  const exists = state.bills.some((b) => b.id === bill.id);
  set({ bills: exists ? state.bills.map((b) => (b.id === bill.id ? bill : b)) : [...state.bills, bill] });
  void persist("bills", bill);
}
export function deleteBill(id: string) {
  set({ bills: state.bills.filter((b) => b.id !== id) });
  void remove("bills", id);
}

export function saveAccount(input: Account) {
  // Keep this month's balance, and up to three years of month-end balances, for net worth over time.
  const keys = Object.keys(input.history ?? {}).sort().slice(-35);
  const a: Account = { ...input, history: { ...Object.fromEntries(keys.map((k) => [k, input.history![k]])), [monthKey(new Date())]: input.balance } };
  const exists = state.accounts.some((x) => x.id === a.id);
  set({ accounts: exists ? state.accounts.map((x) => (x.id === a.id ? a : x)) : [...state.accounts, a] });
  void persist("accounts", a);
}
export function deleteAccount(id: string) {
  set({ accounts: state.accounts.filter((a) => a.id !== id) });
  void remove("accounts", id);
}

// ---------- transfers ----------

const sortTransfers = (list: Transfer[]) => [...list].sort((a, b) => b.occurredAt - a.occurredAt);

/**
 * An account after `amount` paise go into it (negative: come out of it). A card's balance is what's
 * owed, so money into a card pays it down and money out of it adds to the debt.
 */
/** A preview: the account as it would be after `amount` comes in (− goes out). Nothing is saved. */
export const moneyIn = (a: Account, amount: number): Account =>
  ({ ...a, balance: liveBalance(a) + (a.kind === "card" ? -amount : amount), updatedAt: Date.now() });

const nameKey = (v: string) => v.trim().toLowerCase();

/** What money can be paid from or into: the usual methods, the user's accounts, and `current` if it's something else. */
export function accountChoices(s: Pick<State, "accounts">, current?: string): string[] {
  const list = ["UPI", "Cash", "Credit card", ...s.accounts.map((a) => a.name)];
  if (current?.trim()) list.push(current.trim());
  const seen = new Set<string>();
  return list.filter((n) => { const k = nameKey(n); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The account with this name, if the user has one. */
export const accountNamed = (s: Pick<State, "accounts">, name: string) => s.accounts.find((a) => !!name && nameKey(a.name) === nameKey(name));
const isAccount = (a: Account, name: string) => !!name && nameKey(name) === nameKey(a.name);

/**
 * Whether an entry moves an account's balance. The balance you enter is the truth at that moment, so
 * anything recorded before it is taken to be in it; anything you record after it moves it, whatever date
 * it carries (a salary from the 1st logged on the 16th still lands). Statement imports go by their date,
 * since they're usually old. `inBalance` overrides both ways.
 */
function applies(a: Account, at: number, createdAt: number, imported: boolean, inBalance: boolean | undefined): boolean {
  if (inBalance !== undefined) return !inBalance;
  return at > a.updatedAt || (!imported && createdAt > a.updatedAt);
}
export const expenseApplies = (a: Account, e: Expense) => applies(a, e.occurredAt, e.createdAt, e.source === "import", e.inBalance);
export const incomeApplies = (a: Account, x: Income) => applies(a, x.receivedAt, x.createdAt, !!x.imported, x.inBalance);
export const ledgerApplies = (a: Account, l: LedgerEntry) => applies(a, l.occurredAt, l.createdAt, false, l.inBalance);
/** Transfers made before the balance was entered (or, from older versions, already added into it) don't count again. */
export const transferApplies = (a: Account, t: Transfer) => t.createdAt > a.updatedAt;

/** Spending on an account that counts: you paid, it wasn't moved to an EMI plan, and it isn't waiting for review. */
const spent = (e: Expense) => !e.pending && !e.paidBy && !e.emiLoan;

/**
 * Income, expenses and money lent or borrowed through an account that move its balance (see `applies`).
 * Split expenses paid by someone else never left your account.
 */
function netFlow(a: Account, s: FlowState = state): { in: number; out: number } {
  let inflow = 0, out = 0;
  for (const e of s.expenses) if (spent(e) && isAccount(a, e.account) && expenseApplies(a, e)) out += e.amount;
  for (const x of s.incomes) if (isAccount(a, x.account) && incomeApplies(a, x)) inflow += x.amount;
  // Money lent or paid back left the account; money borrowed or paid back to you came into it.
  for (const l of s.ledger ?? []) {
    if (!l.account || !isAccount(a, l.account) || !ledgerApplies(a, l)) continue;
    if (l.amount > 0) out += l.amount; else inflow -= l.amount;
  }
  return { in: inflow, out };
}

/** Transfers into an account minus transfers out, since its balance was entered. They move every account, followed or not. */
function transferFlow(a: Account, s: FlowState = state): number {
  let n = 0;
  for (const t of s.transfers ?? []) {
    if (!transferApplies(a, t)) continue;
    if (t.toId === a.id) n += t.amount; else if (t.fromId === a.id) n -= t.amount;
  }
  return n;
}

/** What went through an account after `since`, by date: for a card's bill, what was charged since the statement. */
function flowSince(a: Account, since: number, s: FlowState = state): { in: number; out: number } {
  let inflow = 0, out = 0;
  for (const e of s.expenses) if (spent(e) && e.occurredAt > since && isAccount(a, e.account)) out += e.amount;
  for (const x of s.incomes) if (x.receivedAt > since && isAccount(a, x.account)) inflow += x.amount;
  for (const l of s.ledger ?? []) {
    if (l.occurredAt <= since || !l.account || !isAccount(a, l.account)) continue;
    if (l.amount > 0) out += l.amount; else inflow -= l.amount;
  }
  return { in: inflow, out };
}
type FlowState = Pick<State, "expenses" | "incomes"> & { ledger?: LedgerEntry[]; transfers?: Transfer[] };

/**
 * An account's balance now: what you last entered, plus transfers since, plus — for an account that
 * follows its transactions — the income, expenses and money to people recorded since.
 */
export function liveBalance(a: Account, s: FlowState = state): number {
  const sign = a.kind === "card" ? -1 : 1;
  const moved = transferFlow(a, s);
  if (!a.tracked || (a.currency && a.currency !== state.settings.currency)) return a.balance + sign * moved;
  const f = netFlow(a, s);
  return a.balance + sign * (f.in - f.out + moved);
}

/** In the home currency, for net worth: a foreign-currency balance at the saved rate (none: left out). */
export function homeBalance(a: Account, s: State = state): number {
  const live = liveBalance(a, s);
  if (!a.currency || a.currency === s.settings.currency) return live;
  const rate = s.settings.fxRates[a.currency];
  return rate ? Math.round(live * rate) : 0;
}

/** Accounts as of now, in the home currency: what net worth and totals are built from. */
export function accountsNow(s: State = state): Account[] {
  const now = Date.now();
  return s.accounts.map((a) => ({ ...a, balance: homeBalance(a, s), updatedAt: Math.max(a.updatedAt, now) }));
}

// ---------- investments and SIPs ----------

/** Money put into an investment so far: what was entered, plus transfers in since, minus transfers out. */
export function netInvested(a: Account, s: Pick<State, "transfers"> = state): number | null {
  if (a.kind !== "investment" || a.invested === undefined) return null;
  const since = a.investedAt ?? 0;
  let v = a.invested;
  for (const t of s.transfers) {
    if (t.createdAt <= since) continue;
    if (t.toId === a.id) v += t.amount;
    else if (t.fromId === a.id) v -= t.amount;
  }
  return Math.max(0, v);
}

export interface InvestmentReturn { value: number; invested: number; gain: number; pct: number | null }

/** Value, money put in, and the gain on it. Null until you've said how much went in. */
export function investmentReturn(a: Account, s: State = state): InvestmentReturn | null {
  const invested = netInvested(a, s);
  if (invested === null) return null;
  const value = homeBalance(a, s);
  const gain = value - invested;
  return { value, invested, gain, pct: invested > 0 ? gain / invested : null };
}

/** The repeating transfers into an investment: its SIPs. */
export const sipsInto = (a: Account, s: Pick<State, "settings"> = state) => s.settings.scheduledTransfers.filter((t) => t.toId === a.id);

export interface InvestmentsSummary {
  count: number;
  value: number;
  /** Across the investments where you've entered what went in. */
  invested: number;
  gain: number;
  withReturns: number;
  sipCount: number;
  sipMonthly: number;
}

export function investmentsSummary(s: State = state): InvestmentsSummary {
  const list = s.accounts.filter((a) => a.kind === "investment");
  const ids = new Set(list.map((a) => a.id));
  const sips = s.settings.scheduledTransfers.filter((t) => ids.has(t.toId));
  let invested = 0, gain = 0, withReturns = 0;
  for (const a of list) {
    const r = investmentReturn(a, s);
    if (!r) continue;
    invested += r.invested; gain += r.gain; withReturns++;
  }
  return { count: list.length, value: list.reduce((t, a) => t + homeBalance(a, s), 0), invested, gain, withReturns,
    sipCount: sips.length, sipMonthly: sips.reduce((t, x) => t + x.amount, 0) };
}

/** How much of a card's limit is used, from its balance now. */
export function cardLimitUsage(a: Account, s: State = state): CardUsage | null {
  return a.kind === "card" ? cardUsage(liveBalance(a, s), a.limit, cardEmiOutstanding(a, s)) : null;
}

/** EMI plans paid from this card (its EMIs are charged to it). */
export const cardEmis = (a: Account, s: Pick<State, "loans"> = state) => s.loans.filter((l) => isAccount(a, l.account));

/** Principal still to be billed across a card's EMI plans: it keeps that much of the limit blocked. */
export function cardEmiOutstanding(a: Account, s: Pick<State, "loans"> = state, now = Date.now()): number {
  return cardEmis(a, s).reduce((t, l) => t + loanStatus(l, now).outstanding, 0);
}

export interface EmiPlan { months: number; ratePct: number; fee: number; firstDueAt: number }

/**
 * Converts a card purchase to EMI, as banks do: the purchase moves off the card's balance (and out
 * of the budget) into an EMI plan charged to the card each month. A processing fee is charged now.
 */
export function convertToEmi(e: Expense, plan: EmiPlan): Loan | null {
  const card = state.accounts.find((a) => a.kind === "card" && isAccount(a, e.account));
  if (!card || e.emiLoan || plan.months < 1) return null;
  const loan: Loan = {
    id: uid(), name: expenseTitle(e), lender: card.name, principal: e.amount, ratePct: plan.ratePct, months: plan.months,
    emi: emiFor(e.amount, plan.ratePct, plan.months), firstDueAt: plan.firstDueAt, category: e.category, account: card.name,
    autoLog: true, lastLoggedMonth: "", createdAt: Date.now(), fromExpense: e.id,
  };
  // If the card's balance was set after this purchase, it includes it: take it out, as the bank does.
  if (card.tracked && !expenseApplies(card, e)) saveAccount({ ...card, balance: card.balance - e.amount, updatedAt: card.updatedAt });
  updateExpense(e.id, { emiLoan: loan.id, exclude: true });
  saveLoan(loan);
  if (plan.fee > 0) {
    addExpense({ amount: plan.fee, category: "other", merchant: `EMI processing fee · ${loan.name}`, account: card.name, source: "manual" });
  }
  runDueLoans();
  return loan;
}

/** Credit left on the card called `name`, if it's one of the user's cards with a limit. */
export function creditLeft(name: string, s: State = state): { card: Account; usage: CardUsage } | null {
  const card = s.accounts.find((a) => a.kind === "card" && isAccount(a, name));
  const usage = card ? cardLimitUsage(card, s) : null;
  return card && usage ? { card, usage } : null;
}

/** After an expense on a card: a heads-up when it pushes the card past 80% or 100% of its limit. */
function checkCardLimit(e: Expense) {
  const left = creditLeft(e.account);
  if (!left || !left.card.tracked || e.paidBy || !expenseApplies(left.card, e)) return;
  const after = left.usage.used;
  const pct = crossedThreshold(after - e.amount, after, left.usage.limit);
  if (!pct) return;
  const name = left.card.name;
  setTimeout(() => showToast(pct === 100
    ? `${name} is over its limit by ${formatMoney(after - left.usage.limit)}`
    : `${name} is ${Math.round(left.usage.share * 100)}% used · ${formatMoney(left.usage.available)} left`), 2600);
}

/**
 * Card bills set to pay themselves: on the due date, a transfer of what's due from the paying
 * account. The transfer ID is fixed per card and due date, so it happens once on any device.
 */
export function runDueCardPayments(now = new Date()) {
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).getTime();
  for (const card of state.accounts) {
    if (card.kind !== "card" || !card.autoPay || !card.payFrom) continue;
    const bill = cardStatus(card, state, now);
    if (!bill?.due || bill.due.date.getTime() > endOfToday) continue;
    const d = bill.due.date;
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    addTransfer({ id: `cardpay-${card.id}-${key}`, fromId: card.payFrom, toId: card.id, amount: bill.due.amount, note: `${card.name} bill`,
      occurredAt: Math.min(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10).getTime(), now.getTime()) });
  }
}

export interface ScheduledFlow {
  key: string;
  /** Account name the money leaves (out) or reaches (in). */
  account: string;
  label: string;
  amount: number;
  at: number;
  direction: "out" | "in";
  kind: "bill" | "emi" | "transfer" | "card" | "income";
  /** The bill or loan it comes from, to open it. */
  ref?: string;
}

/**
 * Everything set to move money in the next `days` days, by account: bills and EMIs (from the
 * account they're paid from), repeating transfers, regular income, and card bills that pay
 * themselves. Plan uses it to show what's coming out of each account and whether it's enough.
 */
export function scheduledFlows(s: State = state, now = new Date(), days = 30): ScheduledFlow[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, 23, 59);
  const out: ScheduledFlow[] = [];
  const name = (id: string) => s.accounts.find((a) => a.id === id)?.name ?? "";
  for (const b of s.bills) {
    if (b.cancelledAt) continue;
    for (let d = nextDueDate(b, now), n = 0; d <= end && n < 6; d = nextDueDate(b, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)), n++) {
      if (periodKey(b, d) === b.lastLoggedMonth) continue; // this period's payment is already in
      out.push({ key: `bill-${b.id}-${d.getTime()}`, account: b.account, label: b.name, amount: b.amount, at: d.getTime(), direction: "out", kind: "bill", ref: b.id });
    }
  }
  for (const l of s.loans) {
    for (let k = 0; k < l.months; k++) {
      const d = emiDate(l.firstDueAt, k);
      if (d < today) continue;
      if (d > end) break;
      if (monthKey(d) === l.lastLoggedMonth) continue;
      out.push({ key: `emi-${l.id}-${k}`, account: l.account, label: `${l.name} EMI`, amount: l.emi, at: d.getTime(), direction: "out", kind: "emi", ref: l.id });
    }
  }
  const monthly = (day: number, last: string) => {
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), day);
    const d = thisMonth >= today && monthKey(thisMonth) !== last ? thisMonth : new Date(today.getFullYear(), today.getMonth() + 1, day);
    return d <= end ? d : null;
  };
  for (const t of s.settings.scheduledTransfers) {
    const d = monthly(t.day, t.lastLoggedMonth);
    if (!d) continue;
    const label = t.note || `Transfer to ${name(t.toId)}`;
    out.push({ key: `st-${t.id}-out`, account: name(t.fromId), label, amount: t.amount, at: d.getTime(), direction: "out", kind: "transfer" });
    out.push({ key: `st-${t.id}-in`, account: name(t.toId), label: t.note || `Transfer from ${name(t.fromId)}`, amount: t.amount, at: d.getTime(), direction: "in", kind: "transfer" });
  }
  for (const r of s.recurringIncomes) {
    const d = monthly(r.day, r.lastLoggedMonth);
    if (d) out.push({ key: `inc-${r.id}`, account: r.account, label: r.source || "Income", amount: r.amount, at: d.getTime(), direction: "in", kind: "income" });
  }
  for (const card of s.accounts) {
    if (card.kind !== "card" || !card.autoPay || !card.payFrom) continue;
    const bill = cardStatus(card, s, now);
    if (!bill?.due || bill.due.date > end) continue;
    const at = bill.due.date.getTime();
    out.push({ key: `cardpay-${card.id}-out`, account: name(card.payFrom), label: `${card.name} bill`, amount: bill.due.amount, at, direction: "out", kind: "card" });
    out.push({ key: `cardpay-${card.id}-in`, account: card.name, label: "Bill payment", amount: bill.due.amount, at, direction: "in", kind: "card" });
  }
  // "Bank" or "Credit card" means your bank or card when you have just one.
  return out.filter((f) => f.account).map((f) => ({ ...f, account: resolveAccount(f.account, s) })).sort((a, b) => a.at - b.at);
}

/** A credit card's bill: due amount and date from its statement and due days. */
export function cardStatus(a: Account, s: State = state, now = new Date()): CardBill | null {
  if (a.kind !== "card" || !a.statementDay || !a.dueDay) return null;
  const owed = liveBalance(a, s);
  let spentSince: number | null = null;
  if (a.tracked) {
    // Everything charged since the statement is still unbilled; payments (transfers in) lower the
    // balance, so what's left of the bill is the balance minus those charges.
    const since = cardCycle(a.statementDay, a.dueDay, now).lastStatement.getTime() - 1;
    const f = flowSince(a, since, s);
    spentSince = Math.max(0, f.out - f.in);
  }
  return cardBill(owed, spentSince, a.statementDay, a.dueDay, now);
}

// ---------- credit card activity ----------

const GENERIC_CARD = new Set(["credit card", "card", "credit"]);

/** "Credit card" without saying which one: the general method, not one of your accounts. */
export const isGenericCard = (name: string, s: Pick<State, "accounts"> = state) => GENERIC_CARD.has(nameKey(name)) && !accountNamed(s, name);

const GENERIC_BANK = new Set(["bank", "bank account"]);

/**
 * The account money goes to or comes from: "Credit card" means your card when you have exactly one,
 * and "Bank" your bank account when you have exactly one.
 */
export function resolveAccount(name: string, s: Pick<State, "accounts"> & { settings?: Pick<Settings, "methodAccounts"> } = state): string {
  if (accountNamed(s, name)) return name;
  // "UPI always comes out of HDFC": the account the user chose for this method.
  const mapped = (s.settings ?? state.settings).methodAccounts?.[nameKey(name)];
  const to = mapped ? s.accounts.find((a) => a.id === mapped) : undefined;
  if (to) return to.name;
  const kind = GENERIC_CARD.has(nameKey(name)) ? "card" : GENERIC_BANK.has(nameKey(name)) ? "bank" : null;
  if (!kind) return name;
  const list = s.accounts.filter((a) => a.kind === kind);
  return list.length === 1 ? list[0].name : name;
}

// ---------- income not linked to an account ----------

/** Incomes that went into something that isn't one of your accounts ("Bank", "UPI", nothing), so no balance has them. */
export const unlinkedIncomes = (s: Pick<State, "accounts" | "incomes"> = state) =>
  s.incomes.filter((x) => !accountNamed(s, x.account));

/** Regular incomes in the same state: each month's payment would land in no account. ("Bank" with one bank account does.) */
export const unlinkedIncomeRules = (s: Pick<State, "accounts" | "recurringIncomes"> = state) =>
  s.recurringIncomes.filter((r) => !accountNamed(s, resolveAccount(r.account, s)));

/**
 * The account money most likely moves through: the last one you used for this kind of entry, else
 * your default if it's one of your accounts, else your first bank, then cash account.
 */
export function likelyAccount(s: Pick<State, "accounts" | "settings">, recent: (string | undefined)[]): string {
  const used = recent.find((n) => !!n && accountNamed(s, n));
  if (used) return accountNamed(s, used)!.name;
  const def = accountNamed(s, s.settings.defaultAccount);
  if (def && def.kind !== "investment") return def.name;
  return s.accounts.find((a) => a.kind === "bank")?.name ?? s.accounts.find((a) => a.kind === "cash")?.name ?? s.settings.defaultAccount;
}

/**
 * Money lent, borrowed or paid back that went through no account of yours ("UPI", nothing), so no
 * balance has it. Entries from a Splitwise import are left out: those are shares of expenses, not money moved.
 */
export const unlinkedLedger = (s: Pick<State, "accounts" | "ledger"> = state) =>
  s.ledger.filter((l) => !l.id.startsWith("sw-") && !(l.account && accountNamed(s, l.account)));

/** Entries that, once on this account, still wouldn't move it: recorded before its balance was entered. */
const ledgerNotApplying = (a: Account, list: LedgerEntry[]) => (a.tracked ? list.filter((l) => !ledgerApplies(a, { ...l, account: a.name })) : []);

/** What linking would change an account's balance by, for entries recorded before its balance was entered (+ in, − out). */
export function ledgerBeforeBalance(a: Account, list: LedgerEntry[]): number {
  return ledgerNotApplying(a, list).reduce((t, l) => t - l.amount, 0);
}

/**
 * Puts money lent, borrowed or paid back through one of your accounts. Those recorded after its balance
 * was entered move it; earlier ones are taken to be in that balance, unless `addEarlier` marks them to
 * move it too. Returns an undo.
 */
export function linkLedger(accountId: string, ids: string[], addEarlier = false): () => void {
  const acct = state.accounts.find((a) => a.id === accountId);
  if (!acct) return () => {};
  const idSet = new Set(ids);
  const before = state.ledger.filter((l) => idSet.has(l.id));
  const older = new Set(addEarlier ? ledgerNotApplying(acct, before).map((l) => l.id) : []);
  const write = (list: LedgerEntry[]) => {
    const byId = new Map(list.map((l) => [l.id, l]));
    set({ ledger: sortLedger(state.ledger.map((l) => byId.get(l.id) ?? l)) });
    for (const l of list) void persist("ledger", l);
  };
  write(before.map((l) => ({ ...l, account: acct.name, ...(older.has(l.id) ? { inBalance: false } : {}) })));
  return () => write(before);
}

const incomeNotApplying = (a: Account, list: Income[]) => (a.tracked ? list.filter((x) => !incomeApplies(a, x)) : []);

/** What linking would add to an account's balance for income recorded before its balance was entered (see linkIncomes). */
export function incomeBeforeBalance(a: Account, list: Income[]): number {
  return incomeNotApplying(a, list).reduce((t, x) => t + x.amount, 0);
}

/**
 * Puts incomes (and regular incomes, for the months to come) into one of your accounts. On an account that
 * follows its transactions, those recorded after its balance was entered add to it; earlier ones are taken
 * to be in that balance, unless `addEarlier` marks them to add too. Returns an undo.
 */
export function linkIncomes(accountId: string, ids: string[], ruleIds: string[], addEarlier = false): () => void {
  const acct = state.accounts.find((a) => a.id === accountId);
  if (!acct) return () => {};
  const idSet = new Set(ids), ruleSet = new Set(ruleIds);
  const before = state.incomes.filter((x) => idSet.has(x.id));
  const rules = state.recurringIncomes.filter((r) => ruleSet.has(r.id));
  const older = new Set(addEarlier ? incomeNotApplying(acct, before).map((x) => x.id) : []);
  void importTransactions([], before.map((x) => ({ ...x, account: acct.name, ...(older.has(x.id) ? { inBalance: false } : {}) })));
  for (const r of rules) saveRecurringIncome({ ...r, account: acct.name });
  return () => {
    void importTransactions([], before);
    for (const r of rules) putRecurringIncome(r);
  };
}

/** Expenses you paid by card without saying which card. */
export const unlinkedCardExpenses = (s: Pick<State, "accounts" | "expenses"> = state) =>
  s.expenses.filter((e) => !e.paidBy && isGenericCard(e.account, s));

const expensesNotApplying = (card: Account, list: Expense[]) =>
  (card.tracked ? list.filter((e) => !e.emiLoan && !e.pending && !expenseApplies(card, e)) : []);

/**
 * Moves expenses paid with "Credit card" onto one of your cards. On a card that follows your expenses,
 * those recorded after its balance was entered add to what you owe; earlier ones are taken to be in that
 * balance, unless `addEarlier` marks them to add too. Returns an undo.
 */
export function linkToCard(cardId: string, ids: string[], addEarlier = false): () => void {
  const card = state.accounts.find((a) => a.id === cardId);
  if (!card) return () => {};
  const idSet = new Set(ids);
  const before = state.expenses.filter((e) => idSet.has(e.id));
  const older = new Set(addEarlier ? expensesNotApplying(card, before).map((e) => e.id) : []);
  void importTransactions(before.map((e) => ({ ...e, account: card.name, ...(older.has(e.id) ? { inBalance: false } : {}) })), []);
  return () => { void importTransactions(before, []); };
}

/** What linking would add to a card's balance for expenses recorded before its balance was entered (see linkToCard). */
export function earlierThanBalance(card: Account, list: Expense[]): number {
  return expensesNotApplying(card, list).reduce((t, e) => t + e.amount, 0);
}

// ---------- linking everything to accounts ----------

/** Entries that went through the same thing that isn't one of your accounts ("UPI", "Cash", nothing). */
export interface MoneyGroup {
  /** The method, lowercased: "upi", "credit card", "" for none. */
  key: string;
  label: string;
  expenses: Expense[];
  incomes: Income[];
  ledger: LedgerEntry[];
  /** What keeps adding to it: bills, EMIs and regular incomes paid through it. */
  bills: Bill[];
  loans: Loan[];
  rules: RecurringIncome[];
  out: number;
  in: number;
}

const notAnAccount = (s: Pick<State, "accounts">, name: string | undefined) => !accountNamed(s, name ?? "");

/**
 * Everything that moved money through something other than one of your accounts, grouped by that
 * something, largest first. Splitwise shares and expenses someone else paid aren't money you moved.
 */
export function unlinkedGroups(s: State = state): MoneyGroup[] {
  const groups = new Map<string, MoneyGroup>();
  const group = (name: string | undefined) => {
    const key = nameKey(name ?? "");
    let g = groups.get(key);
    if (!g) groups.set(key, g = { key, label: (name ?? "").trim() || "No account", expenses: [], incomes: [], ledger: [], bills: [], loans: [], rules: [], out: 0, in: 0 });
    return g;
  };
  for (const e of s.expenses) {
    if (e.pending || e.paidBy || nameKey(e.account) === "splitwise" || !notAnAccount(s, e.account)) continue;
    const g = group(e.account); g.expenses.push(e); if (!e.emiLoan) g.out += e.amount;
  }
  for (const x of s.incomes) if (notAnAccount(s, x.account)) { const g = group(x.account); g.incomes.push(x); g.in += x.amount; }
  for (const l of s.ledger) {
    if (l.id.startsWith("sw-") || !notAnAccount(s, l.account)) continue;
    const g = group(l.account); g.ledger.push(l);
    if (l.amount > 0) g.out += l.amount; else g.in -= l.amount;
  }
  // Repeating things only need fixing when they wouldn't land anywhere next time either.
  const lands = (name: string) => !!accountNamed(s, resolveAccount(name, s));
  for (const b of s.bills) if (!b.cancelledAt && !lands(b.account)) group(b.account).bills.push(b);
  for (const l of s.loans) if (!lands(l.account)) group(l.account).loans.push(l);
  for (const r of s.recurringIncomes) if (!lands(r.account)) group(r.account).rules.push(r);
  return [...groups.values()]
    .filter((g) => g.expenses.length + g.incomes.length + g.ledger.length + g.bills.length + g.loans.length + g.rules.length > 0)
    .sort((a, b) => b.out + b.in - (a.out + a.in));
}

const CARD_WORDS = new Set(["credit card", "card", "credit"]);
const BANK_WORDS = new Set(["upi", "bank", "bank account", "", "net banking", "netbanking", "debit card", "imps", "neft", "gpay", "phonepe", "paytm"]);

/** The account a method most likely is: your card for "Credit card", cash for "Cash", your main bank for UPI and the like. */
export function suggestAccount(key: string, s: State = state): string {
  const remembered = s.settings.methodAccounts[key];
  if (remembered && s.accounts.some((a) => a.id === remembered)) return remembered;
  const of = (kind: AccountKind) => s.accounts.filter((a) => a.kind === kind);
  if (CARD_WORDS.has(key)) return of("card").length === 1 ? of("card")[0].id : "";
  if (key === "cash") return of("cash")[0]?.id ?? "";
  if (!BANK_WORDS.has(key)) return "";
  // The bank most of your linked spending already comes out of.
  const banks = of("bank");
  const used = (a: Account) => s.expenses.filter((e) => isAccount(a, e.account)).length;
  return [...banks].sort((a, b) => used(b) - used(a))[0]?.id ?? of("cash")[0]?.id ?? "";
}

export interface LinkChoice { key: string; accountId: string; remember: boolean }

/** The data as it would be after linking (nothing saved): for the preview, and what linkGroups saves. */
function linked(s: State, choices: LinkChoice[], addEarlier: boolean) {
  const groups = new Map(unlinkedGroups(s).map((g) => [g.key, g]));
  const exp = new Map<string, Expense>(), inc = new Map<string, Income>(), led = new Map<string, LedgerEntry>();
  const bills: Bill[] = [], loans: Loan[] = [], rules: RecurringIncome[] = [];
  for (const c of choices) {
    const g = groups.get(c.key), a = s.accounts.find((x) => x.id === c.accountId);
    if (!g || !a) continue;
    // Recorded before the balance was entered: taken to be in it, unless the user says count them too.
    for (const e of g.expenses) {
      const next = { ...e, account: a.name };
      exp.set(e.id, addEarlier && a.tracked && !expenseApplies(a, next) ? { ...next, inBalance: false } : next);
    }
    for (const x of g.incomes) {
      const next = { ...x, account: a.name };
      inc.set(x.id, addEarlier && a.tracked && !incomeApplies(a, next) ? { ...next, inBalance: false } : next);
    }
    for (const l of g.ledger) {
      const next = { ...l, account: a.name };
      led.set(l.id, addEarlier && a.tracked && !ledgerApplies(a, next) ? { ...next, inBalance: false } : next);
    }
    bills.push(...g.bills.map((b) => ({ ...b, account: a.name })));
    loans.push(...g.loans.map((l) => ({ ...l, account: a.name })));
    rules.push(...g.rules.map((r) => ({ ...r, account: a.name })));
  }
  return {
    expenses: s.expenses.map((e) => exp.get(e.id) ?? e), incomes: s.incomes.map((x) => inc.get(x.id) ?? x), ledger: s.ledger.map((l) => led.get(l.id) ?? l),
    changed: { expenses: [...exp.values()], incomes: [...inc.values()], ledger: [...led.values()], bills, loans, rules },
  };
}

/** Each account the choices touch, with its balance now and after linking. */
export function previewLink(choices: LinkChoice[], addEarlier: boolean, s: State = state): { account: Account; before: number; after: number }[] {
  const next = linked(s, choices, addEarlier);
  const ids = [...new Set(choices.filter((c) => c.accountId).map((c) => c.accountId))];
  return ids.map((id) => s.accounts.find((a) => a.id === id)).filter((a): a is Account => !!a)
    .map((a) => ({ account: a, before: liveBalance(a, s), after: liveBalance(a, { ...s, ...next }) }));
}

/** Links the chosen groups to their accounts, remembers the methods asked for, and returns an undo. */
export function linkGroups(choices: LinkChoice[], addEarlier: boolean): () => void {
  const before = { expenses: state.expenses, incomes: state.incomes, ledger: state.ledger, bills: state.bills, loans: state.loans, rules: state.recurringIncomes };
  const methods = state.settings.methodAccounts;
  const { changed } = linked(state, choices, addEarlier);
  const old = {
    expenses: before.expenses.filter((e) => changed.expenses.some((x) => x.id === e.id)),
    incomes: before.incomes.filter((e) => changed.incomes.some((x) => x.id === e.id)),
    ledger: before.ledger.filter((e) => changed.ledger.some((x) => x.id === e.id)),
    bills: before.bills.filter((e) => changed.bills.some((x) => x.id === e.id)),
    loans: before.loans.filter((e) => changed.loans.some((x) => x.id === e.id)),
    rules: before.rules.filter((e) => changed.rules.some((x) => x.id === e.id)),
  };
  const write = (v: typeof changed) => {
    void importTransactions(v.expenses, v.incomes);
    const byId = new Map(v.ledger.map((l) => [l.id, l]));
    if (byId.size) { set({ ledger: sortLedger(state.ledger.map((l) => byId.get(l.id) ?? l)) }); for (const l of v.ledger) void persist("ledger", l); }
    for (const b of v.bills) saveBill(b);
    for (const l of v.loans) saveLoan(l);
    for (const r of v.rules) putRecurringIncome(r);
  };
  write(changed);
  const remember = choices.filter((c) => c.remember && c.accountId && c.key);
  if (remember.length) setSettings({ methodAccounts: { ...methods, ...Object.fromEntries(remember.map((c) => [c.key, c.accountId])) } });
  return () => {
    write(old);
    if (remember.length) setSettings({ methodAccounts: methods });
  };
}

/** Stops sending a payment method to an account automatically. */
export function forgetMethod(key: string) {
  const next = { ...state.settings.methodAccounts };
  delete next[key];
  setSettings({ methodAccounts: next });
}

export interface CardPeriodSpend { start: Date; end: Date; spent: number; paid: number }

export interface CardActivity {
  /** What you owe on it now (negative: money in your favour). */
  owed: number;
  /** Billing periods, oldest first; the last is the one running now. */
  periods: CardPeriodSpend[];
  /** This period's spending by category, largest first. */
  byCategory: { category: Category; amount: number }[];
  /** Everything charged to it, newest first. */
  expenses: Expense[];
  /** Bill payments into it, newest first. */
  payments: Transfer[];
}

/** A card's spending and payments, statement by statement (or month by month without a statement day). */
export function cardActivity(a: Account, s: State = state, now = new Date(), count = 6): CardActivity {
  const expenses = s.expenses.filter((e) => !e.paidBy && isAccount(a, e.account));
  const payments = s.transfers.filter((t) => t.toId === a.id).sort((x, y) => y.occurredAt - x.occurredAt);
  const refunds = s.incomes.filter((x) => isAccount(a, x.account));
  const charged = (e: Expense) => !e.pending && !e.emiLoan;
  const periods = cardPeriods(a.statementDay, count, now).map((p) => {
    const lo = p.start.getTime(), hi = p.end.getTime();
    const inside = (t: number) => t >= lo && t < hi;
    return {
      ...p,
      spent: expenses.filter((e) => charged(e) && inside(e.occurredAt)).reduce((t, e) => t + e.amount, 0),
      paid: payments.filter((t) => inside(t.occurredAt)).reduce((t, x) => t + x.amount, 0)
        + refunds.filter((x) => inside(x.receivedAt)).reduce((t, x) => t + x.amount, 0),
    };
  });
  const cur = periods[periods.length - 1];
  const cats = new Map<Category, number>();
  for (const e of expenses) {
    if (!charged(e) || e.occurredAt < cur.start.getTime() || e.occurredAt >= cur.end.getTime()) continue;
    cats.set(e.category, (cats.get(e.category) ?? 0) + e.amount);
  }
  return {
    owed: liveBalance(a, s), periods, expenses, payments,
    byCategory: [...cats].map(([category, amount]) => ({ category, amount })).sort((x, y) => y.amount - x.amount),
  };
}

export interface AccountItem {
  key: string;
  kind: "income" | "expense" | "transfer" | "ledger";
  title: string;
  detail: string;
  at: number;
  /** + into the account, − out of it. */
  amount: number;
  /** False when it's already in the balance as you entered it (recorded before, or marked so), so it doesn't move it. */
  counted: boolean;
  income?: Income;
  expense?: Expense;
  ledger?: LedgerEntry;
}

/**
 * Everything that went into or out of a bank, cash or investment account, newest first: income,
 * expenses paid from it, transfers, and money lent or paid back through it.
 */
export function accountItems(a: Account, s: State = state): AccountItem[] {
  const follows = !!a.tracked && !(a.currency && a.currency !== s.settings.currency);
  const out: AccountItem[] = [];
  for (const x of s.incomes) if (isAccount(a, x.account)) {
    out.push({ key: `i-${x.id}`, kind: "income", title: x.source || "Income", detail: x.note, at: x.receivedAt, amount: x.amount, counted: follows && incomeApplies(a, x), income: x });
  }
  for (const e of s.expenses) if (!e.pending && !e.paidBy && isAccount(a, e.account)) {
    out.push({ key: `e-${e.id}`, kind: "expense", title: expenseTitle(e), detail: categoryMeta(e.category).title, at: e.occurredAt, amount: -e.amount, counted: follows && !e.emiLoan && expenseApplies(a, e), expense: e });
  }
  const name = (id: string, fallback: string) => s.accounts.find((x) => x.id === id)?.name ?? fallback;
  for (const t of s.transfers) {
    if (t.toId === a.id) out.push({ key: `t-${t.id}`, kind: "transfer", title: `From ${name(t.fromId, t.fromName)}`, detail: t.note, at: t.occurredAt, amount: t.amount, counted: transferApplies(a, t) });
    else if (t.fromId === a.id) out.push({ key: `t-${t.id}`, kind: "transfer", title: `To ${name(t.toId, t.toName)}`, detail: t.note, at: t.occurredAt, amount: -t.amount, counted: transferApplies(a, t) });
  }
  for (const l of s.ledger) if (l.account && isAccount(a, l.account)) {
    const title = l.kind === "lent" ? `Lent to ${l.person}` : l.kind === "borrowed" ? `Borrowed from ${l.person}` : l.amount > 0 ? `Paid back ${l.person}` : `${l.person} paid you back`;
    out.push({ key: `l-${l.id}`, kind: "ledger", title, detail: l.note, at: l.occurredAt, amount: -l.amount, counted: follows && ledgerApplies(a, l), ledger: l });
  }
  return out.sort((x, y) => y.at - x.at);
}

/** Spent by card each calendar month, oldest first, on your cards and on "Credit card". */
export function cardSpendByMonth(s: State = state, months = 6, now = new Date()): { month: Date; spent: number }[] {
  const onCard = (e: Expense) => !e.paidBy && !e.pending && !e.emiLoan
    && (isGenericCard(e.account, s) || s.accounts.some((a) => a.kind === "card" && isAccount(a, e.account)));
  const list = s.expenses.filter(onCard);
  return Array.from({ length: months }, (_, i) => {
    const month = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime();
    return { month, spent: list.filter((e) => e.occurredAt >= month.getTime() && e.occurredAt < end).reduce((t, e) => t + e.amount, 0) };
  });
}

/**
 * A transfer moves both balances through `liveBalance` while it counts. One that no longer counts — made
 * before a balance was entered, or added straight into the balance by an older version of Tally — is in
 * the stored balance, so removing it (or putting it back) has to change that balance directly.
 */
function fixStoredBalances(t: Transfer, removing: boolean) {
  const n = removing ? -t.amount : t.amount;
  for (const [id, dir] of [[t.fromId, -1], [t.toId, 1]] as const) {
    const a = state.accounts.find((x) => x.id === id);
    // An account deleted since has no balance left to fix; a balance you entered after it already has it right.
    if (!a || transferApplies(a, t) || (a.balanceSetAt && a.balanceSetAt >= t.createdAt)) continue;
    saveAccount({ ...a, balance: a.balance + (a.kind === "card" ? -1 : 1) * dir * n });
  }
}

export function addTransfer(input: { fromId: string; toId: string; amount: number; note: string; occurredAt: number; id?: string }): Transfer | null {
  const from = state.accounts.find((a) => a.id === input.fromId);
  const to = state.accounts.find((a) => a.id === input.toId);
  if (!from || !to || from.id === to.id || !(input.amount > 0)) return null;
  if (input.id && state.transfers.some((x) => x.id === input.id)) return null;
  const { id, ...rest } = input;
  const t: Transfer = { id: id ?? uid(), ...rest, fromName: from.name, toName: to.name, createdAt: Date.now() };
  set({ transfers: sortTransfers([t, ...state.transfers]) });
  void persist("transfers", t);
  return t;
}

/** Removes a transfer and puts both balances back. */
export function deleteTransfer(id: string, withUndo = true) {
  const t = state.transfers.find((x) => x.id === id);
  if (!t) return;
  fixStoredBalances(t, true);
  set({ transfers: state.transfers.filter((x) => x.id !== id) });
  void remove("transfers", id);
  if (withUndo) {
    showToast(`Removed transfer · ${formatMoney(t.amount)}`, () => {
      fixStoredBalances(t, false);
      set({ transfers: sortTransfers([t, ...state.transfers]) });
      void persist("transfers", t);
    });
  }
}

// ---------- repeating transfers ----------

export function saveScheduledTransfer(t: ScheduledTransfer) {
  setSettings({ scheduledTransfers: [...state.settings.scheduledTransfers.filter((x) => x.id !== t.id), t] });
}
export function deleteScheduledTransfer(id: string) {
  setSettings({ scheduledTransfers: state.settings.scheduledTransfers.filter((x) => x.id !== id) });
}

/** Makes this month's repeating transfers whose day has come. The transfer ID is fixed per rule and month. */
export function runDueTransfers(now = new Date()) {
  const key = monthKey(now);
  for (const rule of state.settings.scheduledTransfers) {
    if (rule.lastLoggedMonth === key || rule.day > now.getDate()) continue;
    const due = new Date(now.getFullYear(), now.getMonth(), rule.day, 9);
    addTransfer({ id: `st-${rule.id}-${key}`, fromId: rule.fromId, toId: rule.toId, amount: rule.amount, note: rule.note || "Repeating transfer",
      occurredAt: due.getTime() <= now.getTime() ? due.getTime() : now.getTime() });
    saveScheduledTransfer({ ...rule, lastLoggedMonth: key });
  }
}

// ---------- budgets for a week, month or year ----------

/** What a category budget's period has spent so far (your share, counted expenses only). */
export function budgetSpent(b: CategoryBudget, s: State = state, now = new Date()): number {
  const [start, end] = periodBounds(b.period ?? "month", now);
  return s.expenses.filter((e) => counts(e) && e.category === b.category && e.occurredAt >= start.getTime() && e.occurredAt < end.getTime())
    .reduce((t, e) => t + share(e), 0);
}

// ---------- people: money lent, borrowed and paid back ----------

const sortLedger = (list: LedgerEntry[]) => [...list].sort((a, b) => b.occurredAt - a.occurredAt);

export function saveLedgerEntry(input: LedgerEntry) {
  const entry = input.account ? { ...input, account: resolveAccount(input.account) } : input;
  const isNew = !state.ledger.some((x) => x.id === entry.id);
  set({ ledger: sortLedger([entry, ...state.ledger.filter((x) => x.id !== entry.id)]) });
  void persist("ledger", entry);
  if (isNew) track("ledger_added", { kind: entry.kind });
}

// ---------- groups ----------

export function saveGroup(group: SplitGroup) {
  setSettings({ groups: [...state.settings.groups.filter((g) => g.id !== group.id), group].sort((a, b) => a.createdAt - b.createdAt) });
}

/** Removes the group. Its bills and payments stay, as ordinary splits with each person in People. */
export function deleteGroup(id: string) {
  setSettings({ groups: state.settings.groups.filter((g) => g.id !== id) });
}

export function deleteLedgerEntry(id: string, withUndo = true) {
  const victim = state.ledger.find((x) => x.id === id);
  if (!victim) return;
  set({ ledger: state.ledger.filter((x) => x.id !== id) });
  void remove("ledger", id);
  if (withUndo) showToast(`Removed · ${formatMoney(Math.abs(victim.amount))}`, () => saveLedgerEntry(victim));
}

/**
 * Adds a Splitwise export to Tally: your share of each expense to spending, and what each person
 * owes you (or you owe them) to People. IDs are fixed per row, so importing next month's export
 * only adds what's new.
 */
export async function importSplitwise(rows: PlannedRow[], opts: { group: string; addSpending: boolean }): Promise<{ expenseIds: string[]; ledgerIds: string[] }> {
  const note = opts.group.trim() ? `Splitwise · ${opts.group.trim()}` : "Splitwise";
  const now = Date.now();
  const haveE = new Set(state.expenses.map((e) => e.id)), haveL = new Set(state.ledger.map((l) => l.id));
  const expenses: Expense[] = [];
  const ledger: LedgerEntry[] = [];
  for (const r of rows) {
    const at = r.date.getTime();
    if (opts.addSpending && r.share > 0 && !haveE.has(r.key)) {
      haveE.add(r.key);
      expenses.push({ id: r.key, amount: r.share, merchant: r.description, note, category: toCategory(r.category), account: "Splitwise",
        occurredAt: at, createdAt: now, source: "import", pending: false, splitWays: 1, splitWith: "", exclude: false, recurring: false,
        tags: ["splitwise"], ...(r.fx ? { fx: { currency: r.fx.currency, amount: Math.round(r.share / r.fx.rate), rate: r.fx.rate } } : {}) });
    }
    for (const x of r.entries) {
      if (haveL.has(x.id)) continue;
      haveL.add(x.id);
      ledger.push({ id: x.id, person: x.person, amount: x.amount, kind: x.kind, note: r.description, occurredAt: at, createdAt: now });
    }
  }
  if (expenses.length) await importTransactions(expenses, []);
  if (ledger.length) {
    set({ ledger: sortLedger([...ledger, ...state.ledger]) });
    try { await db.putMany("ledger", ledger); } catch { showToast("Couldn't save to this browser's storage"); }
    for (const l of ledger) changeListener?.("ledger", l.id, l);
  }
  track("import_done", { kind: "splitwise", expenses: expenses.length, entries: ledger.length });
  return { expenseIds: expenses.map((e) => e.id), ledgerIds: ledger.map((l) => l.id) };
}

/** Undoes a Splitwise import. */
export function removeSplitwise(expenseIds: string[], ledgerIds: string[]) {
  removeImported(expenseIds, []);
  const l = new Set(ledgerIds);
  set({ ledger: state.ledger.filter((x) => !l.has(x.id)) });
  for (const id of ledgerIds) void remove("ledger", id);
}

// ---------- loans ----------

export function saveLoan(loan: Loan) {
  const isNew = !state.loans.some((x) => x.id === loan.id);
  set({ loans: [...state.loans.filter((x) => x.id !== loan.id), loan].sort((a, b) => a.createdAt - b.createdAt) });
  void persist("loans", loan);
  if (isNew) track("loan_added");
}

export function deleteLoan(id: string) {
  const loan = state.loans.find((x) => x.id === id);
  set({ loans: state.loans.filter((x) => x.id !== id) });
  void remove("loans", id);
  // Undoing a card EMI puts the purchase back on the card and in the budget.
  const e = loan?.fromExpense ? state.expenses.find((x) => x.id === loan.fromExpense && x.emiLoan === id) : undefined;
  if (e) {
    updateExpense(e.id, { emiLoan: undefined, exclude: false });
    const card = state.accounts.find((a) => a.kind === "card" && isAccount(a, e.account));
    if (card?.tracked && !expenseApplies(card, e)) saveAccount({ ...card, balance: card.balance + e.amount, updatedAt: card.updatedAt });
  }
}

export const loanEmi = (l: Pick<Loan, "principal" | "ratePct" | "months" | "emi">) => l.emi || emiFor(l.principal, l.ratePct, l.months);

/** The EMI that falls due this month, if the loan has one. */
export function emiThisMonth(loan: Loan, now = new Date()): Date | null {
  for (let k = 0; k < loan.months; k++) {
    const d = dueDate(loan.firstDueAt, k);
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return d;
    if (d > now && d.getMonth() !== now.getMonth()) break;
  }
  return null;
}

/** Adds this month's EMI to expenses, once: the expense ID is fixed per loan and month. */
export function logEmi(loan: Loan, now = new Date()): Expense | null {
  const due = emiThisMonth(loan, now);
  if (!due) return null;
  const key = monthKey(now);
  const e = addExpense({
    id: `emi-${loan.id}-${key}`, amount: loan.emi, category: loan.category, merchant: `${loan.name} EMI`, account: loan.account,
    occurredAt: due.getTime() <= now.getTime() ? due.getTime() : now.getTime(), source: "recurring",
  });
  saveLoan({ ...state.loans.find((l) => l.id === loan.id) ?? loan, lastLoggedMonth: key });
  return e;
}

/** Loans set to add their EMI whose day has come this month and that aren't added yet. */
export function runDueLoans(now = new Date()) {
  const key = monthKey(now);
  for (const loan of state.loans) {
    if (!loan.autoLog || loan.lastLoggedMonth === key) continue;
    const due = emiThisMonth(loan, now);
    if (due && due.getTime() <= now.getTime()) logEmi(loan, now);
  }
}

export const loanSummary = (loan: Loan, now = Date.now()) => loanStatus(loan, now);

// ---------- categories ----------

/** Saves one category's settings: a new one, a renamed built-in, a hidden one. */
export function saveCategory(def: CategoryDef) {
  const rest = state.settings.categories.filter((c) => c.id !== def.id);
  setSettings({ categories: [...rest, def] });
}

/** Deletes one of the user's own categories; its expenses, repeats and bills move to Other. */
export async function deleteCategory(id: Category) {
  const moved = state.expenses.filter((e) => e.category === id).map((e) => ({ ...e, category: "other" }));
  const chips = state.chips.filter((c) => c.category === id).map((c) => ({ ...c, category: "other" }));
  const bills = state.bills.filter((b) => b.category === id).map((b) => ({ ...b, category: "other" }));
  const swap = <T extends { id: string }>(list: T[], changed: T[]) => list.map((x) => changed.find((c) => c.id === x.id) ?? x);
  setSettings({ categories: state.settings.categories.filter((c) => c.id !== id) });
  set({ expenses: swap(state.expenses, moved), chips: swap(state.chips, chips), bills: swap(state.bills, bills) });
  if (state.budgets.some((b) => b.category === id)) deleteBudget(id);
  try {
    await db.putMany("expenses", moved);
  } catch {
    showToast("Couldn't save to this browser's storage");
    return;
  }
  for (const e of moved) changeListener?.("expenses", e.id, e);
  for (const c of chips) void persist("chips", c);
  for (const b of bills) void persist("bills", b);
}

export function saveGoal(g: Goal) {
  const exists = state.goals.some((x) => x.id === g.id);
  set({ goals: exists ? state.goals.map((x) => (x.id === g.id ? g : x)) : [...state.goals, g] });
  void persist("goals", g);
}
export function deleteGoal(id: string) {
  set({ goals: state.goals.filter((g) => g.id !== id) });
  void remove("goals", id);
}

// ---------- rules, subscriptions, import layouts ----------

export function saveRule(rule: Rule) {
  const rest = state.settings.rules.filter((r) => r.id !== rule.id && r.match !== rule.match);
  setSettings({ rules: [rule, ...rest] });
}
export function deleteRule(id: string) {
  setSettings({ rules: state.settings.rules.filter((r) => r.id !== id) });
}

/** Hides a repeating charge from the suggestions, or (undo) shows it again. */
export function dismissRecurring(key: string, undo = false) {
  const rest = state.settings.dismissedRecurring.filter((k) => k !== key);
  setSettings({ dismissedRecurring: undo ? rest : [...rest, key].slice(-200) });
}

/** Remembers a statement layout, most recent first. */
export function saveImportLayout(layout: ImportLayout) {
  const rest = state.settings.importLayouts.filter((l) => l.signature !== layout.signature);
  setSettings({ importLayouts: [layout, ...rest].slice(0, 12) });
}

// ---------- income ----------

const sortIncomes = (list: Income[]) => [...list].sort((a, b) => b.receivedAt - a.receivedAt);

export function saveIncome(input: Income) {
  const income = { ...input, account: resolveAccount(input.account) };
  const rest = state.incomes.filter((x) => x.id !== income.id);
  set({ incomes: sortIncomes([income, ...rest]) });
  void persist("incomes", income);
}

export function deleteIncome(id: string, withUndo = true) {
  const victim = state.incomes.find((x) => x.id === id);
  if (!victim) return;
  set({ incomes: state.incomes.filter((x) => x.id !== id) });
  void remove("incomes", id);
  if (withUndo) showToast(`Deleted ${victim.source || "income"} · ${formatMoney(victim.amount)}`, () => saveIncome(victim));
}

/** Adds many expenses and income entries in one go (a bank statement import). */
export async function importTransactions(expenses: Expense[], incomes: Income[]): Promise<void> {
  const eIds = new Set(expenses.map((e) => e.id)), iIds = new Set(incomes.map((x) => x.id));
  set({
    expenses: sortExpenses([...expenses, ...state.expenses.filter((e) => !eIds.has(e.id))]),
    incomes: sortIncomes([...incomes, ...state.incomes.filter((x) => !iIds.has(x.id))]),
  });
  try {
    await db.putMany("expenses", expenses);
    await db.putMany("incomes", incomes);
  } catch {
    showToast("Couldn't save to this browser's storage");
    return;
  }
  for (const e of expenses) changeListener?.("expenses", e.id, e);
  for (const x of incomes) changeListener?.("incomes", x.id, x);
}

/** Undoes an import. */
export function removeImported(expenseIds: string[], incomeIds: string[]) {
  const e = new Set(expenseIds), i = new Set(incomeIds);
  set({ expenses: state.expenses.filter((x) => !e.has(x.id)), incomes: state.incomes.filter((x) => !i.has(x.id)) });
  for (const id of expenseIds) void remove("expenses", id);
  for (const id of incomeIds) void remove("incomes", id);
}

export function saveRecurringIncome(input: RecurringIncome) {
  putRecurringIncome({ ...input, account: resolveAccount(input.account) });
}

/** Saves a regular income exactly as given (an undo puts back what was there). */
function putRecurringIncome(rule: RecurringIncome) {
  const rest = state.recurringIncomes.filter((x) => x.id !== rule.id);
  set({ recurringIncomes: [...rest, rule].sort((a, b) => a.day - b.day) });
  void persist("recurringIncomes", rule);
}

export function deleteRecurringIncome(id: string) {
  set({ recurringIncomes: state.recurringIncomes.filter((x) => x.id !== id) });
  void remove("recurringIncomes", id);
}

/**
 * Adds a regular income's payment for the month, once: the income's ID is fixed per rule and month,
 * and an existing entry (perhaps edited, or added on another device) is left as it is.
 */
export function logRecurringIncome(rule: RecurringIncome, now = new Date(), opts: { inBalance?: boolean } = {}) {
  const key = monthKey(now);
  const id = `income-${rule.id}-${key}`;
  if (!state.incomes.some((x) => x.id === id)) {
    const due = new Date(now.getFullYear(), now.getMonth(), rule.day, 12);
    saveIncome({
      id, amount: rule.amount, source: rule.source, note: rule.note, account: rule.account,
      // Received early: dated today rather than in the future.
      receivedAt: due.getTime() <= now.getTime() ? due.getTime() : now.getTime(), createdAt: Date.now(),
      ...(opts.inBalance ? { inBalance: true } : {}),
    });
  }
  saveRecurringIncome({ ...state.recurringIncomes.find((r) => r.id === rule.id) ?? rule, lastLoggedMonth: key });
}

/** Regular income set to add itself whose day has come this month and that isn't added yet. */
export function runDueIncome(now = new Date()) {
  const key = monthKey(now);
  for (const rule of state.recurringIncomes) {
    if (rule.autoLog && rule.lastLoggedMonth !== key && rule.day <= now.getDate()) logRecurringIncome(rule, now);
  }
}

// ---------- recurring ----------

export const nextDue = (bill: Bill, from = new Date()): Date => nextDueDate(bill, from);

/** True when this period's payment (this week, month or year) is already in expenses. */
export const billPaid = (bill: Bill, now = new Date()) => bill.lastLoggedMonth === periodKey(bill, now);
/** True when this period's due date has come and its payment isn't in expenses yet. */
export const billOverdue = (bill: Bill, now = new Date()) => !billPaid(bill, now) && dueInPeriod(bill, now).getTime() <= now.getTime();

export function makeRecurring(e: Expense) {
  updateExpense(e.id, { recurring: true });
  const name = expenseTitle(e);
  if (state.bills.some((b) => b.name === name)) return;
  const day = Math.min(new Date(e.occurredAt).getDate(), 28);
  saveBill({
    id: uid(), name, amount: e.amount, prevAmount: e.amount, day, category: e.category, account: e.account,
    isSubscription: e.category === "fun" || e.category === "bills", autoLog: false,
    lastLoggedMonth: monthKey(new Date(e.occurredAt)),
  });
}

/**
 * Cancels a bill or subscription from `at`: nothing more is due, reminded or added to expenses.
 * Its past payments stay in spending.
 */
export function cancelBill(bill: Bill, at = Date.now()) {
  saveBill({ ...bill, cancelledAt: at });
}

/**
 * Starts a cancelled bill again from its next due date. A due date that passed while it was
 * cancelled isn't owed, so this period counts as handled.
 */
export function restartBill(bill: Bill, now = new Date()) {
  const { cancelledAt: _c, ...rest } = bill;
  saveBill({ ...rest, lastLoggedMonth: billOverdue(rest, now) ? periodKey(rest, now) : rest.lastLoggedMonth });
}

/** What cancelling has saved so far: each due date since the cancellation, at the bill's amount. */
export function cancelledSavings(bill: Bill, now = new Date()): { payments: number; saved: number } {
  if (!bill.cancelledAt) return { payments: 0, saved: 0 };
  let payments = 0;
  for (let d = nextDueDate(bill, new Date(bill.cancelledAt + 86_400_000)); d.getTime() <= now.getTime() && payments < 520;
    d = nextDueDate(bill, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))) payments++;
  return { payments, saved: payments * bill.amount };
}

/**
 * Charges from a cancelled subscription's merchant after it was cancelled (a day's grace): the
 * cancellation may not have gone through.
 */
export function chargedAfterCancel(bill: Bill, s: Pick<State, "expenses"> = state): Expense[] {
  if (!bill.cancelledAt) return [];
  const key = merchantKey(bill.name);
  // Tally's own logged payments for the bill aren't charges from the merchant.
  return s.expenses.filter((e) => !e.pending && !e.id.startsWith(`bill-${bill.id}-`) && e.occurredAt > bill.cancelledAt! + 86_400_000
    && merchantKey(expenseTitle(e)) === key);
}

/** Logs a bill's payment for the period as an expense, once: the expense ID is fixed per bill and period. */
export function logBill(bill: Bill, now = new Date(), opts: { inBalance?: boolean } = {}): Expense {
  const key = periodKey(bill, now);
  const due = dueInPeriod(bill, now);
  const e = addExpense({
    id: `bill-${bill.id}-${key}`,
    amount: bill.amount, category: bill.category, merchant: bill.name, account: bill.account,
    // Paid early: dated today rather than in the future.
    occurredAt: due.getTime() <= now.getTime() ? due.getTime() : now.getTime(), source: "recurring", inBalance: opts.inBalance,
  });
  saveBill({ ...state.bills.find((b) => b.id === bill.id) ?? bill, lastLoggedMonth: key });
  return e;
}

/** Bills set to log automatically whose due date has come this period and that aren't logged yet. */
export function runDueBills(now = new Date()) {
  for (const bill of state.bills) {
    if (bill.autoLog && !bill.cancelledAt && billOverdue(bill, now)) logBill(bill, now);
  }
}

// ---------- URL actions (for iOS Shortcuts, Action Button, bookmarks) ----------

/**
 *  ?log=180&cat=food&note=Coffee         → logs immediately
 *  ?capture=640&merchant=Chutneys         → adds to Inbox as pending (Apple Pay automation)
 *  ?add  /  ?smart                        → opens Quick Add / Smart add
 */
export function handleUrlActions(search: string, open: (sheet: "quickAdd" | "smartAdd") => void) {
  const params = new URLSearchParams(search);
  if (![...params.keys()].length) return;
  const num = (v: string | null) => {
    const n = v ? parseFloat(v.replace(/[^\d.]/g, "")) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
  };
  const log = num(params.get("log"));
  const capture = num(params.get("capture"));
  if (log) {
    const note = params.get("note") ?? "";
    const cat = toCategory(params.get("cat"), guessCategory(note));
    addExpense({ amount: log, category: cat, note, account: params.get("account"), source: "shortcut" });
    showToast(`Logged ${note || "expense"} · ${formatMoney(log)}`);
  } else if (capture) {
    const raw = params.get("merchant") ?? "";
    const merchant = matchRule(raw)?.rename || raw;
    addExpense({ amount: capture, category: guessCategory(raw), merchant, account: params.get("card") || "Card",
      source: "capture", pending: true });
    showToast(`Captured ${merchant || "payment"} · ${formatMoney(capture)} · check Inbox`);
  } else if (params.has("add")) {
    open("quickAdd");
  } else if (params.has("smart")) {
    open("smartAdd");
  }
}

// ---------- backup ----------

export function exportJSON(): string {
  const { expenses, chips, budgets, bills, accounts, goals, incomes, recurringIncomes, transfers, ledger, loans, settings } = state;
  return JSON.stringify({ app: "tally", version: 1, exportedAt: new Date().toISOString(),
    expenses, chips, budgets, bills, accounts, goals, incomes, recurringIncomes, transfers, ledger, loans,
    settings: { ...settings, lockCredentialId: null } }, null, 2);
}

const DATA_STORES: StoreName[] = ["expenses", "chips", "budgets", "bills", "accounts", "goals", "incomes", "recurringIncomes", "transfers", "ledger", "loans"];
const RESTORE_POINT = "restorePoint";
interface RestorePoint { savedAt: number; json: string }

/**
 * Replaces this device's data with a checked backup (see parseBackup) in a single transaction.
 * The data it replaces is kept as a restore point, so the restore can be undone.
 */
export async function restoreBackup(backup: Backup): Promise<void> {
  const before = allRecords();
  const point: RestorePoint = { savedAt: Date.now(), json: exportJSON() };
  // Keep the lock and backup date from this device; everything else comes from the file.
  const settings: Settings = {
    ...state.settings, ...backup.settings,
    lockCredentialId: state.settings.lockCredentialId, lastBackupAt: state.settings.lastBackupAt,
  };
  await db.replaceAll(DATA_STORES, {
    expenses: backup.expenses, chips: backup.chips, budgets: backup.budgets, bills: backup.bills,
    accounts: backup.accounts, goals: backup.goals, incomes: backup.incomes, recurringIncomes: backup.recurringIncomes,
    transfers: backup.transfers, ledger: backup.ledger, loans: backup.loans,
    kv: [{ key: "settings", value: settings }, { key: RESTORE_POINT, value: point }],
  });
  await load();
  reportReplaced(before);
}

/**
 * Puts back the data that the last restore replaced. It's a swap: the data on the device now
 * becomes the new restore point, so nothing logged since the restore is lost for good.
 */
export async function undoRestore(): Promise<void> {
  const before = allRecords();
  const kv = await db.all<{ key: string; value: unknown }>("kv");
  const point = kv.find((r) => r.key === RESTORE_POINT)?.value as RestorePoint | undefined;
  if (!point) throw new Error("There's no earlier data to put back.");
  const backup = parseBackup(point.json);
  const current: RestorePoint = { savedAt: Date.now(), json: exportJSON() };
  await db.replaceAll(DATA_STORES, {
    expenses: backup.expenses, chips: backup.chips, budgets: backup.budgets, bills: backup.bills,
    accounts: backup.accounts, goals: backup.goals, incomes: backup.incomes, recurringIncomes: backup.recurringIncomes,
    transfers: backup.transfers, ledger: backup.ledger, loans: backup.loans,
    kv: [{ key: "settings", value: { ...state.settings, ...backup.settings } }, { key: RESTORE_POINT, value: current }],
  });
  await load();
  reportReplaced(before);
}

/** Everything as an Excel workbook: one sheet each for expenses, income, transfers, accounts, loans and people. */
export async function exportXLSX(): Promise<Blob> {
  const XLSX = await import("xlsx");
  const { expenses, incomes, transfers, accounts, loans, ledger, settings } = state;
  const cur = settings.currency;
  const day = (t: number) => new Date(t).toLocaleDateString("en-CA");
  const money = (p: number) => Math.round(p) / 100;
  const book = XLSX.utils.book_new();
  const sheet = (name: string, rows: Record<string, unknown>[]) =>
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows.length ? rows : [{ "": "Nothing here yet" }]), name);
  sheet("Expenses", expenses.map((e) => ({
    Date: day(e.occurredAt), [`Amount (${cur})`]: money(e.amount), [`Your share (${cur})`]: money(share(e)),
    Category: categoryMeta(e.category).title, Subcategory: e.sub ?? "", Tags: (e.tags ?? []).map((t) => `#${t}`).join(" "),
    Merchant: e.merchant, Note: e.note, "Paid from": e.account, "Split with": e.splitWith, "Paid by": e.paidBy ?? "",
    "Foreign amount": e.fx ? `${money(e.fx.amount)} ${e.fx.currency}` : "", Status: e.pending ? "pending" : e.exclude ? "not in budget" : "",
  })));
  sheet("Income", incomes.map((x) => ({ Date: day(x.receivedAt), [`Amount (${cur})`]: money(x.amount), Source: x.source, Account: x.account, Note: x.note })));
  sheet("Transfers", transfers.map((t) => ({ Date: day(t.occurredAt), From: t.fromName, To: t.toName, [`Amount (${cur})`]: money(t.amount), Note: t.note })));
  sheet("Accounts", accounts.map((a) => ({
    Name: a.name, Type: ACCOUNT_KIND_LABEL[a.kind], Balance: money(liveBalance(a)), Currency: a.currency ?? cur,
    "Credit limit": a.limit ? money(a.limit) : "", Available: a.limit ? money(a.limit - liveBalance(a)) : "",
    Invested: netInvested(a) !== null ? money(netInvested(a)!) : "",
  })));
  sheet("Loans", loans.map((l) => ({ Name: l.name, Lender: l.lender, Borrowed: money(l.principal), "Rate %": l.ratePct, Months: l.months, EMI: money(l.emi),
    "First EMI": day(l.firstDueAt), "Paid from": l.account, Outstanding: money(loanStatus(l, Date.now()).outstanding) })));
  sheet("People", ledger.map((x) => ({ Date: day(x.occurredAt), Person: x.person, Kind: x.kind, [`They owe you (${cur})`]: money(x.amount), Note: x.note, Account: x.account ?? "" })));
  const data = XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function exportCSV(): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const cur = state.settings.currency.toLowerCase();
  const rows = [`date,amount_${cur},your_share_${cur},category,merchant,note,account,status,split_ways,source`];
  for (const e of state.expenses) {
    rows.push([
      new Date(e.occurredAt).toISOString(), (e.amount / 100).toFixed(2), (share(e) / 100).toFixed(2), e.category,
      e.merchant, e.note, e.account, e.pending ? "pending" : "confirmed", String(e.splitWays), e.source,
    ].map(esc).join(","));
  }
  return rows.join("\n");
}

export async function eraseAll() {
  const before = allRecords();
  await db.replaceAll(DATA_STORES, {});
  await db.delete("kv", RESTORE_POINT);
  set({ expenses: [], chips: [], budgets: [], bills: [], accounts: [], goals: [], incomes: [], recurringIncomes: [], transfers: [], ledger: [], loans: [], restorePointAt: null });
  await seedChips();
  reportReplaced(before);
}

// ---------- backup reminder ----------

const BACKUP_EVERY_DAYS = 30;

/** Days since the last backup, once there's enough data to be worth losing and a backup is overdue. */
export function backupOverdueDays(s: State, now = Date.now()): number | null {
  const confirmed = s.expenses.filter((e) => !e.pending);
  if (confirmed.length < 20) return null;
  const since = s.settings.lastBackupAt ?? Math.min(...confirmed.map((e) => e.createdAt));
  const days = Math.floor((now - since) / 86_400_000);
  return days >= BACKUP_EVERY_DAYS ? days : null;
}
