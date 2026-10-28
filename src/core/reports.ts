import type { Account, Expense, Income } from "../data/store";
import { yourShare } from "./smartParser";
import { addMonths, monthKey, startOfDay } from "./budget";
import { categoryMeta, type Category } from "./categories";

/**
 * Reports: spending and income over any period, grouped and filtered, and net worth over time.
 * Pure. Amounts are your share in paise; pending and excluded expenses never count, as in the budget.
 */

export type Period = "this-month" | "last-month" | "3m" | "6m" | "12m" | "this-year" | "custom";
export const PERIOD_LABEL: Record<Period, string> = {
  "this-month": "This month", "last-month": "Last month", "3m": "Last 3 months", "6m": "Last 6 months",
  "12m": "Last 12 months", "this-year": "This year", custom: "Custom dates",
};

/** [start, end) for a period. Multi-month periods end with the current month. */
export function periodRange(period: Period, now: Date, custom?: { from: Date; to: Date }): [Date, Date] {
  const nextMonth = addMonths(now, 1);
  switch (period) {
    case "this-month": return [addMonths(now, 0), nextMonth];
    case "last-month": return [addMonths(now, -1), addMonths(now, 0)];
    case "3m": return [addMonths(now, -2), nextMonth];
    case "6m": return [addMonths(now, -5), nextMonth];
    case "12m": return [addMonths(now, -11), nextMonth];
    case "this-year": return [new Date(now.getFullYear(), 0, 1), nextMonth];
    case "custom": {
      const from = startOfDay(custom?.from ?? now);
      const to = startOfDay(custom?.to ?? now);
      const [a, b] = from <= to ? [from, to] : [to, from];
      return [a, new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1)];
    }
  }
}

export interface ReportFilter {
  categories?: Category[];
  accounts?: string[];
}

const share = (e: Expense) => yourShare(e.amount, e.splitWays);
const counted = (e: Expense) => !e.pending && !e.exclude;

export function expensesIn(expenses: Expense[], [start, end]: [Date, Date], filter: ReportFilter = {}): Expense[] {
  const a = start.getTime(), b = end.getTime();
  return expenses.filter((e) => counted(e) && e.occurredAt >= a && e.occurredAt < b
    && (!filter.categories?.length || filter.categories.includes(e.category))
    && (!filter.accounts?.length || filter.accounts.includes(e.account)));
}

export function incomesIn(incomes: Income[], [start, end]: [Date, Date], filter: ReportFilter = {}): Income[] {
  const a = start.getTime(), b = end.getTime();
  return incomes.filter((x) => x.receivedAt >= a && x.receivedAt < b && (!filter.accounts?.length || filter.accounts.includes(x.account)));
}

export type GroupBy = "category" | "merchant" | "account";
export const GROUP_LABEL: Record<GroupBy, string> = { category: "Category", merchant: "Place", account: "Payment method" };

export interface GroupRow { key: string; label: string; total: number; count: number; share: number; category: Category }

const placeOf = (e: Expense) => (e.merchant || e.note || categoryMeta(e.category).title).trim();

export function groupSpending(list: Expense[], by: GroupBy): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const e of list) {
    const key = by === "category" ? e.category : by === "account" ? e.account || "Other" : placeOf(e).toLowerCase();
    const label = by === "category" ? categoryMeta(e.category).title : by === "account" ? e.account || "Other" : placeOf(e);
    const row = map.get(key) ?? { key, label, total: 0, count: 0, share: 0, category: e.category };
    row.total += share(e);
    row.count += 1;
    map.set(key, row);
  }
  const total = [...map.values()].reduce((t, r) => t + r.total, 0);
  return [...map.values()].map((r) => ({ ...r, share: total ? r.total / total : 0 })).sort((a, b) => b.total - a.total);
}

export interface FlowMonth { month: Date; income: number; spending: number; net: number }

/** Income, spending and what was left for each month the range touches. */
export function monthlyCashFlow(expenses: Expense[], incomes: Income[], range: [Date, Date], filter: ReportFilter = {}): FlowMonth[] {
  const out: FlowMonth[] = [];
  for (let m = addMonths(range[0], 0); m < range[1]; m = addMonths(m, 1)) {
    const span: [Date, Date] = [m < range[0] ? range[0] : m, addMonths(m, 1) > range[1] ? range[1] : addMonths(m, 1)];
    const spending = expensesIn(expenses, span, filter).reduce((t, e) => t + share(e), 0);
    const income = incomesIn(incomes, span, filter).reduce((t, x) => t + x.amount, 0);
    out.push({ month: m, income, spending, net: income - spending });
  }
  return out;
}

export function incomeBySource(list: Income[]): { label: string; total: number }[] {
  const map = new Map<string, { label: string; total: number }>();
  for (const x of list) {
    const label = x.source.trim() || "Income";
    const row = map.get(label.toLowerCase()) ?? { label, total: 0 };
    row.total += x.amount;
    map.set(label.toLowerCase(), row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/** Savings rate as a fraction of income; null without income. */
export const savingsRate = (income: number, spending: number) => (income > 0 ? (income - spending) / income : null);

// ---------- net worth over time ----------

/** An account's balance at the end of a month: its last recorded balance in or before that month. */
export function balanceAt(account: Account, key: string): number | null {
  const history = { ...(account.history ?? {}), [monthKey(new Date(account.updatedAt || Date.now()))]: account.balance };
  const keys = Object.keys(history).filter((k) => k <= key).sort();
  return keys.length ? history[keys[keys.length - 1]] : null;
}

export interface NetWorthPoint { month: Date; assets: number; debts: number; net: number }

/** Month-end net worth for the last `count` months, from the balances recorded each month. */
export function netWorthSeries(accounts: Account[], now: Date, count: number): NetWorthPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const month = addMonths(now, i - count + 1);
    const key = monthKey(month);
    let assets = 0, debts = 0;
    for (const a of accounts) {
      const b = balanceAt(a, key);
      if (b === null) continue;
      if (a.kind === "card") debts += b; else assets += b;
    }
    return { month, assets, debts, net: assets - debts };
  });
}
