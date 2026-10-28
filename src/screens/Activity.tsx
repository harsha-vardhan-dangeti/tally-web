import { useMemo, useRef, useState } from "react";
import {
  addExpense, counts, deleteChip, deleteExpense, expenseTitle, inMonth, makeRecurring, saveChip, share,
  showToast, uid, updateExpense, useTally, type Chip, type Expense, type Income,
} from "../data/store";
import { addMonths, sameDay, startOfDay } from "../core/budget";
import { formatMoney, parsePaise } from "../core/money";
import { categoryMeta, pickableCategories, type Category } from "../core/categories";
import { CategoryIcon, Icon } from "../ui/icons";
import { Empty, Field, Sheet, SwipeRow, useLongPress } from "../ui/components";
import { DaySheet, IncomeEditor, MonthCalendar } from "./Calendar";

export function ExpenseRowView({ e }: { e: Expense }) {
  const time = new Date(e.occurredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <div className="expense-row">
      <CategoryIcon category={e.category} />
      <div className="grow col gap4">
        <span className="t-strong ellipsis">{expenseTitle(e)}</span>
        <span className="t-muted tiny ellipsis">
          {categoryMeta(e.category).title} · {e.account} · {time}{e.exclude ? " · not in budget" : ""}
        </span>
      </div>
      <div className="col amt">
        <span className="num">−{formatMoney(e.amount, { showPaise: true })}</span>
        {e.splitWays > 1 && <span className="t-muted tiny num">you {formatMoney(share(e))}</span>}
      </div>
    </div>
  );
}

export function SwipeExpense({ e, onOpen }: { e: Expense; onOpen: () => void }) {
  return (
    <SwipeRow
      onOpen={onOpen}
      onFullLeft={() => deleteExpense(e.id)}
      left={[
        { label: "Edit", icon: "edit", color: "var(--accent)", run: onOpen },
        { label: "Delete", icon: "trash", color: "#C2321F", run: () => deleteExpense(e.id) },
      ]}
      right={[
        {
          label: e.splitWays > 1 ? "Unsplit" : "Split", icon: "split", color: "#4B4FC4",
          run: () => {
            const ways = e.splitWays > 1 ? 1 : 2;
            updateExpense(e.id, { splitWays: ways });
            showToast(ways > 1 ? `Split 2 ways · your share ${formatMoney(Math.floor(e.amount / 2))}` : "No longer split");
          },
        },
        { label: "Repeat", icon: "repeat", color: "#0E7C86", run: () => { makeRecurring(e); showToast(`${expenseTitle(e)} will repeat monthly`); } },
      ]}
    >
      <ExpenseRowView e={e} />
    </SwipeRow>
  );
}

export function ChipButton({ chip, onEdit }: { chip: Chip; onEdit: (c: Chip) => void }) {
  const log = () => {
    const e = addExpense({ amount: chip.amount, category: chip.category, note: chip.title, source: "manual" });
    navigator.vibrate?.(10);
    showToast(`Logged ${chip.title} · ${formatMoney(chip.amount)}`, () => deleteExpense(e.id, false));
  };
  const press = useLongPress(log, () => onEdit(chip));
  return (
    <button className="chip" {...press} aria-label={`Log ${chip.title}, ${formatMoney(chip.amount)}. Long press for options`}>
      {chip.title} · {formatMoney(chip.amount)}
    </button>
  );
}

