export interface BudgetSnapshot {
  budget: number;
  spent: number;
  spentToday: number;
  left: number;
  daysLeft: number; // counting today
  safePerDay: number;
  leftToday: number;
  projected: number;
  fractionUsed: number;
  isOver: boolean;
  hasBudget: boolean;
}

/**
 * The budget month. It starts on the 1st unless the person picked another day (Settings → Month
 * starts on, 1–28), for example the 25th when salary arrives then. Every "this month" in the app —
 * the budget, safe to spend, Activity, Reports, the recap — goes through these functions, so with
 * a start day of 25, "this month" is 25 Oct – 24 Nov.
 */
let startDay = 1;
export function setMonthStartDay(n: number) { startDay = Number.isInteger(n) && n >= 1 && n <= 28 ? n : 1; }
export const monthStartDay = () => startDay;

/** First day of the budget month that contains `d`. */
export function cycleStart(d: Date): Date {
  return d.getDate() >= startDay ? new Date(d.getFullYear(), d.getMonth(), startDay) : new Date(d.getFullYear(), d.getMonth() - 1, startDay);
}

/** Days in the budget month containing `d`. */
export const daysInMonth = (d: Date) => {
  const [a, b] = monthRange(d);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
};
/** Which day of its budget month `d` is: 1 on the start day. */
export const dayOfMonth = (d: Date) => Math.round((startOfDay(d).getTime() - cycleStart(d).getTime()) / 86_400_000) + 1;

/** "November", or "25 Oct – 24 Nov" when the month starts on another day. */
export function monthLabel(d: Date, locale?: string, withYear = false): string {
  if (startDay === 1) return d.toLocaleDateString(locale, withYear ? { month: "long", year: "numeric" } : { month: "long" });
  const [a, b] = monthRange(d);
  const last = new Date(b.getFullYear(), b.getMonth(), b.getDate() - 1);
  const f = (x: Date) => x.toLocaleDateString(locale, { day: "numeric", month: "short" });
  return `${f(a)} – ${f(last)}${withYear ? ` ${last.getFullYear()}` : ""}`;
}

export function snapshot(budget: number, spent: number, spentToday: number, now: Date): BudgetSnapshot {
  const day = dayOfMonth(now);
  const dim = daysInMonth(now);
  const daysLeft = Math.max(dim - day + 1, 1);
  const availableFromToday = Math.max(budget - (spent - spentToday), 0);
  const safePerDay = budget > 0 ? Math.floor(availableFromToday / daysLeft) : 0;
  const leftToday = Math.max(safePerDay - spentToday, 0);
  const projected = Math.floor((spent * dim) / Math.max(day, 1));
  return {
    budget, spent, spentToday,
    left: budget - spent,
    daysLeft, safePerDay, leftToday, projected,
    fractionUsed: budget > 0 ? spent / budget : 0,
    isOver: budget > 0 && spent > budget,
    hasBudget: budget > 0,
  };
}

/** 80 or 100 when an expense pushes spend across that share of the limit. */
export function crossedThreshold(before: number, after: number, limit: number): 80 | 100 | null {
  if (limit <= 0 || after <= before) return null;
  for (const pct of [100, 80] as const) {
    const mark = Math.floor((limit * pct) / 100);
    if (before < mark && after >= mark) return pct;
  }
  return null;
}

export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** [start, end) of the budget month containing `d`. */
export function monthRange(d: Date): [Date, Date] {
  const s = cycleStart(d);
  return [s, new Date(s.getFullYear(), s.getMonth() + 1, startDay)];
}

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
/** The first day of the budget month `n` months from the one containing `d`. */
export const addMonths = (d: Date, n: number) => {
  const s = cycleStart(d);
  return new Date(s.getFullYear(), s.getMonth() + n, startDay);
};

/** Monday-to-Sunday week containing `d`: [start, end). */
export function weekRange(d: Date): [Date, Date] {
  const s = startOfDay(d);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return [s, new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7)];
}

export type BudgetPeriod = "week" | "month" | "year";
/** The current week, budget month or calendar year. */
export function periodBounds(period: BudgetPeriod, now: Date): [Date, Date] {
  if (period === "week") return weekRange(now);
  if (period === "year") return [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1)];
  return monthRange(now);
}
