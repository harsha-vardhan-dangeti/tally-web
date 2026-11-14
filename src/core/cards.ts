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
    unbilled: spentSince,
    nextStatement: c.nextStatement,
  };
}
