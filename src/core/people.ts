import { yourShare } from "./smartParser";

/**
 * Who owes whom. Balances come from two places:
 *  - split expenses: each person named in "split with" owes their share when you paid; when
 *    someone else paid (paidBy), you owe them yours;
 *  - entries in the ledger: money lent, borrowed, and paid back ("settled").
 * A positive balance means the person owes you; negative means you owe them.
 */

export interface SplitExpense {
  id: string; amount: number; merchant: string; note: string; occurredAt: number;
  pending: boolean; splitWays: number; splitWith: string; paidBy?: string;
}

export type LedgerKind = "lent" | "borrowed" | "settled";
export interface LedgerLine {
  id: string;
  person: string;
  /** Change in what the person owes you: lent +, borrowed −, they paid you back −, you paid them back +. */
  amount: number;
  kind: LedgerKind;
  note: string;
  occurredAt: number;
}

export interface PersonItem {
  key: string;
  kind: "split" | "paid-for-you" | LedgerKind;
  amount: number;
  title: string;
  at: number;
  expenseId?: string;
  entryId?: string;
}

export interface Person {
  key: string;
  name: string;
  balance: number;
  lastAt: number;
  items: PersonItem[];
}

export const personKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** "Arjun, Priya and Ravi" → ["Arjun", "Priya", "Ravi"]. */
export function splitNames(text: string): string[] {
  const seen = new Set<string>();
  return text.split(/,|&|\band\b|\+/i).map((n) => n.trim().replace(/\s+/g, " ")).filter((n) => {
    const k = personKey(n);
    if (!k || k === "me" || k === "you" || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Each person's share of a split expense (an equal split, as the expense records it). */
export const sharePerPerson = (e: Pick<SplitExpense, "amount" | "splitWays">) => yourShare(e.amount, e.splitWays);

export function people(expenses: SplitExpense[], ledger: LedgerLine[]): Person[] {
  const map = new Map<string, Person>();
  const add = (name: string, item: PersonItem) => {
    const key = personKey(name);
    if (!key) return;
    const p = map.get(key) ?? { key, name: name.trim(), balance: 0, lastAt: 0, items: [] };
    p.balance += item.amount;
    p.lastAt = Math.max(p.lastAt, item.at);
    p.items.push(item);
    map.set(key, p);
  };
  for (const e of expenses) {
    if (e.pending || e.splitWays < 2) continue;
    const each = sharePerPerson(e);
    const title = e.merchant || e.note || "Shared expense";
    const payer = e.paidBy?.trim();
    if (payer) {
      add(payer, { key: `x-${e.id}`, kind: "paid-for-you", amount: -each, title, at: e.occurredAt, expenseId: e.id });
    } else {
      for (const name of splitNames(e.splitWith)) {
        add(name, { key: `x-${e.id}-${personKey(name)}`, kind: "split", amount: each, title, at: e.occurredAt, expenseId: e.id });
      }
    }
  }
  for (const l of ledger) {
    if (!l.amount) continue;
    add(l.person, { key: `l-${l.id}`, kind: l.kind, amount: l.amount, title: l.note, at: l.occurredAt, entryId: l.id });
  }
  for (const p of map.values()) p.items.sort((a, b) => b.at - a.at);
  return [...map.values()].sort((a, b) => (Math.abs(b.balance) > 0 ? 1 : 0) - (Math.abs(a.balance) > 0 ? 1 : 0) || b.lastAt - a.lastAt);
}

export function peopleTotals(list: Person[]): { owedToYou: number; youOwe: number } {
  let owedToYou = 0, youOwe = 0;
  for (const p of list) {
    if (p.balance > 0) owedToYou += p.balance;
    else youOwe -= p.balance;
  }
  return { owedToYou, youOwe };
}

/** What's still unpaid, newest first, for "for Dinner at Toit, Cab home". */
export function unpaidTitles(p: Person, max = 3): string[] {
  const titles: string[] = [];
  for (const item of p.items) {
    if (item.amount <= 0 || !item.title || titles.includes(item.title)) continue;
    titles.push(item.title);
    if (titles.length >= max) break;
  }
  return titles;
}

const UPI_ID = /^[\w.-]{2,256}@[a-zA-Z][\w]{1,63}$/;
export const isUpiId = (v: string) => UPI_ID.test(v.trim());

export interface PayRequest { to: string; amount: number; currency: string; note: string; upi: string }

/**
 * A link to Tally's pay page with the request in the URL fragment: the fragment never reaches a
 * server, so the request stays between the two people.
 */
export function payLink(origin: string, r: PayRequest): string {
  const q = new URLSearchParams();
  if (r.to.trim()) q.set("to", r.to.trim().slice(0, 60));
  q.set("amt", String(Math.round(r.amount)));
  q.set("cur", r.currency);
  if (r.note.trim()) q.set("for", r.note.trim().slice(0, 80));
  if (isUpiId(r.upi)) q.set("upi", r.upi.trim());
  return `${origin}/pay#${q.toString()}`;
}

/** Reads a pay link's fragment; null when it isn't a valid request. */
export function readPayLink(hash: string, known: (code: string) => boolean): PayRequest | null {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const amount = Number(q.get("amt"));
  const currency = q.get("cur") ?? "INR";
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1e12 || !known(currency)) return null;
  const upi = q.get("upi") ?? "";
  return {
    to: (q.get("to") ?? "").slice(0, 60), amount, currency, note: (q.get("for") ?? "").slice(0, 80),
    upi: isUpiId(upi) ? upi : "",
  };
}

/** upi://pay link that opens GPay, PhonePe, Paytm or a bank app with the amount filled in. */
export function upiIntent(r: PayRequest): string | null {
  if (!r.upi || r.currency !== "INR") return null;
  const q = new URLSearchParams({ pa: r.upi, am: (r.amount / 100).toFixed(2), cu: "INR" });
  if (r.to) q.set("pn", r.to);
  if (r.note) q.set("tn", r.note.slice(0, 50));
  return `upi://pay?${q.toString()}`;
}
