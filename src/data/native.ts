import { CATEGORIES, CATEGORY_META, type Category } from "../core/categories";
import { monthKey, sameDay } from "../core/budget";
import { formatMoney } from "../core/money";
import {
  addExpense, counts, getState, inMonth, nextDue, share, showToast, subscribe, type State,
} from "./store";

/**
 * Bridge to Tally for Mac (macos/ in this repo). When the web app runs inside the Mac app's
 * WKWebView, it sends a small summary after every change so the desktop widgets can show it,
 * and it takes in expenses that were logged from widget buttons. Nothing leaves the Mac.
 * In a normal browser none of this runs.
 */

export const WIDGET_SNAPSHOT_VERSION = 1;

export interface WidgetSnapshot {
  version: number;
  generatedAt: number;
  /** "2026-10": the month the totals belong to. */
  month: string;
  /** "2026-10-24": the day spentToday belongs to. */
  today: string;
  budget: number;
  spentMonth: number;
  spentToday: number;
  categories: { id: Category; title: string; amount: number; tint: string }[];
  chips: { id: string; title: string; amount: number; category: Category; tint: string }[];
  bills: { id: string; name: string; amount: number; prevAmount: number; day: number; isSubscription: boolean; tint: string }[];
  pendingInbox: number;
}

/** An expense logged by tapping a widget button, waiting for the web app to add it. */
export interface WidgetLog {
  id: string;
  title: string;
  amount: number;
  category: string;
  loggedAt: number;
}

const dayKey = (d: Date) => `${monthKey(d)}-${String(d.getDate()).padStart(2, "0")}`;

export function buildWidgetSnapshot(s: State, now = new Date()): WidgetSnapshot {
  const month = inMonth(s.expenses, now).filter(counts);
  const totals = new Map<Category, number>();
  for (const e of month) totals.set(e.category, (totals.get(e.category) ?? 0) + share(e));
  return {
    version: WIDGET_SNAPSHOT_VERSION,
    generatedAt: now.getTime(),
    month: monthKey(now),
    today: dayKey(now),
    budget: s.settings.monthlyBudget,
    spentMonth: month.reduce((t, e) => t + share(e), 0),
    spentToday: month.filter((e) => sameDay(new Date(e.occurredAt), now)).reduce((t, e) => t + share(e), 0),
    categories: [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([id, amount]) => ({ id, title: CATEGORY_META[id].title, amount, tint: CATEGORY_META[id].tint })),
    chips: s.chips.slice(0, 8)
      .map((c) => ({ id: c.id, title: c.title, amount: c.amount, category: c.category, tint: CATEGORY_META[c.category].tint })),
    bills: [...s.bills].sort((a, b) => nextDue(a, now).getTime() - nextDue(b, now).getTime()).slice(0, 8)
      .map((b) => ({ id: b.id, name: b.name, amount: b.amount, prevAmount: b.prevAmount, day: b.day, isSubscription: b.isSubscription,
        tint: CATEGORY_META[b.category].tint })),
    pendingInbox: s.expenses.filter((e) => e.pending).length,
  };
}

/** Adds widget logs that aren't in Tally yet. Safe to call twice with the same logs. Returns their IDs. */
export function applyWidgetLogs(logs: WidgetLog[]): string[] {
  const known = new Set(getState().expenses.map((e) => e.id));
  const added: WidgetLog[] = [];
  for (const log of logs) {
    if (!log?.id || !Number.isSafeInteger(log.amount) || log.amount <= 0) continue;
    if (!known.has(log.id)) {
      const category = CATEGORIES.includes(log.category as Category) ? (log.category as Category) : "other";
      addExpense({ id: log.id, amount: log.amount, category, note: log.title, occurredAt: log.loggedAt, source: "widget" });
      known.add(log.id);
      added.push(log);
    }
  }
  if (added.length === 1) showToast(`Logged ${added[0].title} · ${formatMoney(added[0].amount)} from a widget`);
  else if (added.length > 1) showToast(`Logged ${added.length} expenses from widgets`);
  return logs.map((l) => l?.id).filter(Boolean);
}

interface NativeHandler { postMessage(message: unknown): void }
declare global {
  interface Window {
    webkit?: { messageHandlers?: { tally?: NativeHandler } };
    tallyNative?: { receiveLogs(logs: WidgetLog[]): void };
  }
}

export const inMacApp = () => typeof window !== "undefined" && !!window.webkit?.messageHandlers?.tally;

let started = false;

/** Call once the store has loaded. Does nothing outside Tally for Mac. */
export function startNativeBridge() {
  const native = window.webkit?.messageHandlers?.tally;
  if (!native || started) return;
  started = true;

  window.tallyNative = {
    receiveLogs(logs) {
      const ids = applyWidgetLogs(Array.isArray(logs) ? logs : []);
      native.postMessage({ type: "ack", ids });
    },
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = () => native.postMessage({ type: "snapshot", snapshot: buildWidgetSnapshot(getState()) });
  subscribe(() => { clearTimeout(timer); timer = setTimeout(send, 400); });
  send();
  // Tells the Mac app it can hand over logs that were tapped while Tally was closed.
  native.postMessage({ type: "ready" });
}
