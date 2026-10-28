import type { Category } from "./categories";

/**
 * Finds charges that repeat: the same merchant, at a steady interval, for about the same amount.
 * Pure: the screens pass in expenses and bills, and decide what to do with what's found.
 */

export type Cadence = "weekly" | "monthly" | "quarterly" | "yearly";

const CADENCES: { cadence: Cadence; days: number; tolerance: number; perMonth: number }[] = [
  { cadence: "weekly", days: 7, tolerance: 1.5, perMonth: 52 / 12 },
  { cadence: "monthly", days: 30.4, tolerance: 4.5, perMonth: 1 },
  { cadence: "quarterly", days: 91, tolerance: 8, perMonth: 1 / 3 },
  { cadence: "yearly", days: 365, tolerance: 12, perMonth: 1 / 12 },
];

export interface ChargeLike {
  id: string;
  /** What the charge is called: the merchant, or the note when there's no merchant. */
  name: string;
  amount: number; // paise
  occurredAt: number;
  category: Category;
  account: string;
}

export interface RecurringCharge {
  /** Stable for a merchant, for dismissing it and matching bills. */
  key: string;
  name: string;
  category: Category;
  account: string;
  cadence: Cadence;
  /** The latest charge. */
  amount: number;
  /** The charge before it, when the price changed. */
  previousAmount: number | null;
  count: number;
  lastAt: number;
  nextAt: number;
  /** What it costs in an average month, for comparing weekly and yearly charges with monthly ones. */
  monthlyCost: number;
  /** The next charge is overdue by more than half an interval: it may have been cancelled. */
  maybeStopped: boolean;
  /** Day of the month it usually lands on (monthly only), for turning it into a bill. */
  day: number;
}

/** "Netflix.com 1234", "NETFLIX" and "netflix" are the same merchant. */
export function merchantKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.(com|in|co|net|org)\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !["pvt", "ltd", "private", "limited", "india", "payment", "upi", "the"].includes(w))
    .slice(0, 3)
    .join(" ");
}

const DAY = 86_400_000;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function detectRecurring(charges: ChargeLike[], opts: { now?: number; ignore?: Iterable<string> } = {}): RecurringCharge[] {
  const now = opts.now ?? Date.now();
  const ignore = new Set(opts.ignore ?? []);
  const groups = new Map<string, ChargeLike[]>();
  for (const c of charges) {
    const key = merchantKey(c.name);
    if (!key || ignore.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  const found: RecurringCharge[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.occurredAt - b.occurredAt);
    // Two charges on the same day are one purchase split up, not a repeat.
    const dated = sorted.filter((c, i) => i === 0 || c.occurredAt - sorted[i - 1].occurredAt > DAY / 2);
    if (dated.length < 2) continue;
    const gaps = dated.slice(1).map((c, i) => (c.occurredAt - dated[i].occurredAt) / DAY);
    const typical = median(gaps);
    const fit = CADENCES.find((c) => Math.abs(typical - c.days) <= c.tolerance);
    if (!fit) continue;
    const steady = gaps.filter((g) => Math.abs(g - fit.days) <= fit.tolerance * 1.5).length / gaps.length;
    const amounts = dated.map((c) => c.amount);
    const usual = median(amounts);
    const similar = amounts.filter((a) => Math.abs(a - usual) <= usual * 0.2).length / amounts.length;
    // Two charges are enough only when they're identical and a month apart; otherwise it takes three.
    // Weekly needs more: a weekly grocery run looks steady too, so it must be four near-identical charges.
    const enough = fit.cadence === "weekly"
      ? dated.length >= 4 && amounts.filter((a) => Math.abs(a - usual) <= usual * 0.05).length / amounts.length >= 0.8
      : dated.length >= 3 || (fit.cadence === "monthly" && amounts[0] === amounts[1]);
    if (!enough || steady < 0.7 || similar < 0.7) continue;

    const last = dated[dated.length - 1];
    const prev = dated[dated.length - 2];
    const day = Math.min(Math.round(median(dated.map((c) => new Date(c.occurredAt).getDate()))), 28);
    // Monthly charges land on the same day of the month, not every 30.4 days.
    const lastDate = new Date(last.occurredAt);
    const nextAt = fit.cadence === "monthly"
      ? new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, day, 12).getTime()
      : last.occurredAt + fit.days * DAY;
    found.push({
      key,
      name: last.name,
      category: last.category,
      account: last.account,
      cadence: fit.cadence,
      amount: last.amount,
      previousAmount: prev.amount !== last.amount ? prev.amount : null,
      count: dated.length,
      lastAt: last.occurredAt,
      nextAt,
      monthlyCost: Math.round(last.amount * fit.perMonth),
      maybeStopped: now > nextAt + (fit.days / 2) * DAY,
      day,
    });
  }
  return found.sort((a, b) => b.monthlyCost - a.monthlyCost);
}
