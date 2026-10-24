import { useMemo, useState } from "react";
import {
  counts, deleteIncome, expenseTitle, saveIncome, share, uid, useTally, type Expense, type Income,
} from "../data/store";
import { monthRange, sameDay, startOfDay } from "../core/budget";
import { compactMoney, formatMoney, parsePaise } from "../core/money";
import { Icon } from "../ui/icons";
import { Empty, Field, Sheet } from "../ui/components";
import { ExpenseRowView } from "./Home";

/** Spent and received per day of the month. Index 0 is the 1st. */
function dayTotals(expenses: Expense[], incomes: Income[], month: Date) {
  const [start, end] = monthRange(month);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const spent = Array.from({ length: days }, () => 0);
  const received = Array.from({ length: days }, () => 0);
  const entries = Array.from({ length: days }, () => 0);
  const inMonth = (t: number) => t >= start.getTime() && t < end.getTime();
  for (const e of expenses) {
    if (e.pending || !inMonth(e.occurredAt)) continue;
    const i = new Date(e.occurredAt).getDate() - 1;
    entries[i]++;
    if (counts(e)) spent[i] += share(e);
  }
  for (const x of incomes) {
    if (!inMonth(x.receivedAt)) continue;
    const i = new Date(x.receivedAt).getDate() - 1;
    entries[i]++;
    received[i] += x.amount;
  }
  return { days, spent, received, entries };
}

const fullDate = (d: Date) => d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

/**
 * The month as a calendar: each day shows what went out (−) and what came in (+).
 * Click a day to see and edit everything logged on it.
 */
export function MonthCalendar({ month, onPrev, onNext, onPickDay }: {
  month: Date; onPrev: () => void; onNext?: () => void; onPickDay: (day: Date) => void;
}) {
  const s = useTally();
  const now = new Date();
  const t = useMemo(() => dayTotals(s.expenses, s.incomes, month), [s.expenses, s.incomes, month.getFullYear(), month.getMonth()]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalSpent = t.spent.reduce((a, b) => a + b, 0);
  const totalIn = t.received.reduce((a, b) => a + b, 0);
  const net = totalIn - totalSpent;
  const lead = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const today = startOfDay(now).getTime();

  return (
    <section className="card month-cal" aria-label={`${month.toLocaleDateString([], { month: "long", year: "numeric" })} calendar`}>
      <header className="month-cal-head">
        <button className="icon-btn" onClick={onPrev} aria-label="Previous month"><Icon name="back" size={18} /></button>
        <h2>{month.toLocaleDateString([], { month: "long", year: "numeric" })}</h2>
        <button className="icon-btn" onClick={onNext} disabled={!onNext} aria-label="Next month"><Icon name="next" size={18} /></button>
      </header>
      <dl className="month-cal-sum">
        <div><dt>Spent</dt><dd className="num">{formatMoney(totalSpent)}</dd></div>
        <div><dt>Income</dt><dd className="num in">{totalIn ? `+${formatMoney(totalIn)}` : "—"}</dd></div>
        <div><dt>Net</dt><dd className={`num ${net >= 0 ? "in" : "out"}`}>{totalIn ? formatMoney(net, { signed: true }) : "—"}</dd></div>
      </dl>

      <div className="month-grid" role="grid" aria-label="Days">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className="month-dow" aria-hidden="true">{d.slice(0, 1)}<span className="dow-rest">{d.slice(1)}</span></span>
        ))}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} aria-hidden="true" />)}
        {t.spent.map((spent, i) => {
          const day = new Date(month.getFullYear(), month.getMonth(), i + 1);
          const future = day.getTime() > today;
          const isToday = day.getTime() === today;
          const received = t.received[i];
          const label = `${fullDate(day)}: ${spent ? `spent ${formatMoney(spent)}` : "nothing spent"}${received ? `, received ${formatMoney(received)}` : ""}`;
          return (
            <button key={i} className={`month-day${isToday ? " today" : ""}${future ? " future" : ""}${t.entries[i] ? " has" : ""}`}
              disabled={future} onClick={() => onPickDay(day)} aria-label={future ? `${fullDate(day)}: still to come` : label}>
              <span className="month-day-n">{i + 1}</span>
              {spent > 0 && <span className="month-day-out num">−{compactMoney(spent)}</span>}
              {received > 0 && <span className="month-day-in num">+{compactMoney(received)}</span>}
            </button>
          );
        })}
      </div>
      <p className="month-cal-hint">Click a day to see, add or edit what you spent and received.</p>
    </section>
  );
}

