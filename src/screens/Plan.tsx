import { useMemo, useState } from "react";
import {
  counts, deleteBill, deleteBudget, deleteGoal, deleteRecurringIncome, inMonth, logBill, logRecurringIncome, monthSpent, nextDue,
  runDueBills, runDueIncome, saveBill, saveBudget, saveGoal, saveRecurringIncome, share, showToast, uid, useTally,
  type Bill, type Goal, type RecurringIncome,
} from "../data/store";
import { categoryMeta, pickableCategories, type Category } from "../core/categories";
import { monthKey } from "../core/budget";
import { formatMoney, parsePaise } from "../core/money";
import { Icon } from "../ui/icons";
import { Empty, Field, Progress, Sheet, Toggle } from "../ui/components";

export function Plan() {
  const s = useTally();
  const now = new Date();
  const [budgetCat, setBudgetCat] = useState<Category | null>(null);
  const [bill, setBill] = useState<Bill | "new" | null>(null);
  const [goal, setGoal] = useState<Goal | "new" | null>(null);
  const [regular, setRegular] = useState<RecurringIncome | "new" | null>(null);

  const spentByCat = useMemo(() => {
    const m = new Map<Category, number>();
    for (const e of inMonth(s.expenses, now).filter(counts)) m.set(e.category, (m.get(e.category) ?? 0) + share(e));
    return m;
  }, [s.expenses]); // eslint-disable-line react-hooks/exhaustive-deps

  const upcoming = [...s.bills].sort((a, b) => nextDue(a).getTime() - nextDue(b).getTime());
  const subsMonthly = s.bills.filter((b) => b.isSubscription).reduce((t, b) => t + b.amount, 0);
  const due14 = upcoming.filter((b) => nextDue(b).getTime() - now.getTime() < 14 * 86_400_000).reduce((t, b) => t + b.amount, 0);
  const overall = s.settings.monthlyBudget;
  const spent = monthSpent(s.expenses, now);
  const unbudgeted = pickableCategories().filter((c) => !s.budgets.some((b) => b.category === c));

  return (
    <div className="page wide">
      <header className="page-head">
        <h1 className="display">Plan</h1>
        <span className="t-muted small">{now.toLocaleDateString([], { month: "long" })}</span>
      </header>

      <section className="col gap8">
        <div className="section-title"><span>Budgets</span></div>
        <div className="card col gap16">
          {overall > 0 && (
            <BudgetLine label="Overall" spent={spent} limit={overall} />
          )}
          {[...s.budgets].sort((a, b) => a.category.localeCompare(b.category)).map((b) => (
            <button key={b.category} onClick={() => setBudgetCat(b.category)} style={{ border: 0, background: "none", padding: 0, textAlign: "left" }}>
              <BudgetLine label={categoryMeta(b.category).title} spent={spentByCat.get(b.category) ?? 0} limit={b.limit} />
            </button>
          ))}
          {unbudgeted.length > 0 && (
            <label className="field">
              <span className="t-muted">Add a category budget</span>
              <select value="" onChange={(e) => e.target.value && setBudgetCat(e.target.value as Category)}>
                <option value="">Choose a category…</option>
                {unbudgeted.map((c) => <option key={c} value={c}>{categoryMeta(c).title}</option>)}
              </select>
            </label>
          )}
        </div>
      </section>

      <section className="col gap8">
        <div className="section-title">
          <span>Bills & subscriptions</span>
          {due14 > 0 && <span className="t-muted num">{formatMoney(due14)} due in 14 days</span>}
        </div>
        <div className="card flush divided">
          {upcoming.length === 0 && <Empty title="No bills yet" body="Add rent, recharges and subscriptions. Tally shows what's due next and can log them on the due day." />}
          {upcoming.map((b) => {
            const due = nextDue(b);
            const soon = due.getTime() - now.getTime() < 3 * 86_400_000;
            return (
              <button key={b.id} className="list-row" style={{ width: "100%", border: 0, background: "none", textAlign: "left" }} onClick={() => setBill(b)}>
                <span className="col" style={{ width: 46, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center",
                  background: soon ? "var(--warn-soft)" : "var(--fill)", color: soon ? "var(--warn)" : undefined, flexShrink: 0 }}>
                  <strong style={{ fontSize: 15 }}>{due.getDate()}</strong>
                  <span className="tiny">{due.toLocaleDateString([], { month: "short" })}</span>
                </span>
                <span className="grow col">
                  <span className="t-strong ellipsis">{b.name}</span>
                  <span className="tiny t-muted">
                    {b.isSubscription ? "Subscription" : "Bill"}
                    {b.lastLoggedMonth === monthKey(now) ? " · paid this month" : b.day <= now.getDate() ? " · not in expenses yet" : b.autoLog ? " · adds on due day" : ""}
                    {b.amount > b.prevAmount && b.prevAmount > 0 && <span style={{ color: "var(--warn)" }}> · price up from {formatMoney(b.prevAmount)}</span>}
                  </span>
                </span>
                <span className="t-strong num">{formatMoney(b.amount)}</span>
              </button>
            );
          })}
          <button className="list-row btn ghost" style={{ width: "100%", borderRadius: 0, justifyContent: "flex-start" }} onClick={() => setBill("new")}>
            <Icon name="plus" size={18} /> Add bill or subscription
          </button>
        </div>
        {subsMonthly > 0 && (
          <p className="t-muted tiny" style={{ margin: "0 4px" }}>
            Subscriptions cost {formatMoney(subsMonthly)} a month — {formatMoney(subsMonthly * 12)} a year.
          </p>
        )}
      </section>

      <section className="col gap8">
        <div className="section-title">
          <span>Regular income</span>
          {s.recurringIncomes.length > 0 && (
            <span className="t-muted num">{formatMoney(s.recurringIncomes.reduce((t, r) => t + r.amount, 0))} a month</span>
          )}
        </div>
        <div className="card flush divided">
          {s.recurringIncomes.length === 0 && (
            <Empty title="No regular income yet" body="Add your salary or anything that arrives every month. Tally adds it to your income on that day." />
          )}
          {s.recurringIncomes.map((r) => (
            <button key={r.id} className="list-row" style={{ width: "100%", border: 0, background: "none", textAlign: "left" }} onClick={() => setRegular(r)}>
              <span className="cat-icon income-icon" style={{ width: 40, height: 40 }}><Icon name="download" size={20} /></span>
              <span className="grow col">
                <span className="t-strong ellipsis">{r.source || "Income"}</span>
                <span className="tiny t-muted">
                  On the {ordinal(r.day)}
                  {r.lastLoggedMonth === monthKey(now) ? " · received this month" : r.day <= now.getDate() ? " · not in income yet" : r.autoLog ? " · adds on the day" : ""}
                </span>
              </span>
              <span className="t-strong num in">+{formatMoney(r.amount)}</span>
            </button>
          ))}
          <button className="list-row btn ghost" style={{ width: "100%", borderRadius: 0, justifyContent: "flex-start" }} onClick={() => setRegular("new")}>
            <Icon name="plus" size={18} /> Add regular income
          </button>
        </div>
      </section>

      <section className="col gap8">
        <div className="section-title"><span>Goals</span><button className="btn ghost" onClick={() => setGoal("new")}>+ New goal</button></div>
        <div className="card col gap16">
          {s.goals.length === 0 && <Empty title="No goals yet" body="Emergency fund, a trip, a new laptop — set a target and track it." />}
          {s.goals.map((g) => {
            const monthsLeft = g.deadline ? Math.max(1, Math.round((g.deadline - now.getTime()) / (30.4 * 86_400_000))) : null;
            return (
              <button key={g.id} onClick={() => setGoal(g)} className="col gap8" style={{ border: 0, background: "none", padding: 0, textAlign: "left" }}>
                <div className="row between small">
                  <span className="t-strong">{g.name}</span>
                  <span className="t-muted num">{formatMoney(g.saved)} / {formatMoney(g.target)}</span>
                </div>
                <Progress value={g.target ? g.saved / g.target : 0} tone="good" />
                {monthsLeft && g.saved < g.target && (
                  <span className="tiny t-muted">Save {formatMoney(Math.ceil((g.target - g.saved) / monthsLeft))}/month to reach it by {new Date(g.deadline!).toLocaleDateString([], { month: "short", year: "numeric" })}</span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <BudgetEditor category={budgetCat} onClose={() => setBudgetCat(null)} />
      <BillEditor value={bill} onClose={() => setBill(null)} />
      <GoalEditor value={goal} onClose={() => setGoal(null)} />
      <RegularIncomeEditor value={regular} onClose={() => setRegular(null)} />
    </div>
  );
}

function BudgetLine({ label, spent, limit }: { label: string; spent: number; limit: number }) {
  const f = limit ? spent / limit : 0;
  return (
    <div className="col gap4" style={{ width: "100%" }}>
      <div className="row between small">
        <span className="t-strong">{label}</span>
        <span className="num" style={{ color: f > 1 ? "var(--danger)" : "var(--muted)", fontWeight: f > 1 ? 600 : 400 }}>
          {formatMoney(spent)} / {formatMoney(limit)}{f > 1 ? " · over" : ""}
        </span>
      </div>
      <Progress value={f} tone={f > 1 ? "over" : f > 0.8 ? "warn" : "ok"} />
    </div>
  );
}

function BudgetEditor({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const s = useTally();
  const existing = s.budgets.find((b) => b.category === category);
  const [amount, setAmount] = useState("");
  const [seen, setSeen] = useState<Category | null>(null);
  if (category !== seen) { setSeen(category); setAmount(existing ? String(existing.limit / 100) : ""); }
  const p = parsePaise(amount);
  return (
    <Sheet open={!!category} onClose={onClose} title={category ? `${categoryMeta(category).title} budget` : ""}>
      <Field label="Monthly limit (₹)"><input type="text" inputMode="numeric" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <button className="btn primary block" disabled={!p} onClick={() => { saveBudget({ category: category!, limit: p! }); onClose(); }}>Save</button>
      {existing && <button className="btn danger block" onClick={() => { deleteBudget(category!); onClose(); }}>Remove budget</button>}
    </Sheet>
  );
}

function BillEditor({ value, onClose }: { value: Bill | "new" | null; onClose: () => void }) {
  const bill = value && value !== "new" ? value : null;
  const [f, setF] = useState({ name: "", amount: "", day: 1, category: "bills" as Category, isSubscription: false, autoLog: true, logNow: true });
  const [seen, setSeen] = useState<typeof value>(null);
  if (value !== seen) {
    setSeen(value);
    setF(bill ? { name: bill.name, amount: String(bill.amount / 100), day: bill.day, category: bill.category, isSubscription: bill.isSubscription, autoLog: bill.autoLog, logNow: false }
      : { name: "", amount: "", day: new Date().getDate() > 28 ? 1 : new Date().getDate(), category: "bills", isSubscription: false, autoLog: true, logNow: true });
  }
  const p = parsePaise(f.amount);
  const now = new Date();
  const monthName = now.toLocaleDateString([], { month: "long" });
  const loggedThisMonth = bill?.lastLoggedMonth === monthKey(now);
  // A new bill whose due day has already come this month: offer to log this month's payment too.
  const askLogNow = !bill && f.day <= now.getDate();
  const save = () => {
    if (!p) return;
    const saved: Bill = {
      id: bill?.id ?? uid(), name: f.name, amount: p, prevAmount: bill ? (p !== bill.amount ? bill.amount : bill.prevAmount) : p,
      day: f.day, category: f.category, account: bill?.account ?? "UPI", isSubscription: f.isSubscription, autoLog: f.autoLog,
      // A new bill already due this month counts as paid unless "log now" is on; then it's logged below.
      lastLoggedMonth: bill?.lastLoggedMonth ?? (askLogNow && !f.logNow ? monthKey(now) : ""),
    };
    saveBill(saved);
    if (askLogNow && f.logNow) {
      logBill(saved, now);
      showToast(`Logged ${saved.name} · ${formatMoney(saved.amount)} for ${monthName}`);
    } else {
      runDueBills(now);
    }
    onClose();
  };
  return (
    <Sheet open={value !== null} onClose={onClose} title={bill ? "Edit bill" : "New bill or subscription"}>
      <Field label="Name"><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Rent, Netflix, Airtel…" /></Field>
      <div className="row gap8">
        <Field label="Amount (₹)"><input type="text" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Due day">
          <select value={f.day} onChange={(e) => setF({ ...f, day: Number(e.target.value) })}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Category">
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Category })}>
          {pickableCategories(f.category).map((c) => <option key={c} value={c}>{categoryMeta(c).title}</option>)}
        </select>
      </Field>
      <div>
        <Toggle label="Subscription" checked={f.isSubscription} onChange={(v) => setF({ ...f, isSubscription: v })} />
        <Toggle label="Add to expenses on the due day" hint="Each month, on or after the due day, it's added to that month's spending" checked={f.autoLog} onChange={(v) => setF({ ...f, autoLog: v })} />
        {askLogNow && (
          <Toggle label={`Add ${monthName}'s payment now`} hint={`The due day has already come this month`} checked={f.logNow} onChange={(v) => setF({ ...f, logNow: v })} />
        )}
      </div>
      {bill && (loggedThisMonth
        ? <p className="t-muted small" style={{ margin: 0 }}><Icon name="check" size={14} /> {monthName}'s payment is in your expenses.</p>
        : (
          <button className="btn block" onClick={() => {
            logBill(bill, now);
            showToast(`Logged ${bill.name} · ${formatMoney(bill.amount)} for ${monthName}`);
            onClose();
          }}>Add {monthName}'s payment to expenses</button>
        ))}
      <button className="btn primary block" disabled={!f.name || !p} onClick={save}>Save</button>
      {bill && <button className="btn danger block" onClick={() => { deleteBill(bill.id); onClose(); }}>Delete</button>}
    </Sheet>
  );
}

function GoalEditor({ value, onClose }: { value: Goal | "new" | null; onClose: () => void }) {
  const goal = value && value !== "new" ? value : null;
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [add, setAdd] = useState("");
  const [seen, setSeen] = useState<typeof value>(null);
  if (value !== seen) {
    setSeen(value);
    setName(goal?.name ?? ""); setTarget(goal ? String(goal.target / 100) : "");
    setDeadline(goal?.deadline ? new Date(goal.deadline).toISOString().slice(0, 10) : ""); setAdd("");
  }
  const t = parsePaise(target);
  return (
    <Sheet open={value !== null} onClose={onClose} title={goal ? goal.name : "New goal"}>
      {goal && (
        <div className="card col gap8" style={{ background: "var(--surface-2)" }}>
          <span className="small">Saved {formatMoney(goal.saved)} of {formatMoney(goal.target)}</span>
          <div className="row gap8">
            <input type="text" inputMode="decimal" placeholder="Add ₹" aria-label="Amount to add" value={add} onChange={(e) => setAdd(e.target.value)} />
            <button className="btn primary" disabled={!parsePaise(add)} onClick={() => { saveGoal({ ...goal, saved: goal.saved + parsePaise(add)! }); setAdd(""); onClose(); }}>Add</button>
          </div>
        </div>
      )}
      <Field label="Goal"><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Emergency fund" /></Field>
      <Field label="Target (₹)"><input type="text" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
      <Field label="Deadline (optional)"><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
      <button className="btn primary block" disabled={!name || !t} onClick={() => {
        saveGoal({ id: goal?.id ?? uid(), name, target: t!, saved: goal?.saved ?? 0, deadline: deadline ? new Date(deadline + "T12:00").getTime() : null });
        onClose();
      }}>Save goal</button>
      {goal && <button className="btn danger block" onClick={() => { deleteGoal(goal.id); onClose(); }}>Delete goal</button>}
    </Sheet>
  );
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const INCOME_SOURCES = ["Salary", "Freelance", "Rent received", "Interest", "Pension", "Other"];

function RegularIncomeEditor({ value, onClose }: { value: RecurringIncome | "new" | null; onClose: () => void }) {
  const s = useTally();
  const rule = value && value !== "new" ? value : null;
  const [f, setF] = useState({ source: "Salary", amount: "", day: 1, account: "", note: "", autoLog: true, logNow: true });
  const [seen, setSeen] = useState<typeof value>(null);
  if (value !== seen) {
    setSeen(value);
    const bank = s.accounts.find((a) => a.kind === "bank")?.name ?? "Bank";
    setF(rule
      ? { source: rule.source, amount: String(rule.amount / 100), day: rule.day, account: rule.account, note: rule.note, autoLog: rule.autoLog, logNow: false }
      : { source: "Salary", amount: "", day: Math.min(new Date().getDate(), 28), account: bank, note: "", autoLog: true, logNow: true });
  }
  const p = parsePaise(f.amount);
  const now = new Date();
  const monthName = now.toLocaleDateString([], { month: "long" });
  const receivedThisMonth = rule?.lastLoggedMonth === monthKey(now);
  // A new regular income whose day has already come this month: offer to add this month's too.
  const askLogNow = !rule && f.day <= now.getDate();
  const save = () => {
    if (!p) return;
    const saved: RecurringIncome = {
      id: rule?.id ?? uid(), source: f.source.trim(), amount: p, day: f.day, account: f.account.trim(), note: f.note.trim(), autoLog: f.autoLog,
      lastLoggedMonth: rule?.lastLoggedMonth ?? (askLogNow && !f.logNow ? monthKey(now) : ""),
    };
    saveRecurringIncome(saved);
    if (askLogNow && f.logNow) {
      logRecurringIncome(saved, now);
      showToast(`Added ${saved.source || "income"} · ${formatMoney(saved.amount)} for ${monthName}`);
    } else {
      runDueIncome(now);
    }
    onClose();
  };
  return (
    <Sheet open={value !== null} onClose={onClose} title={rule ? "Edit regular income" : "New regular income"}>
      <div className="col gap8">
        <span className="small t-strong">From</span>
        <div className="row gap8 wrap">
          {INCOME_SOURCES.map((x) => (
            <button key={x} className={`chip${f.source === x ? " on" : ""}`} aria-pressed={f.source === x} onClick={() => setF({ ...f, source: x })}>{x}</button>
          ))}
        </div>
        <input type="text" aria-label="Source" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="Employer, client or reason" />
      </div>
      <div className="row gap8">
        <Field label="Amount (₹)"><input type="text" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="120000" /></Field>
        <Field label="Arrives on">
          <select value={f.day} onChange={(e) => setF({ ...f, day: Number(e.target.value) })}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{ordinal(d)}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Received in"><input type="text" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })} /></Field>
      <div>
        <Toggle label="Add to income on that day" hint="Each month, on or after the day, it's added to that month's income" checked={f.autoLog} onChange={(v) => setF({ ...f, autoLog: v })} />
        {askLogNow && (
          <Toggle label={`Add ${monthName}'s now`} hint="The day has already come this month" checked={f.logNow} onChange={(v) => setF({ ...f, logNow: v })} />
        )}
      </div>
      {rule && (receivedThisMonth
        ? <p className="t-muted small" style={{ margin: 0 }}><Icon name="check" size={14} /> {monthName}'s is in your income.</p>
        : (
          <button className="btn block" onClick={() => {
            logRecurringIncome(rule, now);
            showToast(`Added ${rule.source || "income"} · ${formatMoney(rule.amount)} for ${monthName}`);
            onClose();
          }}>Add {monthName}'s to income</button>
        ))}
      <button className="btn primary block" disabled={!p || !f.source.trim()} onClick={save}>Save</button>
      {rule && (
        <button className="btn danger block" onClick={() => { deleteRecurringIncome(rule.id); onClose(); }}>
          Stop this regular income
        </button>
      )}
      {rule && <p className="t-muted tiny" style={{ margin: 0 }}>Stopping it keeps the income already added.</p>}
    </Sheet>
  );
}
