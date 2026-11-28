/**
 * Credit card statements. With a statement day and a payment due day, a card's balance splits into
 * what was billed on the last statement (due on the due date) and what's been spent since (unbilled).
 */

/** The date with day-of-month `day` in the month `offset` months from `ref`, clipped to that month. */
const dayIn = (ref: Date, offset: number, day: number) => {
  const last = new Date(ref.getFullYear(), ref.getMonth() + offset + 1, 0).getDate();
  return new Date(ref.getFullYear(), ref.getMonth() + offset, Math.min(day, last));
};

export interface CardCycle {
  /** The last statement date on or before today. */
  lastStatement: Date;
  nextStatement: Date;
  /** When the last statement's bill must be paid. */
  dueDate: Date;
  /** Due date of the next statement, for once the current one is past. */
  nextDueDate: Date;
}

export function cardCycle(statementDay: number, dueDay: number, now = new Date()): CardCycle {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let lastStatement = dayIn(today, 0, statementDay);
  if (lastStatement > today) lastStatement = dayIn(today, -1, statementDay);
  const nextStatement = dayIn(lastStatement, 1, statementDay);
  // The due day falls after the statement: later the same month, or in the next one.
  const dueAfter = (st: Date) => {
    const same = dayIn(st, 0, dueDay);
    return same > st ? same : dayIn(st, 1, dueDay);
  };
  return { lastStatement, nextStatement, dueDate: dueAfter(lastStatement), nextDueDate: dueAfter(nextStatement) };
}

export interface CardBill {
  /** Billed on the last statement and still owed, or null when the due date has passed. */
  due: { amount: number; date: Date } | null;
  /**
   * Billed on the last statement, its due date passed, and still not paid. Only known when Tally
   * follows the card's transactions (payments to it are transfers); otherwise null.
   */
  overdue: { amount: number; date: Date } | null;
  /** When the bill being built now (the next statement's) will be due. */
  nextDue: Date;
  /** Spent since the last statement (known only when the card follows its transactions). */
  unbilled: number | null;
  nextStatement: Date;
}

/**
 * What's due on a card. `owed` is the card's current balance; `spentSince` is what was charged to
 * it since the last statement, or null when Tally doesn't track the card's transactions.
 */
export function cardBill(owed: number, spentSince: number | null, statementDay: number, dueDay: number, now = new Date()): CardBill {
  const c = cardCycle(statementDay, dueDay, now);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const billed = Math.max(0, owed - (spentSince ?? 0));
  return {
    due: billed > 0 && c.dueDate >= today ? { amount: billed, date: c.dueDate } : null,
    overdue: billed > 0 && spentSince !== null && c.dueDate < today ? { amount: billed, date: c.dueDate } : null,
    nextDue: c.nextDueDate,
    unbilled: spentSince,
    nextStatement: c.nextStatement,
  };
}

export interface CardUsage {
  used: number;
  /** Part of `used` that's purchases on EMI, still to be billed. */
  onEmi: number;
  limit: number;
  available: number;
  /** Share of the limit used, 0–1 (can go above 1 when over the limit). */
  share: number;
  /** ok under 30% (what lenders like to see), high from 30%, near from 80%, over past the limit. */
  tone: "ok" | "high" | "near" | "over";
}

/** How much of a card's limit is used. Null when the card has no limit set. */
export function cardUsage(owed: number, limit: number | undefined, onEmi = 0): CardUsage | null {
  if (!limit || limit <= 0) return null;
  // EMI purchases keep their unpaid principal blocked on the card until it's billed.
  const used = Math.max(0, owed) + Math.max(0, onEmi);
  const share = used / limit;
  return {
    used, onEmi: Math.max(0, onEmi), limit, available: limit - used, share,
    tone: share > 1 ? "over" : share >= 0.8 ? "near" : share >= 0.3 ? "high" : "ok",
  };
}

export interface CardPeriod { start: Date; end: Date }

/**
 * The card's last `count` billing periods, oldest first; the last is the one running now. With a
 * statement day each runs from one statement to the next; without one, calendar months.
 */
export function cardPeriods(statementDay: number | undefined, count: number, now = new Date()): CardPeriod[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOf = (k: number): Date => {
    if (!statementDay) return new Date(today.getFullYear(), today.getMonth() - k, 1);
    let last = dayIn(today, 0, statementDay);
    if (last > today) last = dayIn(today, -1, statementDay);
    return dayIn(last, -k, statementDay);
  };
  const out: CardPeriod[] = [];
  for (let k = count - 1; k >= 0; k--) out.push({ start: startOf(k), end: startOf(k - 1) });
  return out;
}
