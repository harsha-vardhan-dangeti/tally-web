import { guessCategory, type Category } from "./categories";
import { personKey } from "./people";
import { parseCsv, parseStatementAmount, parseStatementDate } from "./statement";

/**
 * Splitwise's "Export as spreadsheet" CSV:
 *
 *   Date,Description,Category,Cost,Currency,Harsha,Ravi,Priya
 *   2026-10-01,Rent,Rent,30000.00,INR,20000.00,-10000.00,-10000.00
 *   2026-10-12,Ravi paid Harsha,Payment,10000.00,INR,-10000.00,10000.00,0.00
 *   2026-11-16,Total balance, , ,INR,10000.00,0.00,-10000.00
 *
 * Each member column is that person's net for the row: what they paid minus their share. Positive
 * means the group owes them; negative means they owe.
 */
export interface SplitwiseRow {
  date: Date;
  description: string;
  category: string;
  cost: number; // paise
  currency: string;
  nets: number[]; // paise, one per member
  payment: boolean;
}

export interface SplitwiseFile {
  members: string[];
  rows: SplitwiseRow[];
  /** The export's "Total balance" row, when it has one. */
  totals: number[] | null;
}

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

export function parseSplitwise(text: string): SplitwiseFile | null {
  const rows = parseCsv(text);
  const h = rows.findIndex((r) => norm(r[0]) === "date" && norm(r[1]) === "description" && norm(r[2]) === "category"
    && norm(r[3]) === "cost" && norm(r[4]) === "currency");
  if (h < 0) return null;
  const members = rows[h].slice(5).map((m) => m.trim());
  while (members.length && !members[members.length - 1]) members.pop();
  if (members.length < 2 || members.some((m) => !m)) return null;
  const out: SplitwiseRow[] = [];
  let totals: number[] | null = null;
  for (const r of rows.slice(h + 1)) {
    const nets = members.map((_, i) => parseStatementAmount(r[5 + i] ?? "")?.paise ?? 0);
    if (norm(r[1]) === "total balance") { totals = nets; continue; }
    const date = parseStatementDate(r[0] ?? "");
    const cost = parseStatementAmount(r[3] ?? "")?.paise;
    if (!date || cost === undefined) continue;
    out.push({ date, description: (r[1] ?? "").trim(), category: (r[2] ?? "").trim(), cost: Math.abs(cost), currency: (r[4] ?? "").trim().toUpperCase(),
      nets, payment: norm(r[2]) === "payment" });
  }
  return { members, rows: out, totals };
}

/** Splitwise's categories, for the ones Tally's own words wouldn't catch. */
const CATEGORY_MAP: [RegExp, Category][] = [
  [/groceries/, "groceries"],
  [/dining out|food and drink|liquor/, "food"],
  [/rent|mortgage|electricity|heat|gas|water|tv|phone|internet|utilities|cleaning|maintenance|insurance|trash/, "bills"],
  [/taxi|car|bus|train|plane|fuel|parking|bicycle|transportation|hotel/, "transport"],
  [/movies|music|games|sports|entertainment/, "fun"],
  [/medical/, "health"],
  [/clothing|electronics|furniture|household|gifts|pets|home/, "shopping"],
];

export function splitwiseCategory(category: string, description: string): Category {
  const c = norm(category);
  // Tally's words (and the user's rules) know merchants; Splitwise's category is the fallback.
  const guess = guessCategory(description);
  if (guess !== "other") return guess;
  for (const [re, cat] of CATEGORY_MAP) if (re.test(c)) return cat;
  return guessCategory(category);
}

