import { people, personKey, splitNames, type LedgerLine, type Person, type SplitExpense } from "./people";
import { yourShare } from "./smartParser";

/**
 * Splitwise-style groups, from your side: a bill only matters to you when you paid it or you're in
 * the split. It's stored the way Tally already stores splits, so People and your spending follow:
 *  - you paid and you're in it → one split expense (amount, ways, who it's split with);
 *  - someone else paid and you're in it → a split expense with `paidBy`: you owe them your share;
 *  - you paid for others only → money lent to each of them;
 *  - someone else paid and you're not in it → nothing changes between you and anyone.
 */
export type BillPlan =
  | { kind: "expense"; splitWays: number; splitWith: string; paidBy?: string; yourShare: number; each: number }
  | { kind: "lent"; entries: { person: string; amount: number }[]; each: number }
  | { kind: "none" };

/** `paidBy` and `among` use "" for you. */
export function planGroupBill(amount: number, paidBy: string, among: string[]): BillPlan {
  const seen = new Set<string>();
  const list = among.filter((n) => { const k = personKey(n); if (seen.has(k)) return false; seen.add(k); return true; });
  if (amount <= 0 || list.length === 0) return { kind: "none" };
  const you = list.includes("");
  const others = list.filter((n) => n !== "");
  const payer = paidBy.trim();
  if (you && list.length > 1) {
    const each = yourShare(amount, list.length);
    return { kind: "expense", splitWays: list.length, splitWith: others.join(", "), ...(payer ? { paidBy: payer } : {}), yourShare: each, each };
  }
  if (you) return payer ? { kind: "none" } : { kind: "expense", splitWays: 1, splitWith: "", yourShare: amount, each: amount };
  if (payer) return { kind: "none" };
  // Shares that add up exactly: the first ones take the leftover paise.
  const base = Math.floor(amount / others.length), extra = amount - base * others.length;
  return { kind: "lent", entries: others.map((person, i) => ({ person, amount: base + (i < extra ? 1 : 0) })), each: base };
}

export interface GroupLike { id: string; members: string[] }

/** Where each member stands with you inside the group (+ they owe you), and the group's total. */
export function groupStanding(group: GroupLike, expenses: (SplitExpense & { group?: string })[], ledger: (LedgerLine & { group?: string })[]) {
  const list = people(expenses.filter((e) => e.group === group.id), ledger.filter((l) => l.group === group.id));
  const byKey = new Map(list.map((p) => [p.key, p]));
  const members: Person[] = group.members.map((m) => byKey.get(personKey(m)) ?? { key: personKey(m), name: m, balance: 0, lastAt: 0, items: [] });
  // Someone who has bills in the group but was taken off the member list still counts.
  for (const p of list) if (!group.members.some((m) => personKey(m) === p.key)) members.push(p);
  const owedToYou = members.filter((p) => p.balance > 0).reduce((t, p) => t + p.balance, 0);
  const youOwe = members.filter((p) => p.balance < 0).reduce((t, p) => t - p.balance, 0);
  return { members, owedToYou, youOwe, net: owedToYou - youOwe };
}

/** "Ravi, Priya and Arjun" or one per line → clean, unique names. */
export const memberNames = (text: string) => splitNames(text.replace(/\n/g, ","));
