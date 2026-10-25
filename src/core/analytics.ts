import type { CategoryBudget, Expense } from "../data/store";
import { yourShare } from "./smartParser";
import { addMonths, daysInMonth, monthRange, sameDay, startOfDay } from "./budget";
import { categoryMeta, type Category } from "./categories";
import { formatMoney } from "./money";

/**
 * Spending analytics for the Finances screen. Pure functions over expenses: every amount is
 * your share in paise, and pending or excluded expenses never count, exactly as in the budget.
 */

const counted = (e: Expense) => !e.pending && !e.exclude;
const amount = (e: Expense) => yourShare(e.amount, e.splitWays);

export function spendIn(expenses: Expense[], start: Date, end: Date): Expense[] {
  const a = start.getTime(), b = end.getTime();
  return expenses.filter((e) => counted(e) && e.occurredAt >= a && e.occurredAt < b);
}

const sum = (list: Expense[]) => list.reduce((t, e) => t + amount(e), 0);

export interface MonthStats {
  month: Date;
  isCurrent: boolean;
  days: number;
  /** Days that have happened: today's date in the current month, otherwise the whole month. */
  elapsed: number;
  /** Spend per day of the month; index 0 is the 1st. */
  daily: number[];
  /** Number of expenses per day of the month. */
  dailyCount: number[];
  total: number;
  count: number;
  dailyAvg: number;
  /** Month-end estimate at the current daily average; null for finished months. */
  projected: number | null;
  /** Days with nothing spent, not counting today while it's still going. */
  noSpendDays: number;
  biggest: Expense | null;
}

export function monthStats(expenses: Expense[], month: Date, now: Date): MonthStats {
  const [start, end] = monthRange(month);
  const list = spendIn(expenses, start, end);
  const days = daysInMonth(month);
  const isCurrent = sameDay(start, monthRange(now)[0]);
  const elapsed = isCurrent ? now.getDate() : days;
  const daily = Array.from({ length: days }, () => 0);
  const dailyCount = Array.from({ length: days }, () => 0);
  for (const e of list) {
    const i = new Date(e.occurredAt).getDate() - 1;
    daily[i] += amount(e);
    dailyCount[i]++;
  }
  const total = sum(list);
  const finishedDays = isCurrent ? elapsed - 1 : days;
  return {
    month: start, isCurrent, days, elapsed, daily, dailyCount, total, count: list.length,
    dailyAvg: Math.round(total / Math.max(elapsed, 1)),
    projected: isCurrent ? Math.round((total * days) / Math.max(elapsed, 1)) : null,
    noSpendDays: daily.slice(0, Math.max(finishedDays, 0)).filter((v) => v === 0).length,
    biggest: [...list].sort((a, b) => amount(b) - amount(a))[0] ?? null,
  };
}

export function cumulative(daily: number[]): number[] {
  let t = 0;
  return daily.map((v) => (t += v));
}

/** What was spent in `month` up to and including `day` (clipped to that month's length). */
export function spentThroughDay(expenses: Expense[], month: Date, day: number): number {
  const [start] = monthRange(month);
  const last = Math.min(day, daysInMonth(month));
  return sum(spendIn(expenses, start, new Date(start.getFullYear(), start.getMonth(), last + 1)));
}

export function monthlyTotals(expenses: Expense[], endMonth: Date, count: number): { month: Date; total: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const [start, end] = monthRange(addMonths(endMonth, i - count + 1));
    return { month: start, total: sum(spendIn(expenses, start, end)) };
  });
}

/** Whole months with any logging before `month`, up to `max`: averages shouldn't be diluted for new users. */
function monthsOfHistory(expenses: Expense[], month: Date, max: number): number {
  const first = expenses.filter(counted).reduce((m, e) => Math.min(m, e.occurredAt), Infinity);
  if (!Number.isFinite(first)) return 0;
  const f = new Date(first), m = monthRange(month)[0];
  const between = (m.getFullYear() - f.getFullYear()) * 12 + (m.getMonth() - f.getMonth());
  return Math.max(0, Math.min(between, max));
}

export interface CategoryRow {
  category: Category;
  total: number;
  /** Share of the month's spending, 0–1. */
  share: number;
  /** Average monthly spend over up to 3 earlier months; null without history. */
  average: number | null;
  /** The category budget, when one is set. */
  limit: number | null;
}

