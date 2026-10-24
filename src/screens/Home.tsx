import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  addExpense, budgetSnapshot, counts, deleteChip, deleteExpense, expenseTitle, inMonth, makeRecurring, saveChip, share,
  showToast, uid, updateExpense, useTally, type Chip, type Expense,
} from "../data/store";
import { addMonths, sameDay, snapshot, startOfDay } from "../core/budget";
import { formatMoney, parsePaise } from "../core/money";
import { CATEGORIES, CATEGORY_META, type Category } from "../core/categories";
import { CategoryIcon, Icon } from "../ui/icons";
import { Empty, Field, Sheet, SwipeRow, useLongPress } from "../ui/components";

export function ExpenseRowView({ e }: { e: Expense }) {
  const time = new Date(e.occurredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <div className="expense-row">
      <CategoryIcon category={e.category} />
      <div className="grow col gap4">
        <span className="t-strong ellipsis">{expenseTitle(e)}</span>
        <span className="t-muted tiny ellipsis">
          {CATEGORY_META[e.category].title} · {e.account} · {time}{e.exclude ? " · not in budget" : ""}
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

function ChipButton({ chip, onEdit }: { chip: Chip; onEdit: (c: Chip) => void }) {
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

export function Home({ onOpen, onAdd, onSearch, onRecap, onInbox, onSettings }: {
  onOpen: (e: Expense) => void; onAdd: () => void; onSearch: () => void; onRecap: () => void; onInbox: () => void; onSettings: () => void;
}) {
  const s = useTally();
  const [offset, setOffset] = useState(0);
  const [chipMenu, setChipMenu] = useState<Chip | null>(null);
  const [newChip, setNewChip] = useState(false);
  const [pull, setPull] = useState(0);
  const pullStart = useRef<number | null>(null);
  const heroStart = useRef<{ x: number; y: number } | null>(null);
  const heroSwiped = useRef(false);

  const now = new Date();
  const monthDate = addMonths(now, offset);
  const isCurrent = offset === 0;

  const month = useMemo(() => inMonth(s.expenses, monthDate).filter((e) => !e.pending), [s.expenses, offset]);
  const snap = useMemo(() => {
    if (isCurrent) return budgetSnapshot(s, now);
    const spent = month.filter(counts).reduce((t, e) => t + share(e), 0);
    return snapshot(s.settings.monthlyBudget, spent, 0, new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0));
  }, [s, month, offset]);
  const pending = s.expenses.filter((e) => e.pending).length;

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

  // Hero: swipe sideways to change month, tap for recap.
  const heroDown = (e: RPointerEvent) => { heroStart.current = { x: e.clientX, y: e.clientY }; heroSwiped.current = false; };
  const heroUp = (e: RPointerEvent) => {
    const st = heroStart.current;
    heroStart.current = null;
    if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      heroSwiped.current = true;
      setOffset((o) => (dx < 0 ? Math.min(o + 1, 0) : o - 1));
    } else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      onRecap();
    }
  };

  // Pull down at the top of the page to search.
  const touchStart = (e: React.TouchEvent) => { pullStart.current = window.scrollY <= 0 ? e.touches[0].clientY : null; };
  const touchMove = (e: React.TouchEvent) => {
    if (pullStart.current === null) return;
    setPull(Math.max(0, Math.min(e.touches[0].clientY - pullStart.current, 120)));
  };
  const touchEnd = () => { if (pull > 80) onSearch(); setPull(0); pullStart.current = null; };

  const hour = now.getHours();
  const loggedToday = s.expenses.some((e) => !e.pending && sameDay(new Date(e.occurredAt), now));

  return (
    <div className="page" onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd}
      style={{ transform: pull ? `translateY(${pull / 2}px)` : undefined }}>
      {pull > 0 && <div className="pull-hint" style={{ opacity: Math.min(pull / 80, 1) }}>{pull > 80 ? "Release to search" : "Pull to search"}</div>}
      <header className="page-head">
        <div className="col">
          <span className="t-muted small">{greeting(hour)}</span>
          <h1 className="display">{monthDate.toLocaleDateString([], { month: "long", year: "numeric" })}</h1>
        </div>
        <div className="row gap8">
          <button className="icon-btn" onClick={onSearch} aria-label="Search (/)"><Icon name="search" size={20} /></button>
          <button className="icon-btn" onClick={onSettings} aria-label="Settings"><Icon name="gear" size={20} /></button>
        </div>
      </header>

      <section className="hero" onPointerDown={heroDown} onPointerUp={heroUp} aria-label="Monthly summary. Swipe sideways to change month, tap for recap"
        role="button" tabIndex={0} onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setOffset((o) => o - 1);
          if (e.key === "ArrowRight") setOffset((o) => Math.min(o + 1, 0));
          if (e.key === "Enter") onRecap();
        }}>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div className="col gap4">
            <span className="label">Spent {isCurrent ? "this month" : "in " + monthDate.toLocaleDateString([], { month: "long" })}</span>
            <span className="amount display num">{formatMoney(snap.spent)}</span>
          </div>
          {snap.hasBudget && <span className="pill num">of {formatMoney(snap.budget)}</span>}
        </div>
        {snap.hasBudget ? (
          <>
            <div className="progress"><div style={{ width: `${Math.min(snap.fractionUsed, 1) * 100}%`, background: snap.isOver ? "#FF8A7A" : "var(--hero-bar)" }} /></div>
            <div className="stats">
              <div className="col"><span>{snap.left >= 0 ? "Left" : "Over"}</span><span className="num">{formatMoney(Math.abs(snap.left))}</span></div>
              {isCurrent && <div className="col"><span>Safe today</span><span className="num">{formatMoney(snap.leftToday)}</span></div>}
              {isCurrent && <div className="col"><span>Days left</span><span className="num">{snap.daysLeft}</span></div>}
            </div>
          </>
        ) : (
          <button className="btn" onClick={(e) => { e.stopPropagation(); onSettings(); }} onPointerUp={(e) => e.stopPropagation()}>Set a monthly budget</button>
        )}
        <span className="tiny" style={{ color: "var(--hero-muted)" }}>
          {isCurrent ? "Swipe sideways for past months · tap for recap" : "Swipe left to come back to this month"}
        </span>
      </section>

      <section className="col gap8">
        <div className="section-title"><span>One-tap repeats</span><span className="t-muted">Hold to edit</span></div>
        <div className="chips">
          {s.chips.map((c) => <ChipButton key={c.id} chip={c} onEdit={setChipMenu} />)}
          <button className="chip dashed" onClick={() => setNewChip(true)}>+ Pin</button>
        </div>
      </section>

      {pending > 0 && (
        <button className="banner" onClick={onInbox}>
          <Icon name="inbox" size={20} />
          <span className="grow">{pending} captured payment{pending === 1 ? "" : "s"} to review</span>
          <Icon name="next" size={16} />
        </button>
      )}
      {isCurrent && !loggedToday && hour >= 19 && month.length > 0 && (
        <button className="banner" style={{ background: "var(--accent-soft)", color: "var(--accent)" }} onClick={onAdd}>
          <Icon name="plus" size={20} /><span className="grow">Anything to log for today?</span>
        </button>
      )}

      {groups.length === 0 ? (
        <div className="card">
          <Empty title={isCurrent ? "Nothing logged yet" : "No expenses this month"}
            body="Tap a repeat above, press + or N, or type a sentence with Smart add."
            action={isCurrent ? <button className="btn primary" onClick={onAdd}>Log an expense</button> : undefined} />
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
      {groups.length > 0 && <p className="t-muted tiny" style={{ textAlign: "center", margin: 0 }}>Swipe a row left to edit or delete, right to split or repeat</p>}

      <ChipEditor chip={chipMenu} open={chipMenu !== null || newChip} onClose={() => { setChipMenu(null); setNewChip(false); }} />
    </div>
  );
}

function greeting(h: number) {
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function ChipEditor({ chip, open, onClose }: { chip: Chip | null; open: boolean; onClose: () => void }) {
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
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].title}</option>)}
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