/** Everything logged on one day, with buttons to add more. Rows open their editors. */
export function DaySheet({ day, onClose, onOpenExpense, onAddExpense, onEditIncome }: {
  day: Date | null; onClose: () => void; onOpenExpense: (e: Expense) => void; onAddExpense: (day: Date) => void;
  onEditIncome: (value: { income: Income | null; day: Date }) => void;
}) {
  const s = useTally();
  const expenses = day ? s.expenses.filter((e) => !e.pending && sameDay(new Date(e.occurredAt), day)) : [];
  const incomes = day ? s.incomes.filter((x) => sameDay(new Date(x.receivedAt), day)) : [];
  const spent = expenses.filter(counts).reduce((t, e) => t + share(e), 0);
  const received = incomes.reduce((t, x) => t + x.amount, 0);

  return (
    <Sheet open={day !== null} onClose={onClose} title={day ? fullDate(day) : ""}>
      <div className="day-sum">
        <div><span className="t-muted small">Spent</span><strong className="num">{formatMoney(spent)}</strong></div>
        <div><span className="t-muted small">Received</span><strong className="num in">{received ? `+${formatMoney(received)}` : "—"}</strong></div>
      </div>

      <div className="row gap8">
        <button className="btn grow" onClick={() => day && onAddExpense(day)}><Icon name="plus" size={18} />Add expense</button>
        <button className="btn grow" onClick={() => day && onEditIncome({ income: null, day })}><Icon name="plus" size={18} />Add income</button>
      </div>

      {incomes.length > 0 && (
        <section className="col gap8">
          <div className="section-title"><span>Income</span><span className="t-muted num">+{formatMoney(received)}</span></div>
          <div className="card flush divided" style={{ background: "var(--surface-2)" }}>
            {incomes.map((x) => (
              <button key={x.id} className="row-btn" onClick={() => day && onEditIncome({ income: x, day })}>
                <div className="expense-row">
                  <span className="cat-icon income-icon" style={{ width: 40, height: 40 }}><Icon name="download" size={20} /></span>
                  <div className="grow col gap4">
                    <span className="t-strong ellipsis">{x.source || "Income"}</span>
                    <span className="t-muted tiny ellipsis">{[x.account, x.note].filter(Boolean).join(" · ") || "Tap to edit"}</span>
                  </div>
                  <span className="amt num in">+{formatMoney(x.amount, { showPaise: true })}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {expenses.length > 0 && (
        <section className="col gap8">
          <div className="section-title"><span>Expenses</span><span className="t-muted num">−{formatMoney(spent)}</span></div>
          <div className="card flush divided" style={{ background: "var(--surface-2)" }}>
            {expenses.map((e) => (
              <button key={e.id} className="row-btn" onClick={() => onOpenExpense(e)} aria-label={`Edit ${expenseTitle(e)}`}>
                <ExpenseRowView e={e} />
              </button>
            ))}
          </div>
        </section>
      )}

      {expenses.length === 0 && incomes.length === 0 && (
        <Empty title="Nothing logged on this day" body="Add an expense or income above. It'll be dated this day." />
      )}
    </Sheet>
  );
}

const SOURCES = ["Salary", "Freelance", "Refund", "Interest", "Gift", "Other"];
const toDateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Add or edit one income entry. */
export function IncomeEditor({ value, onClose }: { value: { income: Income | null; day: Date } | null; onClose: () => void }) {
  const s = useTally();
  const existing = value?.income ?? null;
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("Salary");
  const [account, setAccount] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [seen, setSeen] = useState<typeof value>(null);
  if (value !== seen) {
    setSeen(value);
    if (value) {
      setAmount(existing ? String(existing.amount / 100) : "");
      setSource(existing?.source ?? "Salary");
      setAccount(existing?.account ?? s.accounts.find((a) => a.kind === "bank")?.name ?? "Bank");
      setDate(toDateInput(existing ? new Date(existing.receivedAt) : value.day));
      setNote(existing?.note ?? "");
    }
  }
  const paise = parsePaise(amount);
  const accounts = [...new Set(["Bank", "UPI", "Cash", ...s.accounts.map((a) => a.name)])];

  const save = () => {
    if (!paise || !value) return;
    const [y, m, d] = date.split("-").map(Number);
    // Keep the original time when only other fields changed; otherwise noon on the chosen day.
    const keep = existing && toDateInput(new Date(existing.receivedAt)) === date;
    saveIncome({
      id: existing?.id ?? uid(), amount: paise, source: source.trim(), note: note.trim(), account: account.trim(),
      receivedAt: keep ? existing.receivedAt : new Date(y, m - 1, d, 12).getTime(), createdAt: existing?.createdAt ?? Date.now(),
    });
    onClose();
  };

  return (
    <Sheet open={value !== null} onClose={onClose} title={existing ? "Edit income" : "Add income"}>
      <Field label="Amount (₹)">
        <input type="text" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50000"
          className="display" style={{ fontSize: 24, minHeight: 56 }} />
      </Field>
      <div className="col gap8">
        <span className="small t-strong">From</span>
        <div className="row gap8 wrap">
          {SOURCES.map((x) => (
            <button key={x} className={`chip${source === x ? " on" : ""}`} aria-pressed={source === x} onClick={() => setSource(x)}>{x}</button>
          ))}
        </div>
        <input type="text" aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Employer, client or reason" />
      </div>
      <div className="row gap8">
        <Field label="Received in">
          <input type="text" list="income-accounts" value={account} onChange={(e) => setAccount(e.target.value)} />
          <datalist id="income-accounts">{accounts.map((a) => <option key={a} value={a} />)}</datalist>
        </Field>
        <Field label="Date">
          <input type="date" value={date} max={toDateInput(new Date())} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Note"><input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
      <button className="btn primary block" disabled={!paise || !date} onClick={save}>{existing ? "Save changes" : "Add income"}</button>
      {existing && (
        <button className="btn danger block" onClick={() => { deleteIncome(existing.id); onClose(); }}>Delete this income</button>
      )}
    </Sheet>
  );
}
