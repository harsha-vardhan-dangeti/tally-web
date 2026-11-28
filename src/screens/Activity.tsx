import { t } from "../i18n";
import { useMemo, useRef, useState } from "react";
import {
  addExpense, counts, deleteChip, deleteExpense, expenseTitle, makeRecurring, saveChip, share,
  showToast, uid, updateExpense, useTally, type Chip, type Expense, type Income,
} from "../data/store";
import { addMonths, monthLabel, monthRange, sameDay, startOfDay } from "../core/budget";
import { activityItems, type ActivityItem } from "../data/activity";
import { IncomeRowView, MoveRowView, MoveSheet, type MoveItem } from "./ActivityRows";
import { formatMoney, parsePaise, currencySymbol } from "../core/money";
import { categoryMeta, type Category } from "../core/categories";
import { CategoryIcon, Icon } from "../ui/icons";
import { Empty, Field, Sheet, SwipeRow, useLongPress } from "../ui/components";
import { DaySheet, IncomeEditor, MonthCalendar } from "./Calendar";
import { ProfileButton } from "../ui/ProfileMenu";
import { CategorySelect } from "../ui/CategorySelect";

export function ExpenseRowView({ e }: { e: Expense }) {
  const time = new Date(e.occurredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <div className="expense-row">
      <CategoryIcon category={e.category} />
      <div className="grow col gap4">
        <span className="t-strong ellipsis">{expenseTitle(e)}</span>
        <span className="t-muted tiny ellipsis">
          {categoryMeta(e.category).title}{e.sub ? ` · ${e.sub}` : ""} · {e.paidBy ? `${e.paidBy} paid` : e.account} · {time}{e.exclude ? " · not in budget" : ""}
          {e.tags?.length ? ` · ${e.tags.map((x) => `#${x}`).join(" ")}` : ""}
        </span>
      </div>
      <div className="col amt">
        <span className="num">−{formatMoney(e.amount, { showPaise: true })}</span>
        {e.splitWays > 1 && <span className="t-muted tiny num">{t("you {amount}", { amount: formatMoney(share(e)) })}</span>}
        {e.fx && <span className="t-muted tiny num">{formatMoney(e.fx.amount, { currency: e.fx.currency, showPaise: true })}</span>}
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

/** What the Activity list is narrowed to: a category of expenses, or one kind of money movement. */
type Filter = Category | "@income" | "@transfer" | "@people";
const KIND_CHIPS: [Filter, ActivityItem["kind"], string][] = [["@income", "income", "Income"], ["@transfer", "transfer", "Transfers"], ["@people", "people", "With people"]];
const isKind = (f: Filter | null): f is "@income" | "@transfer" | "@people" => !!f && f.startsWith("@");

/** Everything that happened, month by month, as a list or a calendar: expenses, income, transfers and money with people. */
export function Activity({ onOpen, onAdd, onSearch }: { onOpen: (e: Expense) => void; onAdd: (day?: Date) => void; onSearch: () => void }) {
  const s = useTally();
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<Filter | null>(null);
  const cat = isKind(filter) ? null : filter;
  const [moving, setMoving] = useState<MoveItem | null>(null);
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

  const [mStart, mEnd] = monthRange(monthDate).map((d) => d.getTime());
  const feed = useMemo(() => activityItems(s, mStart, mEnd), [s.expenses, s.incomes, s.transfers, s.ledger, s.accounts, mStart, mEnd]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => feed.flatMap((x) => (x.kind === "expense" ? [x.expense] : [])), [feed]);
  const month = cat ? all.filter((e) => e.category === cat) : all;
  const shown = filter === null ? feed
    : isKind(filter) ? feed.filter((x) => x.kind === KIND_CHIPS.find(([f]) => f === filter)![1])
    : feed.filter((x) => x.kind === "expense" && x.expense.category === filter);
  const spent = month.filter(counts).reduce((t, e) => t + share(e), 0);
  const received = cat ? 0 : feed.reduce((t, x) => t + (x.kind === "income" ? x.amount : 0), 0);
  const kinds = KIND_CHIPS.filter(([, k]) => feed.some((x) => x.kind === k));
  // Filter chips: the categories this month actually has, biggest first.
  const used = useMemo(() => {
    const m = new Map<Category, number>();
    for (const e of all.filter(counts)) m.set(e.category, (m.get(e.category) ?? 0) + share(e));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [all]);

  const groups = useMemo(() => {
    const map = new Map<number, ActivityItem[]>();
    for (const x of shown) {
      const k = startOfDay(new Date(x.at)).getTime();
      map.set(k, [...(map.get(k) ?? []), x]);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [shown]);
  const daySpent = (items: ActivityItem[]) => items.reduce((t, x) => t + (x.kind === "expense" && counts(x.expense) ? share(x.expense) : 0), 0);
  const label = filter === null ? "Expenses" : isKind(filter) ? KIND_CHIPS.find(([f]) => f === filter)![2] : categoryMeta(filter).title;
  const count = filter === null ? all.length : shown.length;

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
        <div className="row gap8">
          <button className="icon-btn" onClick={onSearch} aria-label="Search (/)"><Icon name="search" size={20} /></button>
          <ProfileButton />
        </div>
      </header>

      <div className="activity-bar card">
        <div className="month-switch">
          <button className="icon-btn" onClick={() => setOffset((o) => o - 1)} aria-label="Previous month"><Icon name="back" size={18} /></button>
          <span className="t-strong">{monthLabel(monthDate, undefined, true)}</span>
          <button className="icon-btn" onClick={() => setOffset((o) => o + 1)} disabled={isCurrent} aria-label="Next month"><Icon name="next" size={18} /></button>
        </div>
        <dl className="activity-sum">
          <div><dt>Spent</dt><dd className="num">{formatMoney(spent)}</dd></div>
          {!cat && <div><dt>Received</dt><dd className="num in">{received ? `+${formatMoney(received)}` : "—"}</dd></div>}
          <div><dt>{label}</dt><dd className="num">{count}</dd></div>
        </dl>
      </div>

      <div className="row between wrap gap8">
        <div className="view-switch" role="group" aria-label="Show expenses as">
          <button aria-pressed={view === "list"} onClick={() => changeView("list")}><Icon name="inbox" size={16} />List</button>
          <button aria-pressed={view === "calendar"} onClick={() => changeView("calendar")}><Icon name="grid" size={16} />Calendar</button>
        </div>
      </div>
      {view === "list" && used.length + kinds.length > 1 && (
        <div className="chips" role="group" aria-label="Filter">
          <button className={`chip${filter === null ? " on" : ""}`} aria-pressed={filter === null} onClick={() => setFilter(null)}>All</button>
          {kinds.map(([f, , l]) => (
            <button key={f} className={`chip${filter === f ? " on" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(filter === f ? null : f)}>
              <Icon name={f === "@income" ? "download" : f === "@transfer" ? "transfer" : "split"} size={14} />{l}
            </button>
          ))}
          {used.map((c) => (
            <button key={c} className={`chip${filter === c ? " on" : ""}`} aria-pressed={filter === c} onClick={() => setFilter(filter === c ? null : c)}>{categoryMeta(c).title}</button>
          ))}
        </div>
      )}

      {view === "calendar" ? (
        <MonthCalendar month={monthDate} onPrev={() => setOffset((o) => o - 1)}
          onNext={offset < 0 ? () => setOffset((o) => o + 1) : undefined} onPickDay={setPickedDay} />
      ) : groups.length === 0 ? (
        <div className="card">
          <Empty title={filter ? `No ${label.toLowerCase() === "income" ? "income" : label} this month` : isCurrent ? "Nothing logged yet" : "Nothing this month"}
            body="Tap a repeat on Home, press + or N, or type a sentence with Smart add."
            action={isCurrent && !filter ? <button className="btn primary" onClick={() => onAdd()}>Log an expense</button> : undefined} />
        </div>
      ) : (
        groups.map(([day, items]) => (
          <section key={day} className="col gap8">
            <div className="section-title">
              <span>{dayTitle(day)}</span>
              <span className="t-muted num">{daySpent(items) || items.some((x) => x.kind === "expense") ? formatMoney(daySpent(items)) : ""}</span>
            </div>
            <div className="card flush">
              {items.map((x) => x.kind === "expense" ? <SwipeExpense key={x.key} e={x.expense} onOpen={() => onOpen(x.expense)} />
                : x.kind === "income" ? (
                  <button key={x.key} className="row-btn" onClick={() => setIncomeEdit({ income: x.income, day: new Date(x.at) })} aria-label={`Edit income ${x.income.source || ""}`}>
                    <IncomeRowView x={x.income} />
                  </button>
                ) : (
                  <button key={x.key} className="row-btn" onClick={() => setMoving(x)}><MoveRowView item={x} /></button>
                ))}
            </div>
          </section>
        ))
      )}
      {view === "list" && groups.length > 0 && shown.some((x) => x.kind === "expense") && <p className="t-muted tiny" style={{ textAlign: "center", margin: 0 }}>Swipe an expense left to edit or delete, right to split or repeat</p>}

      <DaySheet day={pickedDay} onClose={() => setPickedDay(null)} onOpenExpense={onOpen} onAddExpense={(day) => onAdd(day)}
        onEditIncome={setIncomeEdit} />
      <IncomeEditor value={incomeEdit} onClose={() => setIncomeEdit(null)} />
      <MoveSheet item={moving} onClose={() => setMoving(null)} />
    </div>
  );
}

export function greeting(h: number) {
  return t(h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");
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
      <Field label={`Amount (${currencySymbol()})`}><input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="180" /></Field>
      <Field label="Category">
        <CategorySelect label="Category" value={category} onChange={setCategory} />
      </Field>
      <button className="btn primary block" disabled={!title || !paise} onClick={() => {
        saveChip({ id: chip?.id ?? uid(), title, amount: paise!, category, order: chip?.order ?? s.chips.length });
        onClose();
      }}>Save</button>
      {chip && <button className="btn danger block" onClick={() => { deleteChip(chip.id); onClose(); }}>Remove this repeat</button>}
    </Sheet>
  );
}