/** A short, stable ID from text: the same row gives the same ID in next month's export. */
export function stableId(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export interface PlannedEntry {
  id: string;
  person: string;
  /** Change in what they owe you, as in the People ledger. */
  amount: number;
  kind: "lent" | "borrowed" | "settled";
}

export interface PlannedRow {
  key: string;
  date: Date;
  description: string;
  category: Category;
  payment: boolean;
  /** Your share of an expense, in the home currency; 0 for payments and rows you're not in. */
  share: number;
  /** The original amount when the row was in another currency. */
  fx?: { currency: string; amount: number; rate: number };
  entries: PlannedEntry[];
  /** Every ID in it is already in Tally: imported before. */
  imported: boolean;
  /** An expense you logged in Tally on about that day for about that amount. */
  maybeLogged: boolean;
  /** In a currency with no rate set. */
  noRate: boolean;
}

export interface PlanInput {
  file: SplitwiseFile;
  me: number;
  /** The name to use in Tally for each member, by column. */
  names: string[];
  home: string;
  rates: Record<string, number>;
  /** IDs already in Tally. */
  has: (id: string) => boolean;
  existing: { amount: number; at: number }[];
}

const DAY = 86_400_000;
const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/**
 * What importing a Splitwise export adds to Tally: for each row you're part of, your share as an
 * expense, and what each person owes you (or you owe them) in People. Rows with several payers are
 * split between them in proportion to what each was owed.
 */
export function planSplitwise({ file, me, names, home, rates, has, existing }: PlanInput): PlannedRow[] {
  const seen = new Map<string, number>();
  const out: PlannedRow[] = [];
  for (const r of file.rows) {
    const mine = r.nets[me] ?? 0;
    if (mine === 0) continue; // you weren't part of it
    const sig = `${ymd(r.date)}|${r.description}|${r.cost}|${r.currency}|${r.nets.join(",")}`;
    const n = (seen.get(sig) ?? 0) + 1;
    seen.set(sig, n);
    const key = `sw-${stableId(`${sig}#${n}`)}`;

    const foreign = !!r.currency && r.currency !== home;
    const rate = foreign ? rates[r.currency] : 1;
    const conv = (v: number) => Math.round(v * (rate ?? 1));
    const pos = r.nets.map((v, i) => ({ v, i })).filter((x) => x.v > 0);
    const neg = r.nets.map((v, i) => ({ v, i })).filter((x) => x.v < 0);
    const sumPos = pos.reduce((t, x) => t + x.v, 0);
    const entries: PlannedEntry[] = [];
    const add = (i: number, amount: number) => {
      const a = conv(amount);
      if (!a || i === me || !names[i]?.trim()) return;
      entries.push({ id: `${key}-${stableId(personKey(file.members[i]))}`, person: names[i].trim(), amount: a,
        kind: r.payment ? "settled" : a > 0 ? "lent" : "borrowed" });
    };
    if (mine > 0) for (const x of neg) add(x.i, Math.round((-x.v * mine) / sumPos));
    else for (const x of pos) add(x.i, -Math.round((-mine * x.v) / sumPos));

    let share = 0;
    if (!r.payment) {
      const involved = r.nets.filter((v) => v !== 0).length;
      share = mine < 0 ? -mine : pos.length === 1 ? r.cost - mine : Math.round(r.cost / Math.max(involved, 1));
      share = conv(Math.min(Math.max(share, 0), r.cost));
    }
    const ids = [...(share ? [key] : []), ...entries.map((e) => e.id)];
    const at = r.date.getTime();
    const cost = conv(r.cost);
    out.push({
      key, date: r.date, description: r.description || (r.payment ? "Payment" : "Shared expense"),
      category: splitwiseCategory(r.category, r.description), payment: r.payment, share,
      ...(foreign && rate ? { fx: { currency: r.currency, amount: r.cost, rate } } : {}),
      entries,
      imported: ids.length > 0 && ids.every(has),
      maybeLogged: !r.payment && existing.some((e) => Math.abs(e.at - at) <= 1.5 * DAY && (e.amount === cost || (share > 0 && e.amount === share))),
      noRate: foreign && !rate,
    });
  }
  return out;
}

/** Where each person stands with you after the rows: + they owe you. */
export function planBalances(rows: PlannedRow[]): Map<string, { name: string; amount: number }> {
  const out = new Map<string, { name: string; amount: number }>();
  for (const r of rows) for (const e of r.entries) {
    const k = personKey(e.person);
    const cur = out.get(k) ?? { name: e.person, amount: 0 };
    cur.amount += e.amount;
    out.set(k, cur);
  }
  return out;
}

/** Which column is you: the one matching your name, if any. */
export function guessMe(members: string[], yourNames: string[]): number {
  const keys = yourNames.map(personKey).filter(Boolean);
  const full = members.findIndex((m) => keys.includes(personKey(m)));
  if (full >= 0) return full;
  const firsts = keys.map((k) => k.split(" ")[0]);
  return members.findIndex((m) => firsts.includes(personKey(m).split(" ")[0]));
}

/**
 * Where you stand on Splitwise, from what you've imported: each person's net (+ they owe you), the
 * total, and when you last imported. Entries you add in Tally yourself aren't part of it, so it
 * matches what Splitwise shows.
 */
export function splitwiseStanding(ledger: { id: string; person: string; amount: number; createdAt: number }[]) {
  const byPerson = new Map<string, { name: string; amount: number }>();
  let lastImport = 0;
  for (const l of ledger) {
    if (!l.id.startsWith("sw-")) continue;
    const k = personKey(l.person);
    const cur = byPerson.get(k) ?? { name: l.person, amount: 0 };
    cur.amount += l.amount;
    byPerson.set(k, cur);
    lastImport = Math.max(lastImport, l.createdAt);
  }
  const people = [...byPerson.values()].filter((p) => p.amount !== 0).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return {
    people,
    owedToYou: people.filter((p) => p.amount > 0).reduce((t, p) => t + p.amount, 0),
    youOwe: people.filter((p) => p.amount < 0).reduce((t, p) => t - p.amount, 0),
    imported: byPerson.size > 0,
    lastImport,
  };
}