export function categoryBreakdown(expenses: Expense[], month: Date, budgets: CategoryBudget[]): CategoryRow[] {
  const [start, end] = monthRange(month);
  const totals = new Map<Category, number>();
  for (const e of spendIn(expenses, start, end)) totals.set(e.category, (totals.get(e.category) ?? 0) + amount(e));
  const history = monthsOfHistory(expenses, month, 3);
  const before = new Map<Category, number>();
  if (history > 0) {
    for (const e of spendIn(expenses, monthRange(addMonths(month, -history))[0], start)) {
      before.set(e.category, (before.get(e.category) ?? 0) + amount(e));
    }
  }
  const monthTotal = [...totals.values()].reduce((a, b) => a + b, 0);
  const categories = new Set<Category>([...totals.keys(), ...budgets.map((b) => b.category)]);
  return [...categories]
    .map((category) => {
      const total = totals.get(category) ?? 0;
      return {
        category, total,
        share: monthTotal ? total / monthTotal : 0,
        average: history > 0 ? Math.round((before.get(category) ?? 0) / history) : null,
        limit: budgets.find((b) => b.category === category)?.limit ?? null,
      };
    })
    .sort((a, b) => b.total - a.total || (b.limit ?? 0) - (a.limit ?? 0));
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Monday = 0 … Sunday = 6. */
export const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7;

/** Average spend per weekday over the `days` before `end`, counting only days since logging began. */
export function weekdayAverages(expenses: Expense[], end: Date, days = 91): { weekday: number; average: number; total: number }[] {
  const endDay = startOfDay(end);
  const first = expenses.filter(counted).reduce((m, e) => Math.min(m, e.occurredAt), Infinity);
  const windowStart = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() - days + 1);
  const start = Number.isFinite(first) && first > windowStart.getTime() ? startOfDay(new Date(first)) : windowStart;
  const stop = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() + 1);
  const totals = Array.from({ length: 7 }, () => 0);
  const occurrences = Array.from({ length: 7 }, () => 0);
  for (let d = new Date(start); d < stop; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) occurrences[weekdayIndex(d)]++;
  for (const e of spendIn(expenses, start, stop)) totals[weekdayIndex(new Date(e.occurredAt))] += amount(e);
  return totals.map((total, weekday) => ({ weekday, total, average: occurrences[weekday] ? Math.round(total / occurrences[weekday]) : 0 }));
}

export interface MerchantRow { name: string; count: number; total: number; category: Category }

export function topMerchants(expenses: Expense[], start: Date, end: Date, n = 5): MerchantRow[] {
  const groups = new Map<string, MerchantRow>();
  for (const e of spendIn(expenses, start, end)) {
    const name = (e.merchant || e.note || categoryMeta(e.category).title).trim();
    const key = name.toLowerCase();
    const row = groups.get(key) ?? { name, count: 0, total: 0, category: e.category };
    row.count++;
    row.total += amount(e);
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total).slice(0, n);
}

/** Spend by account (UPI, card, cash…), largest first; past `max` the rest fold into "Other". */
export function paymentSplit(expenses: Expense[], start: Date, end: Date, max = 4): { account: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const e of spendIn(expenses, start, end)) {
    const account = e.account.trim() || "Unspecified";
    totals.set(account, (totals.get(account) ?? 0) + amount(e));
  }
  const rows = [...totals.entries()].map(([account, total]) => ({ account, total })).sort((a, b) => b.total - a.total);
  if (rows.length <= max) return rows;
  const rest = rows.slice(max - 1).reduce((t, r) => t + r.total, 0);
  return [...rows.slice(0, max - 1), { account: "Other", total: rest }];
}

export interface Insight {
  tone: "good" | "warn" | "info";
  title: string;
  detail: string;
}

