import { people, personKey, splitNames, type LedgerLine, type Person, type SplitExpense } from "./people";
import { yourShare } from "./smartParser";

/**
 * Splitwise-style groups, from your side: a bill only matters to you when you paid it or you're in
 * the split. It's stored the way Tally already stores splits, so People and your spending follow:
 *  - you paid and you're in it → one split expense (amount, ways, who it's split with);
 *  - someone else paid and you're in it → a split expense with `paidBy`: you owe them your share
 *    (all of it when it was only for you);
 *  - you paid for others only → money lent to each of them;
 *  - someone else paid and you're not in it → nothing changes between you and anyone.
 */
export type BillPlan =
  | { kind: "expense"; splitWays: number; splitWith: string; paidBy?: string; yourShare: number; each: number;
      /** Unequal split: your part and each other person's. */
      myShare?: number; shares?: Record<string, number> }
  | { kind: "lent"; entries: { person: string; amount: number }[]; each: number }
  | { kind: "none" };

export type SplitMode = "equal" | "exact" | "percent";
export interface Share { person: string; amount: number }

/**
 * What was typed for each person, as amounts. Exact: values are paise. Percent: values are
 * percentages; the paise left by rounding go to the first people. `left` is what's still to assign
 * (paise or percentage points): 0 when it adds up, negative when it's over.
 */
export function unequalShares(amount: number, mode: "exact" | "percent", typed: { person: string; value: number }[]): { shares: Share[]; left: number } {
  const list = typed.filter((x) => x.value > 0);
  if (mode === "exact") {
    return { shares: list.map((x) => ({ person: x.person, amount: Math.round(x.value) })), left: amount - list.reduce((t, x) => t + Math.round(x.value), 0) };
  }
  const pct = Math.round(list.reduce((t, x) => t + x.value, 0) * 100) / 100;
  const shares = list.map((x) => ({ person: x.person, amount: Math.floor((amount * x.value) / 100) }));
  if (pct === 100) {
    let extra = amount - shares.reduce((t, x) => t + x.amount, 0);
    for (let i = 0; extra > 0 && shares.length; i = (i + 1) % shares.length, extra--) shares[i].amount++;
  }
  return { shares, left: Math.round((100 - pct) * 100) / 100 };
}

/**
 * `paidBy` and `among` use "" for you. With `shares` (an unequal split that adds up to `amount`),
 * each person's part is as given; otherwise everyone in `among` pays the same.
 */
export function planGroupBill(amount: number, paidBy: string, among: string[], shares?: Share[]): BillPlan {
  if (shares) return planUnequal(amount, paidBy.trim(), shares);
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
  if (you) return { kind: "expense", splitWays: 1, splitWith: "", ...(payer ? { paidBy: payer } : {}), yourShare: amount, each: amount };
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

/** Part of a settle-up: `amount` as a ledger amount (− they paid you, + you paid them), and the group it settles, if any. */
export interface Allocation { group?: string; amount: number }

/**
 * Where a settle-up with someone goes when it's recorded outside a group (in People): it pays off what's
 * open with them in each group they're in, in the order the groups are listed, and whatever is left
 * over is outside any group. `amount` is a ledger amount: − they paid you, + you paid them.
 */
export function allocateSettlement(amount: number, person: string, groups: GroupLike[],
  expenses: (SplitExpense & { group?: string })[], ledger: (LedgerLine & { group?: string })[]): Allocation[] {
  const sign = Math.sign(amount);
  let left = Math.abs(amount);
  const out: Allocation[] = [];
  const key = personKey(person);
  for (const g of groups) {
    if (left <= 0) break;
    const m = groupStanding(g, expenses, ledger).members.find((p) => p.key === key);
    // They paid you: it settles what they owe you there. You paid them: what you owe them there.
    const open = m ? (sign < 0 ? m.balance : -m.balance) : 0;
    if (open <= 0) continue;
    const take = Math.min(open, left);
    out.push({ group: g.id, amount: sign * take });
    left -= take;
  }
  if (left > 0) out.push({ amount: sign * left });
  return out;
}

/** "Ravi, Priya and Arjun" or one per line → clean, unique names. */
export const memberNames = (text: string) => splitNames(text.replace(/\n/g, ","));

function planUnequal(amount: number, payer: string, shares: Share[]): BillPlan {
  const seen = new Set<string>();
  const list = shares.filter((x) => { const k = personKey(x.person); if (x.amount <= 0 || seen.has(k)) return false; seen.add(k); return true; });
  if (amount <= 0 || !list.length) return { kind: "none" };
  const mine = list.find((x) => x.person === "")?.amount ?? 0;
  const others = list.filter((x) => x.person !== "");
  if (mine > 0 && others.length) {
    return { kind: "expense", splitWays: list.length, splitWith: others.map((x) => x.person).join(", "), ...(payer ? { paidBy: payer } : {}),
      yourShare: mine, each: mine, myShare: mine, shares: Object.fromEntries(others.map((x) => [x.person, x.amount])) };
  }
  if (mine > 0) return { kind: "expense", splitWays: 1, splitWith: "", ...(payer ? { paidBy: payer } : {}), yourShare: amount, each: amount };
  if (payer) return { kind: "none" };
  return { kind: "lent", entries: others, each: 0 };
}
