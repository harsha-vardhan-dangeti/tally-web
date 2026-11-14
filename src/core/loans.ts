/**
 * Loans repaid in equal monthly instalments (EMIs): home, car, education and personal loans, and
 * card purchases on EMI. Pure functions over the loan's terms; nothing is stored but the terms.
 */

export interface LoanTerms {
  principal: number; // paise borrowed
  ratePct: number; // yearly interest, e.g. 10.5
  months: number; // number of EMIs
  emi: number; // paise per month (banks round it, so it's stored rather than always computed)
  firstDueAt: number; // epoch ms of the first EMI
}

/** The standard EMI for a loan, rounded up to the next rupee like most lenders do. */
export function emiFor(principal: number, ratePct: number, months: number): number {
  if (!(principal > 0) || !(months > 0)) return 0;
  const r = ratePct / 1200;
  const raw = r === 0 ? principal / months : (principal * r * (1 + r) ** months) / ((1 + r) ** months - 1);
  return Math.ceil(raw / 100) * 100;
}

/** The date of EMI number `k` (0 = the first). Days past the month's end fall on its last day. */
export function dueDate(firstDueAt: number, k: number): Date {
  const first = new Date(firstDueAt);
  const y = first.getFullYear(), m = first.getMonth() + k;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(first.getDate(), last), 12);
}

/** EMIs whose date has come by `at` (counting the whole of that day). */
export function paidCount(l: LoanTerms, at: number): number {
  const endOfDay = new Date(at);
  endOfDay.setHours(23, 59, 59, 999);
  let k = 0;
  while (k < l.months && dueDate(l.firstDueAt, k).getTime() <= endOfDay.getTime()) k++;
  return k;
}

/** Principal still owed after `k` EMIs. */
export function outstandingAfter(l: LoanTerms, k: number): number {
  if (k <= 0) return l.principal;
  if (k >= l.months) return 0;
  const r = l.ratePct / 1200;
  const left = r === 0 ? l.principal - l.emi * k : l.principal * (1 + r) ** k - (l.emi * ((1 + r) ** k - 1)) / r;
  return Math.max(0, Math.round(left));
}

export interface LoanStatus {
  paid: number;
  left: number;
  outstanding: number;
  /** Share of the principal repaid, 0–1. */
  repaid: number;
  nextDue: Date | null;
  endsOn: Date;
  totalInterest: number;
}

export function loanStatus(l: LoanTerms, now = Date.now()): LoanStatus {
  const paid = paidCount(l, now);
  const outstanding = outstandingAfter(l, paid);
  return {
    paid, left: l.months - paid, outstanding,
    repaid: l.principal ? 1 - outstanding / l.principal : 1,
    nextDue: paid < l.months ? dueDate(l.firstDueAt, paid) : null,
    endsOn: dueDate(l.firstDueAt, l.months - 1),
    totalInterest: Math.max(0, l.emi * l.months - l.principal),
  };
}

/**
 * What's owed on a loan at a moment, for net worth over time: nothing before the loan was taken
 * (a month before its first EMI), the full principal until the first EMI, then what's left.
 */
export function outstandingAt(l: LoanTerms, at: number): number {
  const taken = dueDate(l.firstDueAt, -1).getTime();
  if (at < taken) return 0;
  return outstandingAfter(l, paidCount(l, at));
}
