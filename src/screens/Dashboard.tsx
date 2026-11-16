import { useContext, useMemo, useState, type ReactNode } from "react";
import {
  accountsNow, backupOverdueDays, budgetSnapshot, budgetSpent, cardActivity, cardLimitUsage, cardSpendByMonth, cardStatus, counts, homeBalance, inMonth, investmentsSummary,
  nextDue, recurringSuggestions, unlinkedCardExpenses, unlinkedIncomeRules, unlinkedIncomes, useTally, type Account, type Chip, type Expense,
} from "../data/store";
import { addMonths, dayOfMonth, daysInMonth, monthKey, monthLabel, monthRange } from "../core/budget";
import { people, peopleTotals } from "../core/people";
import { loanStatus } from "../core/loans";
import { dateLocale, t } from "../i18n";
import { categoryMeta, type Category } from "../core/categories";
import { categoryBreakdown, cumulative, insights, monthStats, spendIn } from "../core/analytics";
import { yourShare } from "../core/smartParser";
import { netWorthSeries, savingsRate } from "../core/reports";
import { formatMoney } from "../core/money";
import { CategoryIcon, Icon } from "../ui/icons";
import { Progress } from "../ui/components";
import { BarList, LegendItem, PaceChart, Sparkline } from "../ui/charts";
import { CardSheet } from "../ui/CardSheet";
import { IncomeLinkSheet } from "../ui/IncomeLinkSheet";
import { TallyMarks } from "../ui/tally";
import { ProfileButton, ShellContext } from "../ui/ProfileMenu";
import { ChipButton, ChipEditor, ExpenseRowView, greeting } from "./Activity";

export type Destination = "activity" | "reports" | "plan" | "people" | "accounts";

const RECAP_SEEN = "tally:recapSeen";
const seenRecap = (key: string) => { try { return localStorage.getItem(RECAP_SEEN) === key; } catch { return false; } };

