/**
 * When repeating things fall due: bills every week, month or year. Each period has a key
 * ("2026-11", "2026", "w2026-11-09") so a payment is added once per period, on any device.
 */

export type Every = "week" | "month" | "year";

export interface Repeat {
  every?: Every; // missing: monthly
  day: number; // day of the month, 1–28 (month and year)
  weekday?: number; // 0 = Sunday … 6 (week)
  month?: number; // 0 = January … 11 (year)
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const mondayOf = (d: Date) => { const m = midnight(d); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; };

/** The due date within the period containing `now` (this week, month or year). */
export function dueInPeriod(r: Repeat, now: Date): Date {
  const every = r.every ?? "month";
  if (every === "week") {
    const mon = mondayOf(now);
    return new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + (((r.weekday ?? 1) + 6) % 7), 9);
  }
  if (every === "year") return new Date(now.getFullYear(), r.month ?? 0, r.day, 9);
  return new Date(now.getFullYear(), now.getMonth(), r.day, 9);
}

/** Key of the period containing `now`, matching the keys stored as "last logged". */
export function periodKey(r: Repeat, now: Date): string {
  const every = r.every ?? "month";
  if (every === "week") return `w${ymd(mondayOf(now))}`;
  if (every === "year") return String(now.getFullYear());
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** The next due date on or after today. */
export function nextDueDate(r: Repeat, from = new Date()): Date {
  const today = midnight(from);
  const every = r.every ?? "month";
  const due = midnight(dueInPeriod(r, from));
  if (due >= today) return due;
  if (every === "week") return new Date(due.getFullYear(), due.getMonth(), due.getDate() + 7);
  if (every === "year") return new Date(due.getFullYear() + 1, due.getMonth(), due.getDate());
  return new Date(due.getFullYear(), due.getMonth() + 1, due.getDate());
}

/** A cost spread over a month, for "subscriptions cost ₹X a month". */
export const monthlyEquivalent = (amount: number, every: Every = "month") =>
  every === "week" ? Math.round((amount * 52) / 12) : every === "year" ? Math.round(amount / 12) : amount;

export const EVERY_LABEL: Record<Every, string> = { week: "Every week", month: "Every month", year: "Every year" };
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
