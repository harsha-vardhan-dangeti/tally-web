import type { Expense, Income, LedgerEntry, State, Transfer } from "./store";

/**
 * Everything that happened in a stretch of time, in one list: expenses, income, transfers between
 * your accounts, and money with people (lent, borrowed, settled up). Only expenses are spending;
 * the rest show where money moved.
 */
export type ActivityKind = "expense" | "income" | "transfer" | "people";

export type ActivityItem =
  | { kind: "expense"; key: string; at: number; expense: Expense }
  | { kind: "income"; key: string; at: number; income: Income; amount: number }
  | { kind: "transfer"; key: string; at: number; transfer: Transfer; from: string; to: string; amount: number }
  | { kind: "people"; key: string; at: number; entry: LedgerEntry; title: string;
      /** Money to you: + it came in (they paid you back, you borrowed), − it went out (you lent, you paid them back). */
      amount: number };

/** "Lent to Ravi", "Ravi paid you back", … */
export function ledgerTitle(l: Pick<LedgerEntry, "kind" | "person" | "amount">): string {
  if (l.kind === "lent") return `Lent to ${l.person}`;
  if (l.kind === "borrowed") return `Borrowed from ${l.person}`;
  return l.amount > 0 ? `You paid ${l.person} back` : `${l.person} paid you back`;
}

export function activityItems(s: Pick<State, "expenses" | "incomes" | "transfers" | "ledger" | "accounts">, start: number, end: number): ActivityItem[] {
  const within = (t: number) => t >= start && t < end;
  const name = (id: string, fallback: string) => s.accounts.find((a) => a.id === id)?.name ?? fallback;
  const out: ActivityItem[] = [];
  for (const e of s.expenses) if (!e.pending && within(e.occurredAt)) out.push({ kind: "expense", key: `e-${e.id}`, at: e.occurredAt, expense: e });
  for (const x of s.incomes) if (within(x.receivedAt)) out.push({ kind: "income", key: `i-${x.id}`, at: x.receivedAt, income: x, amount: x.amount });
  for (const t of s.transfers) if (within(t.occurredAt)) {
    out.push({ kind: "transfer", key: `t-${t.id}`, at: t.occurredAt, transfer: t, from: name(t.fromId, t.fromName), to: name(t.toId, t.toName), amount: t.amount });
  }
  for (const l of s.ledger) if (l.amount && within(l.occurredAt)) {
    out.push({ kind: "people", key: `l-${l.id}`, at: l.occurredAt, entry: l, title: ledgerTitle(l), amount: -l.amount });
  }
  return out.sort((a, b) => b.at - a.at);
}