/** Up to four plain-language observations, most actionable first. */
export function insights(expenses: Expense[], month: Date, now: Date, budget: number, budgets: CategoryBudget[]): Insight[] {
  const stats = monthStats(expenses, month, now);
  const out: Insight[] = [];
  const monthName = stats.month.toLocaleDateString([], { month: "long" });
  const lastDay = new Date(stats.month.getFullYear(), stats.month.getMonth(), stats.days)
    .toLocaleDateString([], { day: "numeric", month: "short" });

  // 1. Where the month is heading against the budget.
  if (stats.isCurrent && budget > 0 && stats.projected !== null && stats.total > 0) {
    const daysLeft = stats.days - stats.elapsed + 1;
    const spentBeforeToday = stats.total - stats.daily[stats.elapsed - 1];
    const perDay = Math.max(Math.floor((budget - spentBeforeToday) / daysLeft), 0);
    if (stats.projected > budget) {
      out.push({ tone: "warn", title: `On pace to go ${formatMoney(stats.projected - budget)} over budget`,
        detail: `At ${formatMoney(stats.dailyAvg)} a day you'll reach ${formatMoney(stats.projected)} by ${lastDay}. Keep to ${formatMoney(perDay)} a day to finish on budget.` });
    } else {
      out.push({ tone: "good", title: `On pace to finish ${formatMoney(budget - stats.projected)} under budget`,
        detail: `At ${formatMoney(stats.dailyAvg)} a day you'll reach about ${formatMoney(stats.projected)} by ${lastDay}.` });
    }
  } else if (!stats.isCurrent && budget > 0 && stats.total > 0) {
    const diff = budget - stats.total;
    out.push({ tone: diff >= 0 ? "good" : "warn",
      title: diff >= 0 ? `Finished ${monthName} ${formatMoney(diff)} under budget` : `Finished ${monthName} ${formatMoney(-diff)} over budget`,
      detail: `You spent ${formatMoney(stats.total)} against ${formatMoney(budget)}.` });
  }

  // 2. The category that moved most against its usual level, pro-rated to this point in the month.
  const fraction = stats.elapsed / stats.days;
  const rows = categoryBreakdown(expenses, month, budgets).filter((r) => r.average !== null && r.average > 0);
  const moves = rows.map((r) => ({ r, expected: Math.round(r.average! * fraction) }))
    .map((m) => ({ ...m, change: m.r.total - m.expected, pct: (m.r.total - m.expected) / Math.max(m.expected, 1) }));
  const rise = moves.filter((m) => m.pct >= 0.25 && m.change >= 50_000).sort((a, b) => b.change - a.change)[0];
  const fall = moves.filter((m) => m.pct <= -0.25 && -m.change >= 50_000).sort((a, b) => a.change - b.change)[0];
  const point = stats.isCurrent ? "by this point in" : "in";
  if (rise) {
    out.push({ tone: "warn", title: `${categoryMeta(rise.r.category).title} is up ${Math.round(rise.pct * 100)}% on your usual`,
      detail: `${formatMoney(rise.r.total)} so far, against about ${formatMoney(rise.expected)} ${point} a typical month.` });
  } else if (fall) {
    out.push({ tone: "good", title: `${categoryMeta(fall.r.category).title} is down ${Math.round(-fall.pct * 100)}% on your usual`,
      detail: `${formatMoney(fall.r.total)} so far, against about ${formatMoney(fall.expected)} ${point} a typical month.` });
  }

  // 3. Small spends that add up.
  const [start, end] = monthRange(month);
  const small = spendIn(expenses, start, end).filter((e) => amount(e) < 20_000);
  const smallTotal = sum(small);
  if (small.length >= 5 && stats.total > 0) {
    out.push({ tone: "info", title: `${small.length} small spends came to ${formatMoney(smallTotal)}`,
      detail: `Spends under ₹200 made up ${Math.round((smallTotal / stats.total) * 100)}% of ${monthName}.` });
  }

  // 4. Weekend-heavy spending, or no-spend days worth celebrating.
  const weekendTotal = stats.daily.reduce((t, v, i) => {
    const wd = weekdayIndex(new Date(stats.month.getFullYear(), stats.month.getMonth(), i + 1));
    return wd >= 5 ? t + v : t;
  }, 0);
  const weekendShare = stats.total ? weekendTotal / stats.total : 0;
  if (stats.total > 0 && weekendShare >= 0.4 && stats.elapsed >= 7) {
    out.push({ tone: "info", title: `Weekends took ${Math.round(weekendShare * 100)}% of your spending`,
      detail: `${formatMoney(weekendTotal)} on Saturdays and Sundays, which are about 29% of the days.` });
  } else if (stats.noSpendDays >= 3) {
    out.push({ tone: "good", title: `${stats.noSpendDays} no-spend days in ${monthName}`,
      detail: `Days with nothing spent${stats.isCurrent ? " so far, not counting today" : ""}.` });
  }

  return out.slice(0, 4);
}
