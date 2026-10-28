import { useMemo, useState, type ReactNode } from "react";
import {
  backupOverdueDays, budgetSnapshot, counts, inMonth, monthSpent, nextDue, recurringSuggestions, share, useTally, type Chip, type Expense,
} from "../data/store";
import { daysInMonth, monthRange } from "../core/budget";
import { categoryMeta } from "../core/categories";
import { insights } from "../core/analytics";
import { netWorthSeries, savingsRate } from "../core/reports";
import { formatMoney } from "../core/money";
import { Icon } from "../ui/icons";
import { Progress } from "../ui/components";
import { Sparkline } from "../ui/charts";
import { TallyMarks } from "../ui/tally";
import { ChipButton, ChipEditor, ExpenseRowView, greeting } from "./Activity";

export type Destination = "activity" | "reports" | "plan" | "accounts";

/** Home: today's number first, then this month at a glance. Each card leads to the screen with the detail. */
export function Home({ onOpen, onAdd, onSearch, onRecap, onInbox, onSettings, go }: {
  onOpen: (e: Expense) => void; onAdd: (day?: Date) => void; onSearch: () => void; onRecap: () => void; onInbox: () => void;
  onSettings: () => void; go: (to: Destination) => void;
}) {
  const s = useTally();
  const [chipMenu, setChipMenu] = useState<Chip | null>(null);
  const [newChip, setNewChip] = useState(false);
  const now = new Date();
  const snap = budgetSnapshot(s, now);
  const days = daysInMonth(now);
  const [start, end] = monthRange(now);

  const month = useMemo(() => inMonth(s.expenses, now).filter((e) => !e.pending), [s.expenses]); // eslint-disable-line react-hooks/exhaustive-deps
  const received = s.incomes.filter((x) => x.receivedAt >= start.getTime() && x.receivedAt < end.getTime()).reduce((t, x) => t + x.amount, 0);
  const income = received || s.settings.monthlyIncome;
  const rate = savingsRate(income, snap.spent);
  const recent = s.expenses.filter((e) => !e.pending).slice(0, 5);
  const found = useMemo(() => recurringSuggestions(s, now.getTime()), [s.expenses, s.bills, s.settings.dismissedRecurring]); // eslint-disable-line react-hooks/exhaustive-deps
  const note = useMemo(() => insights(s.expenses, now, now, s.settings.monthlyBudget, s.budgets)[0], [s.expenses, s.budgets, s.settings.monthlyBudget]); // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => netWorthSeries(s.accounts, now, 6), [s.accounts]); // eslint-disable-line react-hooks/exhaustive-deps
  const netWorth = series[series.length - 1]?.net ?? 0;

  // Bills and found subscriptions due in the next 14 days.
  const horizon = now.getTime() + 14 * 86_400_000;
  const upcoming = [
    ...s.bills.map((b) => ({ key: b.id, name: b.name, amount: b.amount, at: nextDue(b, now).getTime(), category: b.category, found: false })),
    ...found.filter((r) => !r.maybeStopped).map((r) => ({ key: r.key, name: r.name, amount: r.amount, at: r.nextAt, category: r.category, found: true })),
  ].filter((u) => u.at <= horizon).sort((a, b) => a.at - b.at);
  const upcomingTotal = upcoming.reduce((t, u) => t + u.amount, 0);

  const budgets = [...s.budgets].map((b) => {
    const spent = month.filter((e) => counts(e) && e.category === b.category).reduce((t, e) => t + share(e), 0);
    return { ...b, spent, f: b.limit ? spent / b.limit : 0 };
  }).sort((a, b) => b.f - a.f).slice(0, 3);

  const pending = s.expenses.filter((e) => e.pending).length;
  const backupDays = backupOverdueDays(s);
  const hour = now.getHours();
  const loggedToday = month.some((e) => new Date(e.occurredAt).toDateString() === now.toDateString());
  const foundMonthly = found.filter((r) => !r.maybeStopped).reduce((t, r) => t + r.monthlyCost, 0);

  return (
    <div className="page dash">
      <header className="page-head">
        <div className="col">
          <span className="eyebrow">{greeting(hour)}</span>
          <h1 className="display">{now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</h1>
        </div>
        <div className="row gap8">
          <button className="icon-btn" onClick={onSearch} aria-label="Search (/)"><Icon name="search" size={20} /></button>
          <button className="icon-btn" onClick={onSettings} aria-label="Settings"><Icon name="gear" size={20} /></button>
        </div>
      </header>

      <div className="dash-side col gap16">
      <section className="hero dash-hero" role="button" tabIndex={0} onClick={onRecap} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRecap(); } }}
        aria-label="This month so far. Opens the month recap">
        <div className="row between" style={{ alignItems: "flex-start", gap: 12 }}>
          <div className="col gap4">
            <span className="label">{snap.hasBudget ? "Safe to spend today" : "Spent this month"}</span>
            <span className="amount display num">{formatMoney(snap.hasBudget ? snap.leftToday : snap.spent)}</span>
          </div>
          {snap.hasBudget && <span className="pill num">{formatMoney(snap.spent)} of {formatMoney(snap.budget)}</span>}
        </div>
        <TallyMarks days={days} today={now.getDate()} />
        {snap.hasBudget ? (
          <div className="stats">
            <div className="col"><span>{snap.left >= 0 ? "Left this month" : "Over budget"}</span><span className="num">{formatMoney(Math.abs(snap.left))}</span></div>
            <div className="col"><span>Days left</span><span className="num">{snap.daysLeft}</span></div>
            <div className="col"><span>Spent today</span><span className="num">{formatMoney(snap.spentToday)}</span></div>
          </div>
        ) : (
          <button className="btn" onClick={(e) => { e.stopPropagation(); onSettings(); }}>Set a monthly budget to see what's safe each day</button>
        )}
      </section>

      <section className="col gap8 dash-repeats">
        <div className="section-title"><span>One-tap repeats</span><span className="t-muted">Hold to edit</span></div>
        <div className="chips">
          {s.chips.map((c) => <ChipButton key={c.id} chip={c} onEdit={setChipMenu} />)}
          <button className="chip dashed" onClick={() => setNewChip(true)}>+ Pin</button>
        </div>
      </section>

      {(pending > 0 || backupDays !== null || (!loggedToday && hour >= 19 && month.length > 0)) && (
        <div className="col gap8 dash-banners">
          {pending > 0 && (
            <button className="banner" onClick={onInbox}>
              <Icon name="inbox" size={20} /><span className="grow">{pending} captured payment{pending === 1 ? "" : "s"} to review</span><Icon name="next" size={16} />
            </button>
          )}
          {!loggedToday && hour >= 19 && month.length > 0 && (
            <button className="banner info" onClick={() => onAdd()}><Icon name="plus" size={20} /><span className="grow">Anything to log for today?</span></button>
          )}
          {backupDays !== null && (
            <button className="banner" onClick={onSettings}>
              <Icon name="download" size={20} />
              <span className="grow">{s.settings.lastBackupAt ? `Last backup was ${backupDays} days ago` : "You haven't backed up yet"}. Your data lives only in this browser.</span>
              <Icon name="next" size={16} />
            </button>
          )}
        </div>
      )}

      {(found.length > 0 || note) && (
        <div className="col gap12">
          {foundMonthly > 0 && (
            <button className="note-card" onClick={() => go("plan")}>
              <span className="note-icon"><Icon name="repeat" size={18} /></span>
              <span className="grow col">
                <strong>{found.length} repeating charge{found.length === 1 ? "" : "s"} found</strong>
                <span className="t-muted small">About {formatMoney(foundMonthly)} a month. Check them in Plan and keep track of the ones you still use.</span>
              </span>
              <Icon name="next" size={16} />
            </button>
          )}
          {note && (
            <div className={`note-card ${note.tone}`}>
              <span className="note-icon"><Icon name={note.tone === "warn" ? "alert" : note.tone === "good" ? "check" : "info"} size={18} /></span>
              <span className="grow col"><strong>{note.title}</strong><span className="t-muted small">{note.detail}</span></span>
            </div>
          )}
        </div>
      )}
      </div>

      <div className="dash-grid">
        <DashCard title="Cash flow" action="Reports" onAction={() => go("reports")}>
          <div className="flow-mini">
            <FlowRow label={received ? "Income" : "Expected income"} value={income} max={Math.max(income, snap.spent)} tone="in" />
            <FlowRow label="Spent" value={snap.spent} max={Math.max(income, snap.spent)} tone="out" />
          </div>
          <div className="row between small">
            <span className="t-muted">{income ? (income >= snap.spent ? "Left over" : "Overspent") : "Add income to see what's left"}</span>
            {income > 0 && (
              <span className="t-strong num" style={{ color: income >= snap.spent ? "var(--good)" : "var(--danger)" }}>
                {formatMoney(Math.abs(income - snap.spent))}{rate !== null && rate > 0 ? ` · ${Math.round(rate * 100)}% saved` : ""}
              </span>
            )}
          </div>
        </DashCard>

        <DashCard title="Coming up" sub={upcoming.length ? `${formatMoney(upcomingTotal)} in 14 days` : undefined} action="Plan" onAction={() => go("plan")}>
          {upcoming.length === 0 ? (
            <p className="t-muted small" style={{ margin: 0 }}>Nothing due in the next two weeks. Add rent, recharges and subscriptions in Plan.</p>
          ) : (
            <ul className="due-list">
              {upcoming.slice(0, 5).map((u) => {
                const d = new Date(u.at);
                const soon = u.at - now.getTime() < 3 * 86_400_000;
                return (
                  <li key={u.key}>
                    <span className={`due-date${soon ? " soon" : ""}`}><strong>{d.getDate()}</strong><span>{d.toLocaleDateString([], { month: "short" })}</span></span>
                    <span className="grow col" style={{ minWidth: 0 }}>
                      <span className="t-strong ellipsis">{u.name}</span>
                      <span className="tiny t-muted">{u.found ? "Repeats · found in your spending" : categoryMeta(u.category).title}</span>
                    </span>
                    <span className="num t-strong">{formatMoney(u.amount)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </DashCard>

        <DashCard title="Budgets" action="Plan" onAction={() => go("plan")}>
          {snap.hasBudget && <BudgetMini label="This month" spent={monthSpent(s.expenses, now)} limit={snap.budget} />}
          {budgets.map((b) => <BudgetMini key={b.category} label={categoryMeta(b.category).title} spent={b.spent} limit={b.limit} />)}
          {!snap.hasBudget && budgets.length === 0 && (
            <p className="t-muted small" style={{ margin: 0 }}>Set a monthly budget, and limits for the categories you overspend on.</p>
          )}
        </DashCard>

        <DashCard title="Net worth" action="Accounts" onAction={() => go("accounts")}>
          {s.accounts.length === 0 ? (
            <p className="t-muted small" style={{ margin: 0 }}>Add your bank, cards, cash and investments to track net worth month by month.</p>
          ) : (
            <div className="row between" style={{ alignItems: "flex-end", gap: 12 }}>
              <div className="col gap4">
                <span className="display num" style={{ fontSize: 28 }}>{netWorth < 0 ? "−" : ""}{formatMoney(Math.abs(netWorth))}</span>
                <span className="tiny t-muted">{s.accounts.length} account{s.accounts.length === 1 ? "" : "s"}</span>
              </div>
              <Sparkline values={series.map((p) => p.net)} />
            </div>
          )}
        </DashCard>

        <DashCard title="Recent" action="All activity" onAction={() => go("activity")} flush>
          {recent.length === 0 ? (
            <div style={{ padding: "4px 16px 16px" }}>
              <p className="t-muted small" style={{ margin: "0 0 12px" }}>Nothing logged yet. Tap a repeat above, press + or N, or type a sentence with Smart add.</p>
              <button className="btn primary" onClick={() => onAdd()}>Log an expense</button>
            </div>
          ) : (
            <div className="divided">
              {recent.map((e) => <button key={e.id} className="row-btn" onClick={() => onOpen(e)}><ExpenseRowView e={e} /></button>)}
            </div>
          )}
        </DashCard>

      </div>

      <ChipEditor chip={chipMenu} open={chipMenu !== null || newChip} onClose={() => { setChipMenu(null); setNewChip(false); }} />
    </div>
  );
}

function DashCard({ title, sub, action, onAction, flush, children }: {
  title: string; sub?: string; action?: string; onAction?: () => void; flush?: boolean; children: ReactNode;
}) {
  return (
    <section className={`card dash-card${flush ? " flush" : ""}`}>
      <header className="dash-card-head">
        <div className="col">
          <h2>{title}</h2>
          {sub && <span className="tiny t-muted num">{sub}</span>}
        </div>
        {action && <button className="btn ghost small-btn" onClick={onAction}>{action}<Icon name="next" size={14} /></button>}
      </header>
      {children}
    </section>
  );
}

function FlowRow({ label, value, max, tone }: { label: string; value: number; max: number; tone: "in" | "out" }) {
  return (
    <div className="flow-row">
      <div className="row between small"><span className="t-muted">{label}</span><span className="t-strong num">{value ? formatMoney(value) : "—"}</span></div>
      <div className="flow-track"><div className={`flow-fill ${tone}`} style={{ width: `${max ? (value / max) * 100 : 0}%` }} /></div>
    </div>
  );
}

function BudgetMini({ label, spent, limit }: { label: string; spent: number; limit: number }) {
  const f = limit ? spent / limit : 0;
  return (
    <div className="col gap4">
      <div className="row between small">
        <span className="t-strong">{label}</span>
        <span className="num" style={{ color: f > 1 ? "var(--danger)" : "var(--muted)" }}>{formatMoney(spent)} / {formatMoney(limit)}</span>
      </div>
      <Progress value={f} tone={f > 1 ? "over" : f > 0.8 ? "warn" : "ok"} />
    </div>
  );
}

