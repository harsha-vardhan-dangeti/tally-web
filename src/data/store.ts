import { useSyncExternalStore } from "react";
import { db, type StoreName } from "./db";
import { categoryMeta, guessCategory, isCategory, setCategoryDefs, toCategory, type Category, type CategoryDef } from "../core/categories";
import { matchRule, sanitizeRules, setRules, type Rule } from "../core/rules";
import { detectRecurring, merchantKey, type RecurringCharge } from "../core/recurring";
import type { ColumnMap } from "../core/statement";
import { crossedThreshold, monthKey, monthRange, sameDay, snapshot, type BudgetSnapshot } from "../core/budget";
import { formatMoney } from "../core/money";
import { yourShare } from "../core/smartParser";
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
}
export interface Chip { id: string; title: string; amount: number; category: Category; order: number }
export interface CategoryBudget { category: Category; limit: number }
export interface Bill {
  id: string; name: string; amount: number; prevAmount: number; day: number; category: Category;
  account: string; isSubscription: boolean; autoLog: boolean; lastLoggedMonth: string;
}
export type AccountKind = "bank" | "card" | "cash" | "investment";
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = { bank: "Bank", card: "Credit card", cash: "Cash", investment: "Investment" };
export interface Account {
  id: string; name: string; kind: AccountKind; balance: number; order: number; updatedAt: number;
  /** Balance at the last update in each month ("2026-10" → paise), for net worth over time. */
  history?: Record<string, number>;
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
}
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
  settings: Settings;
  /** When the last restore replaced this device's data; that data can be put back until the next restore. */
  restorePointAt: number | null;
}

const DEFAULT_SETTINGS: Settings = {
  onboarded: false, monthlyBudget: 0, monthlyIncome: 0, defaultAccount: "UPI", lockCredentialId: null, lastBackupAt: null, categories: [], rules: [], dismissedRecurring: [], importLayouts: [],
};

let state: State = {
  ready: false, expenses: [], chips: [], budgets: [], bills: [], accounts: [], goals: [], incomes: [], recurringIncomes: [], transfers: [],
  settings: DEFAULT_SETTINGS, restorePointAt: null,
};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function set(patch: Partial<State>) {
  if (patch.settings && patch.settings !== state.settings) {
    setCategoryDefs(patch.settings.categories);
    setRules(patch.settings.rules);
  }
  state = { ...state, ...patch };
  emit();
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
  const [expenses, chips, budgets, bills, accounts, goals, incomes, recurringIncomes, transfers, kv] = await Promise.all([
    db.all<Expense>("expenses"), db.all<Chip>("chips"), db.all<CategoryBudget>("budgets"), db.all<Bill>("bills"),
    db.all<Account>("accounts"), db.all<Goal>("goals"), db.all<Income>("incomes"),
    db.all<RecurringIncome>("recurringIncomes"), db.all<Transfer>("transfers"), db.all<{ key: string; value: unknown }>("kv"),
  ]);
  const settingsRow = kv.find((r) => r.key === "settings");
  const settings = readSettings(settingsRow?.value);
  const restorePoint = kv.find((r) => r.key === RESTORE_POINT)?.value as RestorePoint | undefined;
  // Rows can arrive from links and other devices, so an unknown category never reaches the screens.
  setCategoryDefs(settings.categories);
  setRules(settings.rules);
  const fix = <T extends { category: Category }>(x: T): T => ({ ...x, category: toCategory(x.category) });
  set({
    ready: true,
    expenses: sortExpenses(expenses.map(fix)),
    chips: chips.map(fix).sort((a, b) => a.order - b.order),
    budgets: budgets.filter((b) => isCategory(b.category)), bills: bills.map(fix),
    accounts: [...accounts].sort((a, b) => a.order - b.order), goals, incomes: sortIncomes(incomes), recurringIncomes,
    transfers: sortTransfers(transfers), settings,
    restorePointAt: restorePoint?.savedAt ?? null,
  });
  if (chips.length === 0) await seedChips();
  runDueBills();
  runDueIncome();
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
  };
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
export const share = (e: Expense) => yourShare(e.amount, e.splitWays);
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
  const { expenses, incomes, recurringIncomes, chips, budgets, bills, accounts, goals, transfers, settings } = state;
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
  occurredAt?: number; source: Source; pending?: boolean; splitWays?: number; splitWith?: string;
  /** For callers that may log the same expense twice, e.g. a bill auto-logged on two devices. */
  id?: string;
}