/** Home: today's number first, then this month at a glance. Each card leads to the screen with the detail. */
export function Home({ onOpen, onAdd, onSearch, onRecap, onInbox, onSettings, go }: {
  onOpen: (e: Expense) => void; onAdd: (day?: Date) => void; onSearch: () => void; onRecap: () => void; onInbox: () => void;
  onSettings: () => void; go: (to: Destination) => void;
}) {
  const s = useTally();
  const [chipMenu, setChipMenu] = useState<Chip | null>(null);
  const [newChip, setNewChip] = useState(false);
  const shell = useContext(ShellContext);
  const now = new Date();
  const snap = budgetSnapshot(s, now);
  const days = daysInMonth(now);
  const [start, end] = monthRange(now);

  const month = useMemo(() => inMonth(s.expenses, now).filter((e) => !e.pending), [s.expenses]); // eslint-disable-line react-hooks/exhaustive-deps
  const received = s.incomes.filter((x) => x.receivedAt >= start.getTime() && x.receivedAt < end.getTime()).reduce((t, x) => t + x.amount, 0);
  const income = received || s.settings.monthlyIncome;
  const rate = savingsRate(income, snap.spent);
  const recent = s.expenses.filter((e) => !e.pending).slice(0, 4);
  const found = useMemo(() => recurringSuggestions(s, now.getTime()), [s.expenses, s.bills, s.settings.dismissedRecurring]); // eslint-disable-line react-hooks/exhaustive-deps
  // Insights compare months, so only monthly budgets go in.
  const note = useMemo(() => insights(s.expenses, now, now, s.settings.monthlyBudget, s.budgets.filter((b) => !b.period || b.period === "month"))[0],
    [s.expenses, s.budgets, s.settings.monthlyBudget]); // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => netWorthSeries(accountsNow(s), now, 6, s.loans), [s.accounts, s.loans, s.expenses, s.incomes, s.ledger]); // eslint-disable-line react-hooks/exhaustive-deps
  const folks = useMemo(() => people(s.expenses, s.ledger), [s.expenses, s.ledger]);
  const owe = peopleTotals(folks);
  const inv = investmentsSummary(s);
  const cards = s.accounts.filter((a) => a.kind === "card");
  const unlinked = unlinkedCardExpenses(s);
  // This month against the same days of last month.
  const stats = useMemo(() => monthStats(s.expenses, now, now), [s.expenses]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevStats = useMemo(() => monthStats(s.expenses, addMonths(now, -1), now), [s.expenses]); // eslint-disable-line react-hooks/exhaustive-deps
  const sameDays = Math.min(stats.elapsed, prevStats.days);
  const prevSame = sameDays > 0 ? cumulative(prevStats.daily)[sameDays - 1] : 0;
  const prevByCat = useMemo(() => {
    const [ps] = monthRange(addMonths(now, -1));
    const m = new Map<Category, number>();
    for (const e of spendIn(s.expenses, ps, new Date(ps.getFullYear(), ps.getMonth(), ps.getDate() + sameDays))) m.set(e.category, (m.get(e.category) ?? 0) + yourShare(e.amount, e.splitWays));
    return m;
  }, [s.expenses, sameDays]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthly = s.budgets.filter((b) => !b.period || b.period === "month");
  const where = categoryBreakdown(s.expenses, now, monthly).filter((c) => c.total > 0).slice(0, 5);
  const otherSpend = stats.total - where.reduce((x, c) => x + c.total, 0);
  const otherBudgets = s.budgets.filter((b) => b.period === "week" || b.period === "year").map((b) => ({ ...b, spent: budgetSpent(b, s, now) }));
  // Card spending this month, and by the same day last month.
  const cardMonths = useMemo(() => cardSpendByMonth(s, 2, now), [s.expenses, s.accounts]); // eslint-disable-line react-hooks/exhaustive-deps
  const cardThis = cardMonths[1]?.spent ?? 0;
  const cardPrev = useMemo(() => {
    const ps = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const cut = new Date(ps.getFullYear(), ps.getMonth(), now.getDate() + 1).getTime();
    return cardSpendByMonth({ ...s, expenses: s.expenses.filter((e) => e.occurredAt < cut) }, 2, now)[0]?.spent ?? 0;
  }, [s.expenses, s.accounts]); // eslint-disable-line react-hooks/exhaustive-deps
  const [cardOpen, setCardOpen] = useState<string | null>(null);
  const [incomeLink, setIncomeLink] = useState(false);
  // Income going into "Bank", "UPI" or nothing, once there's a bank or cash account it could go into.
  const canLinkIncome = s.accounts.some((a) => a.kind === "bank" || a.kind === "cash");
  const looseIncomeTotal = canLinkIncome ? unlinkedIncomes(s).reduce((x, i) => x + i.amount, 0) : 0;
  const looseIncome = looseIncomeTotal > 0 || (canLinkIncome && unlinkedIncomeRules(s).length > 0);

  // In the first week of a month, offer last month's recap picture once.
  const lastMonth = addMonths(now, -1);
  const lastKey = monthKey(lastMonth);
  const [recapSeen, setRecapSeen] = useState(() => seenRecap(lastKey));
  const lastMonthCount = useMemo(() => inMonth(s.expenses, lastMonth).filter(counts).length, [s.expenses, lastKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const offerRecap = dayOfMonth(now) <= 7 && lastMonthCount >= 5 && !recapSeen;
  const markRecapSeen = () => { try { localStorage.setItem(RECAP_SEEN, lastKey); } catch { /* storage blocked */ } setRecapSeen(true); };
  const netWorth = series[series.length - 1]?.net ?? 0;
  // Only against a month with account balances recorded: loans alone would make a huge false jump.
  const prevNet = series.length > 1 && series[series.length - 2].assets ? series[series.length - 2].net : null;
  // What net worth is made of; the rows add up to it.
  const latest = series[series.length - 1] ?? { assets: 0, debts: 0, net: 0 };
  const cardOwed = cards.reduce((x, a) => x + Math.max(0, homeBalance(a, s)), 0);
  const worth = [
    { label: t("Bank and cash"), value: latest.assets - inv.value, detail: "" },
    { label: t("Investments"), value: inv.value, detail: inv.withReturns && inv.invested ? `${inv.gain >= 0 ? "+" : "−"}${(Math.abs(inv.gain / inv.invested) * 100).toFixed(1)}%` : "" },
    { label: t("Credit cards"), value: -cardOwed, detail: "" },
    { label: t("Loans"), value: -Math.max(0, latest.debts - cardOwed), detail: "" },
  ].filter((r) => r.value !== 0);

  // Bills and found subscriptions due in the next 14 days.
  const horizon = now.getTime() + 14 * 86_400_000;
  const upcoming = [
    ...s.bills.map((b) => ({ key: b.id, name: b.name, amount: b.amount, at: nextDue(b, now).getTime(), category: b.category, found: false })),
    ...found.filter((r) => !r.maybeStopped).map((r) => ({ key: r.key, name: r.name, amount: r.amount, at: r.nextAt, category: r.category, found: true })),
    ...s.loans.flatMap((l) => {
      const next = loanStatus(l, now.getTime()).nextDue;
      return next ? [{ key: `loan-${l.id}`, name: `${l.name} EMI`, amount: l.emi, at: next.getTime(), category: l.category, found: false }] : [];
    }),
    ...s.accounts.flatMap((a) => {
      const bill = cardStatus(a, s, now);
      return bill?.due ? [{ key: `card-${a.id}`, name: `${a.name} bill`, amount: bill.due.amount, at: bill.due.date.getTime(), category: "bills", found: false }] : [];
    }),
  ].filter((u) => u.at <= horizon).sort((a, b) => a.at - b.at);
  const upcomingTotal = upcoming.reduce((t, u) => t + u.amount, 0);

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
          <h1 className="display">{now.toLocaleDateString(dateLocale(), { weekday: "long", day: "numeric", month: "long" })}</h1>
        </div>
        <div className="row gap8">
          <button className="icon-btn" onClick={onSearch} aria-label={`${t("Search")} (/)`}><Icon name="search" size={20} /></button>
          <ProfileButton />
        </div>
      </header>

      <div className="dash-side col gap16">
      <section className="hero dash-hero" role="button" tabIndex={0} onClick={onRecap} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRecap(); } }}
        aria-label="This month so far. Opens the month recap">
        <div className="row between" style={{ alignItems: "flex-start", gap: 12 }}>
          <div className="col gap4">
            <span className="label">{snap.hasBudget ? t("Safe to spend today") : t("Spent this month")}</span>
            <span className="amount display num">{formatMoney(snap.hasBudget ? snap.leftToday : snap.spent)}</span>
          </div>
          {snap.hasBudget && <span className="pill num">{t("{spent} of {budget}", { spent: formatMoney(snap.spent), budget: formatMoney(snap.budget) })}</span>}
        </div>
        <TallyMarks days={days} today={dayOfMonth(now)} />
        {snap.hasBudget ? (
          <div className="stats">
            <div className="col"><span>{snap.left >= 0 ? t("Left this month") : t("Over budget")}</span><span className="num">{formatMoney(Math.abs(snap.left))}</span></div>
            <div className="col"><span>{t("Days left")}</span><span className="num">{snap.daysLeft}</span></div>
            <div className="col"><span>{t("Spent today")}</span><span className="num">{formatMoney(snap.spentToday)}</span></div>
          </div>
        ) : (
          <button className="btn" onClick={(e) => { e.stopPropagation(); onSettings(); }}>{t("Set a monthly budget to see what's safe each day")}</button>
        )}
      </section>

      <section className="col gap8 dash-repeats">
        <div className="section-title"><span>{t("One-tap repeats")}</span><span className="t-muted">{t("Hold to edit")}</span></div>
        <div className="chips">
          {s.chips.map((c) => <ChipButton key={c.id} chip={c} onEdit={setChipMenu} />)}
          <button className="chip dashed" onClick={() => setNewChip(true)}>+ {t("Pin")}</button>
        </div>
      </section>

      {(pending > 0 || backupDays !== null || offerRecap || (!loggedToday && hour >= 19 && month.length > 0)) && (
        <div className="col gap8 dash-banners">
          {offerRecap && (
            <div className="banner info recap-banner">
              <Icon name="sparkle" size={20} />
              <button className="grow" onClick={() => { markRecapSeen(); shell.openRecapShare("last"); }}>
                {t("Your {month} recap is ready. Share it?", { month: monthLabel(lastMonth, dateLocale()) })}
              </button>
              <button className="icon-btn" aria-label={t("Dismiss")} onClick={markRecapSeen}><Icon name="close" size={16} /></button>
            </div>
          )}
          {pending > 0 && (
            <button className="banner" onClick={onInbox}>
              <Icon name="inbox" size={20} /><span className="grow">{pending} captured payment{pending === 1 ? "" : "s"} to review</span><Icon name="next" size={16} />
            </button>
          )}
          {!loggedToday && hour >= 19 && month.length > 0 && (
            <button className="banner info" onClick={() => onAdd()}><Icon name="plus" size={20} /><span className="grow">{t("Anything to log for today?")}</span></button>
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
      </div>

      <div className="dash-grid">
        <DashCard wide title={t("This month")} sub={monthLabel(now, dateLocale())} action={t("Reports")} onAction={() => go("reports")}>
          {note && (
            <div className={`dash-note ${note.tone}`}>
              <Icon name={note.tone === "warn" ? "alert" : note.tone === "good" ? "check" : "info"} size={16} />
              <span><strong>{note.title}.</strong> {note.detail}</span>
            </div>
          )}
          <div className="dash-stats">
            <Stat label={t("Spent")} value={formatMoney(stats.total)}
              detail={prevStats.total > 0 && prevSame > 0 ? (stats.total >= prevSame
                ? t("{pct}% more than by this day last month", { pct: Math.round((stats.total / prevSame - 1) * 100) })
                : t("{pct}% less than by this day last month", { pct: Math.round((1 - stats.total / prevSame) * 100) })) : undefined}
              tone={prevSame > 0 && stats.total > prevSame * 1.1 ? "warn" : prevSame > 0 && stats.total < prevSame ? "good" : undefined} />
            <Stat label={received ? t("Income") : t("Expected income")} value={income ? formatMoney(income) : "—"}
              detail={income ? undefined : t("Add income to see what's left")} />
            <Stat label={!income || income >= stats.total ? t("Left over") : t("Overspent")} value={income ? formatMoney(Math.abs(income - stats.total)) : "—"}
              detail={rate !== null && rate > 0 ? t("{n}% saved", { n: Math.round(rate * 100) }) : undefined} tone={income && income < stats.total ? "warn" : undefined} />
            <Stat label={t("A day, on average")} value={formatMoney(stats.dailyAvg)}
              detail={stats.projected !== null && stats.elapsed < stats.days ? t("{amount} by month end", { amount: formatMoney(stats.projected) }) : undefined} />
          </div>
          {stats.count > 0 && (
            <>
              <PaceChart days={stats.days} elapsed={stats.elapsed} current={cumulative(stats.daily)} previous={cumulative(prevStats.daily)}
                budget={snap.hasBudget ? snap.budget : 0} projected={stats.projected} monthName={monthLabel(now, dateLocale())} prevName={monthLabel(addMonths(now, -1), dateLocale())} />
              <div className="viz-legend">
                <LegendItem kind="line" label={monthLabel(now, dateLocale())} />
                {stats.projected !== null && stats.elapsed < stats.days && <LegendItem kind="dash" label={t("At this pace")} />}
                {prevStats.total > 0 && <LegendItem kind="muted" label={monthLabel(addMonths(now, -1), dateLocale())} />}
                {snap.hasBudget && <LegendItem kind="ref" label={t("Even budget pace")} />}
              </div>
            </>
          )}
        </DashCard>

        <DashCard title={t("Where it went")} sub={prevStats.total > 0 ? t("Against the same days last month") : undefined} action={t("Reports")} onAction={() => go("reports")}>
          {where.length === 0 ? (
            <p className="t-muted small" style={{ margin: 0 }}>{t("Nothing spent this month yet.")}</p>
          ) : (
            <BarList markerLabel={t("budget")} rows={where.map((c) => {
              const before = prevByCat.get(c.category) ?? 0;
              const diff = c.total - before;
              return {
                key: c.category, lead: <CategoryIcon category={c.category} size={32} />, label: categoryMeta(c.category).title, value: c.total, marker: c.limit,
                // How it compares with the same days last month, beside the name; over budget wins.
                flag: c.limit && c.total > c.limit ? <span className="tiny t-strong" style={{ color: "var(--danger)" }}>{t("Over budget")}</span>
                  : prevStats.total > 0 && diff !== 0 ? <span className="tiny num" style={{ color: diff < 0 ? "var(--good)" : before && diff > before * 0.25 ? "var(--warn)" : "var(--muted)" }}>
                    {diff > 0 ? "▲" : "▼"} {formatMoney(Math.abs(diff))}</span> : undefined,
              };
            })} />
          )}
          {otherSpend > 0 && <span className="tiny t-muted">{t("{amount} in other categories", { amount: formatMoney(otherSpend) })}</span>}
          {otherBudgets.map((b) => <BudgetMini key={b.category} label={`${categoryMeta(b.category).title} · ${b.period === "week" ? t("this week") : t("this year")}`} spent={b.spent} limit={b.limit} />)}
        </DashCard>

        <DashCard title={t("Coming up")} sub={upcoming.length ? t("{amount} in 14 days", { amount: formatMoney(upcomingTotal) }) : undefined} action={t("Plan")} onAction={() => go("plan")}>
          {upcoming.length === 0 ? (
            <p className="t-muted small" style={{ margin: 0 }}>{t("Nothing due in the next two weeks. Add rent, recharges and subscriptions in Plan.")}</p>
          ) : (
            <ul className="due-list">
              {upcoming.slice(0, 4).map((u) => {
                const d = new Date(u.at);
                const soon = u.at - now.getTime() < 3 * 86_400_000;
                return (
                  <li key={u.key}>
                    <span className={`due-date${soon ? " soon" : ""}`}><strong>{d.getDate()}</strong><span>{d.toLocaleDateString(dateLocale(), { month: "short" })}</span></span>
                    <span className="grow col" style={{ minWidth: 0 }}>
                      <span className="t-strong ellipsis">{u.name}</span>
                      <span className="tiny t-muted">{u.found ? t("Found in your spending") : categoryMeta(u.category).title}</span>
                    </span>
                    <span className="num t-strong">{formatMoney(u.amount)}</span>
                  </li>
                );
              })}
              {upcoming.length > 4 && <li className="tiny t-muted">{t("and {n} more", { n: upcoming.length - 4 })}</li>}
            </ul>
          )}
        </DashCard>

        {(cards.length > 0 || unlinked.length > 0) && (
          <DashCard title={t("Credit cards")} sub={cardsSub(s, cards)} action={t("Accounts")} onAction={() => go("accounts")}>
            <div className="col gap12">
              {cards.slice(0, 4).map((a) => {
                const u = cardLimitUsage(a, s);
                const bill = cardStatus(a, s, now);
                const act = cardActivity(a, s, now, 1);
                const spent = act.periods[0]?.spent ?? 0;
                const line = bill?.due
                  ? t("{amount} due {date}", { amount: formatMoney(bill.due.amount), date: bill.due.date.toLocaleDateString(dateLocale(), { day: "numeric", month: "short" }) })
                  : spent ? (a.statementDay ? t("{amount} spent this statement", { amount: formatMoney(spent) }) : t("{amount} spent this month", { amount: formatMoney(spent) }))
                  : a.tracked ? t("Nothing spent on it yet") : t("Tap to have it follow your expenses");
                return (
                  <button key={a.id} className="col gap4 card-dash-row" onClick={() => setCardOpen(a.id)}>
                    <span className="row between small" style={{ width: "100%" }}>
                      <span className="t-strong ellipsis">{a.name}</span>
                      <span className="num t-strong" style={{ color: act.owed > 0 ? "var(--warn)" : undefined }}>{act.owed < 0 ? "+" : ""}{formatMoney(Math.abs(act.owed))}</span>
                    </span>
                    {u && <Progress value={u.share} tone={u.tone === "over" ? "over" : u.tone === "near" ? "warn" : "ok"} />}
                    <span className="tiny t-muted" style={{ textAlign: "left" }}>{line}</span>
                  </button>
                );
              })}
              {cardThis > 0 && (
                <span className="tiny t-muted">{cardPrev > 0
                  ? t("{amount} on cards this month, {prev} by this day last month", { amount: formatMoney(cardThis), prev: formatMoney(cardPrev) })
                  : t("{amount} on cards this month", { amount: formatMoney(cardThis) })}</span>
              )}
              {unlinked.length > 0 && (
                <div className="row between gap8" style={{ alignItems: "center" }}>
                  <span className="tiny" style={{ color: "var(--warn)" }}>{t("{amount} paid by “Credit card” isn't on any card yet", { amount: formatMoney(unlinked.reduce((x, e) => x + e.amount, 0)) })}</span>
                  {cards.length > 0
                    ? <button className="btn ghost small-btn" onClick={() => setCardOpen(cards[0].id)}>{t("Choose the card")}</button>
                    : <button className="btn ghost small-btn" onClick={() => go("accounts")}>{t("Add your card")}</button>}
                </div>
              )}
            </div>
          </DashCard>
        )}

        <DashCard title={t("Net worth")} action={t("Accounts")} onAction={() => go("accounts")}>
          {s.accounts.length === 0 && s.loans.length === 0 ? (
            <p className="t-muted small" style={{ margin: 0 }}>{t("Add your bank, cards, cash and investments to track net worth month by month.")}</p>
          ) : (
            <>
              <div className="row between" style={{ alignItems: "flex-end", gap: 12 }}>
                <div className="col gap4">
                  <span className="display num" style={{ fontSize: 28 }}>{netWorth < 0 ? "−" : ""}{formatMoney(Math.abs(netWorth))}</span>
                  {prevNet !== null && prevNet !== netWorth && (
                    <span className={`tiny t-strong ${netWorth > prevNet ? "in" : "out"}`}>{netWorth > prevNet ? "▲" : "▼"} {t("{amount} since last month", { amount: formatMoney(Math.abs(netWorth - prevNet)) })}</span>
                  )}
                </div>
                <Sparkline values={series.map((p) => p.net)} />
              </div>
              <dl className="dash-breakdown">
                {worth.map((r) => (
                  <div key={r.label}>
                    <dt>{r.label}{r.detail && <span className="tiny t-muted"> · {r.detail}</span>}</dt>
                    <dd className={`num${r.value < 0 ? " owe" : ""}`}>{r.value < 0 ? "−" : ""}{formatMoney(Math.abs(r.value))}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {looseIncome && (
            <div className="row between gap8" style={{ alignItems: "center" }}>
              <span className="tiny" style={{ color: "var(--warn)" }}>{looseIncomeTotal > 0
                ? t("{amount} of income isn't in any of your accounts", { amount: formatMoney(looseIncomeTotal) })
                : t("Your regular income isn't going into any of your accounts")}</span>
              <button className="btn ghost small-btn" onClick={() => setIncomeLink(true)}>{t("Choose account")}</button>
            </div>
          )}
          {(owe.owedToYou > 0 || owe.youOwe > 0) && (
            <button className="dash-people" onClick={() => go("people")}>
              <Icon name="split" size={16} />
              <span className="grow small">{[owe.owedToYou ? t("{amount} owed to you", { amount: formatMoney(owe.owedToYou) }) : "", owe.youOwe ? t("you owe {amount}", { amount: formatMoney(owe.youOwe) }) : ""].filter(Boolean).join(" · ")}</span>
              <Icon name="next" size={14} />
            </button>
          )}
        </DashCard>

        <DashCard title={t("Recent")} action={t("All activity")} onAction={() => go("activity")} flush wide>
          {recent.length === 0 ? (
            <div style={{ padding: "4px 16px 16px" }}>
              <p className="t-muted small" style={{ margin: "0 0 12px" }}>{t("Nothing logged yet. Tap a repeat above, press + or N, or type a sentence with Smart add.")}</p>
              <button className="btn primary" onClick={() => onAdd()}>{t("Log an expense")}</button>
            </div>
          ) : (
            <div className="recent-list">
              {recent.map((e) => <button key={e.id} className="row-btn" onClick={() => onOpen(e)}><ExpenseRowView e={e} /></button>)}
            </div>
          )}
        </DashCard>
      </div>

      <ChipEditor chip={chipMenu} open={chipMenu !== null || newChip} onClose={() => { setChipMenu(null); setNewChip(false); }} />
      <CardSheet cardId={cardOpen} onClose={() => setCardOpen(null)} />
      <IncomeLinkSheet open={incomeLink} onClose={() => setIncomeLink(false)} />
    </div>
  );
}

function DashCard({ title, sub, action, onAction, flush, wide, children }: {
  title: string; sub?: string; action?: string; onAction?: () => void; flush?: boolean; wide?: boolean; children: ReactNode;
}) {
  return (
    <section className={`card dash-card${flush ? " flush" : ""}${wide ? " wide" : ""}`}>
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

function Stat({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "warn" | "good" }) {
  return (
    <div className="dash-stat">
      <span className="tiny t-muted">{label}</span>
      <span className="num dash-stat-value">{value}</span>
      {detail && <span className="tiny" style={{ color: tone === "warn" ? "var(--warn)" : tone === "good" ? "var(--good)" : "var(--muted)" }}>{detail}</span>}
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


/** "You owe ₹14,000 · ₹14,000 of ₹1,50,000 used" across your cards. */
function cardsSub(s: ReturnType<typeof useTally>, cards: Account[]): string | undefined {
  const owed = cards.reduce((x, a) => x + Math.max(0, homeBalance(a, s)), 0);
  const usages = cards.map((a) => cardLimitUsage(a, s)).filter((u): u is NonNullable<typeof u> => !!u);
  const used = usages.reduce((x, u) => x + u.used, 0), limit = usages.reduce((x, u) => x + u.limit, 0);
  return [
    cards.length ? t("You owe {amount}", { amount: formatMoney(owed) }) : "",
    usages.length ? t("{pct}% of limit used", { pct: Math.round((used / limit) * 100) }) : "",
  ].filter(Boolean).join(" · ") || undefined;
}
