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

export const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

export function snapshot(budget: number, spent: number, spentToday: number, now: Date): BudgetSnapshot {
  const day = now.getDate();
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

export function monthRange(d: Date): [Date, Date] {
  return [new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 1)];
}

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
