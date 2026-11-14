import { dayOfMonth, daysInMonth, monthRange } from "./budget";
import { yourShare } from "./smartParser";

/** The numbers on a month's shareable recap card. Pure: give it the month's expenses. */

export interface RecapExpense { amount: number; splitWays: number; category: string; occurredAt: number; pending: boolean; exclude: boolean }
export interface RecapCategory { id: string; amount: number; share: number }
export interface RecapData {
  month: Date;
  /** Whole month, or only the days so far for the current month. */
  days: number;
  complete: boolean;
  spent: number;
  budget: number;
  count: number;
  noSpendDays: number;
  /** Spending by category, biggest first (at most 4; the rest are folded into "other"). */
  top: RecapCategory[];
}

export function recapData(expenses: RecapExpense[], month: Date, budget: number, now = new Date()): RecapData {
  const [start, end] = monthRange(month);
  const complete = now.getTime() >= end.getTime();
  const days = complete ? daysInMonth(month) : Math.max(dayOfMonth(now), 1);
  const list = expenses.filter((e) => !e.pending && !e.exclude && e.occurredAt >= start.getTime() && e.occurredAt < end.getTime());
  const spent = list.reduce((t, e) => t + yourShare(e.amount, e.splitWays), 0);
  const byCat = new Map<string, number>();
  for (const e of list) byCat.set(e.category, (byCat.get(e.category) ?? 0) + yourShare(e.amount, e.splitWays));
  const sorted = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const top: RecapCategory[] = sorted.slice(0, 4).map(([id, amount]) => ({ id, amount, share: spent ? amount / spent : 0 }));
  const rest = sorted.slice(4).reduce((t, [, a]) => t + a, 0);
  if (rest > 0) {
    const other = top.find((c) => c.id === "other");
    if (other) { other.amount += rest; other.share = other.amount / spent; }
    else top.push({ id: "other", amount: rest, share: rest / spent });
  }
  const spendDays = new Set(list.map((e) => dayOfMonth(new Date(e.occurredAt))));
  const noSpendDays = Array.from({ length: days }, (_, i) => i + 1).filter((d) => !spendDays.has(d)).length;
  return { month, days, complete, spent, budget, count: list.length, noSpendDays, top };
}