/** Every expense, month by month, as a list or a calendar, filtered by category. */
export function Activity({ onOpen, onAdd, onSearch }: { onOpen: (e: Expense) => void; onAdd: (day?: Date) => void; onSearch: () => void }) {
  const s = useTally();
  const [offset, setOffset] = useState(0);
  const [cat, setCat] = useState<Category | null>(null);
  const [view, setView] = useState<"list" | "calendar">(() => {
    try { return localStorage.getItem("tally:homeView") === "calendar" ? "calendar" : "list"; } catch { return "list"; }
  });
  const [pickedDay, setPickedDay] = useState<Date | null>(null);
  const [incomeEdit, setIncomeEdit] = useState<{ income: Income | null; day: Date } | null>(null);
  const changeView = (v: "list" | "calendar") => {
    setView(v);
    try { localStorage.setItem("tally:homeView", v); } catch { /* storage blocked: the choice lasts this visit */ }
  };
  const [pull, setPull] = useState(0);
  const pullStart = useRef<number | null>(null);

  const now = new Date();
  const monthDate = addMonths(now, offset);
  const isCurrent = offset === 0;

  const all = useMemo(() => inMonth(s.expenses, monthDate).filter((e) => !e.pending), [s.expenses, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  const month = cat ? all.filter((e) => e.category === cat) : all;
  const spent = month.filter(counts).reduce((t, e) => t + share(e), 0);
  const [mStart, mEnd] = [monthDate.getTime(), addMonths(monthDate, 1).getTime()];
  const received = cat ? 0 : s.incomes.filter((x) => x.receivedAt >= mStart && x.receivedAt < mEnd).reduce((t, x) => t + x.amount, 0);
  // Filter chips: the categories this month actually has, biggest first.
  const used = useMemo(() => {
    const m = new Map<Category, number>();
    for (const e of all.filter(counts)) m.set(e.category, (m.get(e.category) ?? 0) + share(e));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [all]);

  const groups = useMemo(() => {
    const map = new Map<number, Expense[]>();
    for (const e of month) {
      const k = startOfDay(new Date(e.occurredAt)).getTime();
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [month]);

  const dayTitle = (t: number) => {
    const d = new Date(t);
    if (sameDay(d, now)) return "Today";
    if (sameDay(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  };

  // Pull down at the top of the page to search.
  const touchStart = (e: React.TouchEvent) => { pullStart.current = window.scrollY <= 0 ? e.touches[0].clientY : null; };
  const touchMove = (e: React.TouchEvent) => {
    if (pullStart.current === null) return;
    setPull(Math.max(0, Math.min(e.touches[0].clientY - pullStart.current, 120)));
  };
  const touchEnd = () => { if (pull > 80) onSearch(); setPull(0); pullStart.current = null; };

  return (
    <div className="page" onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd}
      style={{ transform: pull ? `translateY(${pull / 2}px)` : undefined }}>
      {pull > 0 && <div className="pull-hint" style={{ opacity: Math.min(pull / 80, 1) }}>{pull > 80 ? "Release to search" : "Pull to search"}</div>}
      <header className="page-head">
        <h1 className="display">Activity</h1>
        <button className="icon-btn" onClick={onSearch} aria-label="Search (/)"><Icon name="search" size={20} /></button>
      </header>

      <div className="activity-bar card">
        <div className="month-switch">
          <button className="icon-btn" onClick={() => setOffset((o) => o - 1)} aria-label="Previous month"><Icon name="back" size={18} /></button>
          <span className="t-strong">{monthDate.toLocaleDateString([], { month: "long", year: "numeric" })}</span>
          <button className="icon-btn" onClick={() => setOffset((o) => o + 1)} disabled={isCurrent} aria-label="Next month"><Icon name="next" size={18} /></button>
        </div>
        <dl className="activity-sum">
          <div><dt>Spent</dt><dd className="num">{formatMoney(spent)}</dd></div>
          {!cat && <div><dt>Received</dt><dd className="num in">{received ? `+${formatMoney(received)}` : "—"}</dd></div>}
          <div><dt>{cat ? categoryMeta(cat).title : "Expenses"}</dt><dd className="num">{month.length}</dd></div>
        </dl>
      </div>

      <div className="row between wrap gap8">
        <div className="view-switch" role="group" aria-label="Show expenses as">
          <button aria-pressed={view === "list"} onClick={() => changeView("list")}><Icon name="inbox" size={16} />List</button>
          <button aria-pressed={view === "calendar"} onClick={() => changeView("calendar")}><Icon name="grid" size={16} />Calendar</button>
        </div>
      </div>
      {view === "list" && used.length > 1 && (
        <div className="chips" role="group" aria-label="Filter by category">
          <button className={`chip${cat === null ? " on" : ""}`} aria-pressed={cat === null} onClick={() => setCat(null)}>All</button>
          {used.map((c) => (
            <button key={c} className={`chip${cat === c ? " on" : ""}`} aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>{categoryMeta(c).title}</button>
          ))}
        </div>
      )}

      {view === "calendar" ? (
        <MonthCalendar month={monthDate} onPrev={() => setOffset((o) => o - 1)}
          onNext={offset < 0 ? () => setOffset((o) => o + 1) : undefined} onPickDay={setPickedDay} />
      ) : groups.length === 0 ? (
        <div className="card">
          <Empty title={cat ? `No ${categoryMeta(cat).title} this month` : isCurrent ? "Nothing logged yet" : "No expenses this month"}
            body="Tap a repeat on Home, press + or N, or type a sentence with Smart add."
            action={isCurrent && !cat ? <button className="btn primary" onClick={() => onAdd()}>Log an expense</button> : undefined} />
        </div>
      ) : (
        groups.map(([day, items]) => (
          <section key={day} className="col gap8">
            <div className="section-title">
              <span>{dayTitle(day)}</span>
              <span className="t-muted num">{formatMoney(items.filter(counts).reduce((t, e) => t + share(e), 0))}</span>
            </div>
            <div className="card flush">
              {items.map((e) => <SwipeExpense key={e.id} e={e} onOpen={() => onOpen(e)} />)}
            </div>
          </section>
        ))
      )}
      {view === "list" && groups.length > 0 && <p className="t-muted tiny" style={{ textAlign: "center", margin: 0 }}>Swipe a row left to edit or delete, right to split or repeat</p>}

      <DaySheet day={pickedDay} onClose={() => setPickedDay(null)} onOpenExpense={onOpen} onAddExpense={(day) => onAdd(day)}
        onEditIncome={setIncomeEdit} />
      <IncomeEditor value={incomeEdit} onClose={() => setIncomeEdit(null)} />
    </div>
  );
}

export function greeting(h: number) {
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function ChipEditor({ chip, open, onClose }: { chip: Chip | null; open: boolean; onClose: () => void }) {
  const s = useTally();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<Category>("food");
  const [lastChip, setLastChip] = useState<Chip | null | undefined>(undefined);
  if (open && lastChip !== chip) {
    setLastChip(chip);
    setTitle(chip?.title ?? "");
    setAmount(chip ? String(chip.amount / 100) : "");
    setCategory(chip?.category ?? "food");
  }
  if (!open && lastChip !== undefined) setLastChip(undefined);
  const paise = parsePaise(amount);

  const logWith = (delta: number) => {
    if (!chip) return;
    const amt = chip.amount + delta * 100;
    const e = addExpense({ amount: amt, category: chip.category, note: chip.title, source: "manual" });
    showToast(`Logged ${chip.title} · ${formatMoney(amt)}`, () => deleteExpense(e.id, false));
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={chip ? chip.title : "Pin a repeat"}>
      {chip && (
        <div className="row gap8 wrap">
          {[-50, 50, 100].filter((d) => chip.amount + d * 100 > 0).map((d) => (
            <button key={d} className="chip" onClick={() => logWith(d)}>Log {formatMoney(chip.amount + d * 100)}</button>
          ))}
        </div>
      )}
      <Field label="Name"><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Coffee" /></Field>
      <Field label="Amount (₹)"><input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="180" /></Field>
      <Field label="Category">
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          {pickableCategories(category).map((c) => <option key={c} value={c}>{categoryMeta(c).title}</option>)}
        </select>
      </Field>
      <button className="btn primary block" disabled={!title || !paise} onClick={() => {
        saveChip({ id: chip?.id ?? uid(), title, amount: paise!, category, order: chip?.order ?? s.chips.length });
        onClose();
      }}>Save</button>
      {chip && <button className="btn danger block" onClick={() => { deleteChip(chip.id); onClose(); }}>Remove this repeat</button>}
    </Sheet>
  );
}