/** The single write path for every way of logging. */
export function addExpense(input: NewExpense): Expense {
  const existing = input.id ? state.expenses.find((x) => x.id === input.id) : undefined;
  if (existing) return existing;
  const before = monthSpent(state.expenses, new Date());
  const e: Expense = {
    id: input.id ?? uid(), amount: input.amount, merchant: input.merchant ?? "", note: input.note ?? "",
    category: toCategory(input.category), account: input.account || state.settings.defaultAccount,
    occurredAt: input.occurredAt ?? Date.now(), createdAt: Date.now(), source: input.source,
    pending: input.pending ?? false, splitWays: Math.max(input.splitWays ?? 1, 1), splitWith: input.splitWith ?? "",
    exclude: false, recurring: false,
  };
  set({ expenses: sortExpenses([e, ...state.expenses]) });
  void persist("expenses", e);
  checkThreshold(before);
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
  const list = state.expenses.map((e) => (e.id === id ? { ...e, ...patch } : e));
  set({ expenses: sortExpenses(list) });
  const updated = list.find((e) => e.id === id);
  if (updated) void persist("expenses", updated);
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
export const moneyIn = (a: Account, amount: number): Account =>
  ({ ...a, balance: a.balance + (a.kind === "card" ? -amount : amount), updatedAt: Date.now() });

function applyTransfer(t: Transfer, undo: boolean) {
  const n = undo ? -t.amount : t.amount;
  // An account deleted since the transfer has no balance left to fix.
  const from = state.accounts.find((a) => a.id === t.fromId);
  if (from) saveAccount(moneyIn(from, -n));
  const to = state.accounts.find((a) => a.id === t.toId);
  if (to) saveAccount(moneyIn(to, n));
}

export function addTransfer(input: { fromId: string; toId: string; amount: number; note: string; occurredAt: number }): Transfer | null {
  const from = state.accounts.find((a) => a.id === input.fromId);
  const to = state.accounts.find((a) => a.id === input.toId);
  if (!from || !to || from.id === to.id || !(input.amount > 0)) return null;
  const t: Transfer = { id: uid(), ...input, fromName: from.name, toName: to.name, createdAt: Date.now() };
  applyTransfer(t, false);
  set({ transfers: sortTransfers([t, ...state.transfers]) });
  void persist("transfers", t);
  return t;
}

/** Removes a transfer and puts both balances back. */
export function deleteTransfer(id: string, withUndo = true) {
  const t = state.transfers.find((x) => x.id === id);
  if (!t) return;
  applyTransfer(t, true);
  set({ transfers: state.transfers.filter((x) => x.id !== id) });
  void remove("transfers", id);
  if (withUndo) {
    showToast(`Removed transfer · ${formatMoney(t.amount)}`, () => {
      applyTransfer(t, false);
      set({ transfers: sortTransfers([t, ...state.transfers]) });
      void persist("transfers", t);
    });
  }
}

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

export function saveIncome(income: Income) {
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

export function saveRecurringIncome(rule: RecurringIncome) {
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
export function logRecurringIncome(rule: RecurringIncome, now = new Date()) {
  const key = monthKey(now);
  const id = `income-${rule.id}-${key}`;
  if (!state.incomes.some((x) => x.id === id)) {
    const due = new Date(now.getFullYear(), now.getMonth(), rule.day, 12);
    saveIncome({
      id, amount: rule.amount, source: rule.source, note: rule.note, account: rule.account,
      // Received early: dated today rather than in the future.
      receivedAt: due.getTime() <= now.getTime() ? due.getTime() : now.getTime(), createdAt: Date.now(),
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

export function nextDue(bill: Bill, from = new Date()): Date {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const thisMonth = new Date(from.getFullYear(), from.getMonth(), bill.day);
  return thisMonth >= today ? thisMonth : new Date(from.getFullYear(), from.getMonth() + 1, bill.day);
}

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

/** Logs a bill's payment for the month as an expense, once: the expense ID is fixed per bill and month. */
export function logBill(bill: Bill, now = new Date()): Expense {
  const key = monthKey(now);
  const due = new Date(now.getFullYear(), now.getMonth(), bill.day, 9);
  const e = addExpense({
    id: `bill-${bill.id}-${key}`,
    amount: bill.amount, category: bill.category, merchant: bill.name, account: bill.account,
    // Paid early: dated today rather than in the future.
    occurredAt: due.getTime() <= now.getTime() ? due.getTime() : now.getTime(), source: "recurring",
  });
  saveBill({ ...state.bills.find((b) => b.id === bill.id) ?? bill, lastLoggedMonth: key });
  return e;
}

/** Bills set to log automatically whose due day has come this month and that aren't logged yet. */
export function runDueBills(now = new Date()) {
  const key = monthKey(now);
  for (const bill of state.bills) {
    if (bill.autoLog && bill.lastLoggedMonth !== key && bill.day <= now.getDate()) logBill(bill, now);
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
  const { expenses, chips, budgets, bills, accounts, goals, incomes, recurringIncomes, transfers, settings } = state;
  return JSON.stringify({ app: "tally", version: 1, exportedAt: new Date().toISOString(),
    expenses, chips, budgets, bills, accounts, goals, incomes, recurringIncomes, transfers, settings: { ...settings, lockCredentialId: null } }, null, 2);
}

const DATA_STORES: StoreName[] = ["expenses", "chips", "budgets", "bills", "accounts", "goals", "incomes", "recurringIncomes", "transfers"];
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
    transfers: backup.transfers,
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
    transfers: backup.transfers,
    kv: [{ key: "settings", value: { ...state.settings, ...backup.settings } }, { key: RESTORE_POINT, value: current }],
  });
  await load();
  reportReplaced(before);
}

export function exportCSV(): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = ["date,amount_inr,your_share_inr,category,merchant,note,account,status,split_ways,source"];
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
  set({ expenses: [], chips: [], budgets: [], bills: [], accounts: [], goals: [], incomes: [], recurringIncomes: [], transfers: [], restorePointAt: null });
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
