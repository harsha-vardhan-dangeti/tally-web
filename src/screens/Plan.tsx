import { useMemo, useState } from "react";
import {
  billOverdue, billPaid, budgetSpent, cancelBill, cancelledSavings, chargedAfterCancel, deleteBill, restartBill, deleteBudget, deleteGoal, deleteRecurringIncome, dismissRecurring, logBill, logRecurringIncome, monthSpent, nextDue,
  recurringSuggestions, runDueBills, runDueIncome, saveBill, saveBudget, saveGoal, saveRecurringIncome, showToast, uid, useTally,
  deleteLoan, emiThisMonth, logEmi, runDueLoans, saveLoan, accountNamed, likelyAccount, liveBalance, scheduledFlows, type ScheduledFlow,
  type Bill, type Goal, type Loan, type RecurringIncome,
} from "../data/store";
import { emiFor, loanStatus } from "../core/loans";
import { currencySymbol } from "../core/money";
import { dateLocale, t } from "../i18n";
import { categoryMeta, pickableCategories, type Category } from "../core/categories";
import { monthKey, type BudgetPeriod } from "../core/budget";
import { dueInPeriod, EVERY_LABEL, monthlyEquivalent, periodKey, WEEKDAYS, type Every } from "../core/schedule";
import { formatMoney, parsePaise } from "../core/money";
import { CategoryIcon, Icon } from "../ui/icons";
import type { RecurringCharge } from "../core/recurring";
import { ProfileButton } from "../ui/ProfileMenu";
import { AccountNote, AccountSelect } from "../ui/AccountSelect";
import { Empty, Field, Progress, Sheet, Toggle } from "../ui/components";
import { CategorySelect } from "../ui/CategorySelect";

export function Plan() {
  const s = useTally();
  const now = new Date();
  const [budgetCat, setBudgetCat] = useState<Category | null>(null);
  const [bill, setBill] = useState<Bill | "new" | null>(null);
  const [goal, setGoal] = useState<Goal | "new" | null>(null);
  const [regular, setRegular] = useState<RecurringIncome | "new" | null>(null);
  const [loan, setLoan] = useState<Loan | "new" | null>(null);
  const owedOnLoans = s.loans.reduce((t, l) => t + loanStatus(l, now.getTime()).outstanding, 0);
  const isCardEmi = (name: string) => accountNamed(s, name)?.kind === "card";


  const upcoming = s.bills.filter((b) => !b.cancelledAt).sort((a, b) => nextDue(a).getTime() - nextDue(b).getTime());
  const cancelled = s.bills.filter((b) => b.cancelledAt).sort((a, b) => b.cancelledAt! - a.cancelledAt!);
  const [showCancelled, setShowCancelled] = useState(false);
  const savingMonthly = cancelled.reduce((t, b) => t + monthlyEquivalent(b.amount, b.every), 0);
  const subsMonthly = upcoming.filter((b) => b.isSubscription).reduce((t, b) => t + monthlyEquivalent(b.amount, b.every), 0);
  const due14 = upcoming.filter((b) => nextDue(b).getTime() - now.getTime() < 14 * 86_400_000).reduce((t, b) => t + b.amount, 0);
  const overall = s.settings.monthlyBudget;
  const spent = monthSpent(s.expenses, now);
  const unbudgeted = pickableCategories().filter((c) => !s.budgets.some((b) => b.category === c));
  const found = useMemo(() => recurringSuggestions(s, now.getTime()), [s.expenses, s.bills, s.settings.dismissedRecurring]); // eslint-disable-line react-hooks/exhaustive-deps
  const foundMonthly = found.filter((r) => !r.maybeStopped).reduce((t, r) => t + r.monthlyCost, 0);

  return (
    <div className="page wide">
      <header className="page-head">
        <h1 className="display">{t("Plan")}</h1>
        <ProfileButton />
      </header>

      <div className="plan-cols span-2">

      <section className="col gap8">
        <div className="section-title"><span>{t("Budgets")}</span></div>
        <div className="card col gap16">
          {overall > 0 && (
            <BudgetLine label="Overall" spent={spent} limit={overall} />
          )}
          {[...s.budgets].sort((a, b) => a.category.localeCompare(b.category)).map((b) => (
            <button key={b.category} onClick={() => setBudgetCat(b.category)} style={{ border: 0, background: "none", padding: 0, textAlign: "left" }}>
              <BudgetLine label={`${categoryMeta(b.category).title}${b.period && b.period !== "month" ? ` · ${PERIOD_WORD[b.period]}` : ""}`}
                spent={budgetSpent(b, s, now)} limit={b.limit} />
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
          <span>{t("Bills & subscriptions")}</span>
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
                    {b.isSubscription ? "Subscription" : "Bill"}{b.every && b.every !== "month" ? ` · ${EVERY_LABEL[b.every].toLowerCase()}` : ""}
                    {b.account ? ` · from ${b.account}` : ""}
                    {billPaid(b, now) ? ` · paid this ${b.every ?? "month"}` : billOverdue(b, now) ? " · not in expenses yet" : b.autoLog ? " · adds on due day" : ""}
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
        {cancelled.length > 0 && (
          <>
            <button className="btn ghost small-btn" style={{ alignSelf: "flex-start" }} aria-expanded={showCancelled} onClick={() => setShowCancelled(!showCancelled)}>
              {showCancelled ? "Hide cancelled" : `Cancelled (${cancelled.length}) · saving ${formatMoney(savingMonthly)} a month`}
            </button>
            {showCancelled && (
              <div className="card flush divided">
                {cancelled.map((b) => <CancelledRow key={b.id} bill={b} onOpen={() => setBill(b)} />)}
              </div>
            )}
          </>
        )}
        {subsMonthly > 0 && (
          <p className="t-muted tiny" style={{ margin: "0 4px" }}>
            Subscriptions cost {formatMoney(subsMonthly)} a month — {formatMoney(subsMonthly * 12)} a year.
          </p>
        )}
      </section>

      <AccountSchedule onBill={(id) => { const b = s.bills.find((x) => x.id === id); if (b) setBill(b); }}
        onLoan={(id) => { const l = s.loans.find((x) => x.id === id); if (l) setLoan(l); }} />

      <section className="col gap8" id="loans">
        <div className="section-title">
          <span>{t("Loans & EMIs")}</span>
          {owedOnLoans > 0 && <span className="t-muted num">{t("{amount} still owed", { amount: formatMoney(owedOnLoans) })}</span>}
        </div>
        <div className="card flush divided">
          {s.loans.length === 0 && (
            <Empty title={t("No loans yet")} body={t("Add a home, car, education or personal loan, or a purchase on EMI. Tally works out what's left to repay and can add each EMI to your expenses.")} />
          )}
          {s.loans.map((l) => {
            const st = loanStatus(l, now.getTime());
            return (
              <button key={l.id} className="list-row col" style={{ width: "100%", border: 0, background: "none", textAlign: "left", alignItems: "stretch", gap: 8 }} onClick={() => setLoan(l)}>
                <span className="row gap12">
                  <span className="cat-icon" style={{ width: 40, height: 40, background: "var(--fill)" }}><Icon name="card" size={20} /></span>
                  <span className="grow col" style={{ minWidth: 0 }}>
                    <span className="t-strong ellipsis">{l.name}{isCardEmi(l.account) && <span className="tag" style={{ marginLeft: 6 }}>Card EMI</span>}</span>
                    <span className="tiny t-muted">
                      {st.nextDue
                        ? t("{paid} of {total} EMIs paid · next {date}", { paid: st.paid, total: l.months, date: st.nextDue.toLocaleDateString(dateLocale(), { day: "numeric", month: "short" }) })
                        : t("Fully repaid")}
                      {l.account ? ` · from ${l.account}` : ""}
                    </span>
                  </span>
                  <span className="col" style={{ alignItems: "flex-end" }}>
                    <span className="t-strong num">{formatMoney(l.emi)}</span>
                    <span className="tiny t-muted">{t("a month")}</span>
                  </span>
                </span>
                <Progress value={st.repaid} tone="good" />
                <span className="row between tiny t-muted num">
                  <span>{t("{amount} left", { amount: formatMoney(st.outstanding) })}</span>
                  <span>{t("ends {date}", { date: st.endsOn.toLocaleDateString(dateLocale(), { month: "short", year: "numeric" }) })}</span>
                </span>
              </button>
            );
          })}
          <button className="list-row btn ghost" style={{ width: "100%", borderRadius: 0, justifyContent: "flex-start" }} onClick={() => setLoan("new")}>
            <Icon name="plus" size={18} /> {t("Add a loan or EMI")}
          </button>
        </div>
      </section>

      {found.length > 0 && (
        <section className="col gap8" id="recurring">
          <div className="section-title">
            <span>{t("Found in your spending")}</span>
            {foundMonthly > 0 && <span className="t-muted num">about {formatMoney(foundMonthly)} a month</span>}
          </div>
          <div className="card flush divided">
            {found.map((r) => <FoundCharge key={r.key} r={r} />)}
          </div>
          <p className="t-muted tiny" style={{ margin: "0 4px" }}>
            Charges that repeat at a steady interval for about the same amount. Track the ones you still pay for; dismiss the rest.
          </p>
        </section>
      )}

      <section className="col gap8">
        <div className="section-title">
          <span>{t("Regular income")}</span>
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
        <div className="section-title"><span>{t("Goals")}</span><button className="btn ghost" onClick={() => setGoal("new")}>+ {t("New goal")}</button></div>
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

      </div>

      <BudgetEditor category={budgetCat} onClose={() => setBudgetCat(null)} />
      <BillEditor value={bill} onClose={() => setBill(null)} />
      <GoalEditor value={goal} onClose={() => setGoal(null)} />
      <RegularIncomeEditor value={regular} onClose={() => setRegular(null)} />
      <LoanEditor value={loan} onClose={() => setLoan(null)} />
    </div>
  );
}

const CADENCE_WORD = { weekly: "Weekly", monthly: "Monthly", quarterly: "Every 3 months", yearly: "Yearly" } as const;

function FoundCharge({ r }: { r: RecurringCharge }) {
  const day = (t: number) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });
  const track = () => {
    saveBill({
      id: uid(), name: r.name, amount: r.amount, prevAmount: r.previousAmount ?? r.amount, day: r.day, category: r.category, account: r.account,
      // Its payments already reach Tally (logged or imported), so the bill only reminds; it doesn't add them again.
      isSubscription: true, autoLog: false,
      ...(r.cadence === "weekly" ? { every: "week" as const, weekday: new Date(r.lastAt).getDay() } : {}),
      ...(r.cadence === "yearly" ? { every: "year" as const, month: new Date(r.lastAt).getMonth() } : {}),
      lastLoggedMonth: periodKey({ every: r.cadence === "weekly" ? "week" : r.cadence === "yearly" ? "year" : "month", day: r.day }, new Date(r.lastAt)),
    });
    showToast(`Tracking ${r.name} in bills`);
  };
  const dismiss = () => {
    dismissRecurring(r.key);
    showToast(`Won't suggest ${r.name} again`, () => dismissRecurring(r.key, true));
  };
  return (
    <div className="found-row">
      <CategoryIcon category={r.category} size={40} />
      <div className="grow col gap4" style={{ minWidth: 0 }}>
        <div className="row gap8">
          <span className="t-strong ellipsis grow">{r.name}</span>
          <span className="t-strong num">{formatMoney(r.amount)}</span>
        </div>
        <span className="tiny t-muted">
          {CADENCE_WORD[r.cadence]} · {r.count} charges · last {day(r.lastAt)}{r.maybeStopped ? "" : ` · next around ${day(r.nextAt)}`}
        </span>
        <div className="row gap8 wrap">
          {r.previousAmount !== null && r.amount > r.previousAmount && <span className="tag warn">Price up from {formatMoney(r.previousAmount)}</span>}
          {r.maybeStopped && <span className="tag">May have stopped</span>}
          {r.cadence !== "monthly" && <span className="tag">{formatMoney(r.monthlyCost)} a month</span>}
        </div>
        <div className="row gap8" style={{ marginTop: 4 }}>
          {r.cadence !== "quarterly" && !r.maybeStopped && <button className="btn small-btn" onClick={track}><Icon name="plus" size={14} />Track as bill</button>}
          <button className="btn ghost small-btn" onClick={dismiss}>Not a subscription</button>
        </div>
      </div>
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

const PERIOD_WORD: Record<BudgetPeriod, string> = { week: "weekly", month: "monthly", year: "yearly" };

function BudgetEditor({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const s = useTally();
  const existing = s.budgets.find((b) => b.category === category);
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<BudgetPeriod>("month");
  const [seen, setSeen] = useState<Category | null>(null);
  if (category !== seen) { setSeen(category); setAmount(existing ? String(existing.limit / 100) : ""); setPeriod(existing?.period ?? "month"); }
  const p = parsePaise(amount);
  return (
    <Sheet open={!!category} onClose={onClose} title={category ? `${categoryMeta(category).title} budget` : ""}>
      <div className="row gap8" role="group" aria-label="Budget for each">
        {(["week", "month", "year"] as BudgetPeriod[]).map((x) => (
          <button key={x} className={`chip${period === x ? " on" : ""}`} aria-pressed={period === x} onClick={() => setPeriod(x)}>
            {x === "week" ? "Weekly" : x === "month" ? "Monthly" : "Yearly"}
          </button>
        ))}
      </div>
      <Field label={`${period === "week" ? "Weekly" : period === "year" ? "Yearly" : "Monthly"} limit (${currencySymbol()})`}>
        <input type="text" inputMode="numeric" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <p className="t-muted tiny" style={{ margin: 0 }}>
        {period === "week" ? "Weeks run Monday to Sunday." : period === "year" ? "Years run January to December." : "Follows your budget month (Settings → Month starts on)."}
      </p>
      <button className="btn primary block" disabled={!p} onClick={() => {
        saveBudget({ category: category!, limit: p!, ...(period !== "month" ? { period } : {}) });
        onClose();
      }}>Save</button>
      {existing && <button className="btn danger block" onClick={() => { deleteBudget(category!); onClose(); }}>Remove budget</button>}
    </Sheet>
  );
}

const MONTHS = Array.from({ length: 12 }, (_, m) => new Date(2026, m, 1).toLocaleDateString([], { month: "long" }));

function CancelledRow({ bill, onOpen }: { bill: Bill; onOpen: () => void }) {
  const s = useTally();
  const { saved } = cancelledSavings(bill);
  const late = chargedAfterCancel(bill, s);
  const when = (t: number) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });
  return (
    <button className="list-row" style={{ width: "100%", border: 0, background: "none", textAlign: "left" }} onClick={onOpen}>
      <span className="acct-icon"><Icon name="close" size={18} /></span>
      <span className="grow col" style={{ minWidth: 0 }}>
        <span className="t-strong ellipsis">{bill.name}</span>
        {late.length ? (
          <span className="tiny" style={{ color: "var(--warn)" }}>Charged {formatMoney(late[0].amount)} on {when(late[0].occurredAt)} after you cancelled</span>
        ) : (
          <span className="tiny t-muted">Cancelled {when(bill.cancelledAt!)}{saved ? ` · saved ${formatMoney(saved)} so far` : ""}</span>
        )}
      </span>
      <span className="num t-muted" style={{ textDecoration: "line-through" }}>{formatMoney(bill.amount)}</span>
    </button>
  );
}

function BillEditor({ value, onClose }: { value: Bill | "new" | null; onClose: () => void }) {
  const s = useTally();
  const bill = value && value !== "new" ? value : null;
  const blank = () => {
    const d = new Date();
    return { name: "", amount: "", every: "month" as Every, day: d.getDate() > 28 ? 1 : d.getDate(), weekday: d.getDay(), month: d.getMonth(),
      // Bills are usually debited from a bank: start on the account other bills use, not "UPI".
      category: "bills" as Category, account: likelyAccount(s, s.bills.map((b) => b.account)), isSubscription: false, autoLog: true, logNow: true, alreadyIn: false };
  };
  const [f, setF] = useState(blank);
  const [cancelling, setCancelling] = useState(false);
  const [cancelDate, setCancelDate] = useState("");
  const [seen, setSeen] = useState<typeof value>(null);
  if (value !== seen) {
    setSeen(value);
    setCancelling(false);
    setCancelDate(new Date().toLocaleDateString("en-CA"));
    setF(bill ? { name: bill.name, amount: String(bill.amount / 100), every: bill.every ?? "month", day: bill.day, weekday: bill.weekday ?? 1,
      month: bill.month ?? 0, category: bill.category, account: bill.account || s.settings.defaultAccount, isSubscription: bill.isSubscription,
      autoLog: bill.autoLog, logNow: false, alreadyIn: false } : blank());
  }
  const p = parsePaise(f.amount);
  const now = new Date();
  const repeat = { every: f.every, day: f.day, weekday: f.weekday, month: f.month };
  const periodWord = f.every === "week" ? "this week's" : f.every === "year" ? "this year's" : `${now.toLocaleDateString([], { month: "long" })}'s`;
  // A new bill whose due date has already come this period: offer to log this period's payment too.
  const draft = { ...repeat, lastLoggedMonth: "" } as Bill;
  const askLogNow = !bill && billOverdue(draft, now);
  // This period's payment came before the paying account's balance was entered: it may be in that balance already.
  const payer = accountNamed(s, f.account);
  const beforeBalance = askLogNow && f.logNow && !!payer?.tracked && Math.min(dueInPeriod(draft, now).getTime(), now.getTime()) <= payer.updatedAt;
  const save = () => {
    if (!p) return;
    const changedRepeat = bill && ((bill.every ?? "month") !== f.every);
    const saved: Bill = {
      id: bill?.id ?? uid(), name: f.name, amount: p, prevAmount: bill ? (p !== bill.amount ? bill.amount : bill.prevAmount) : p,
      day: f.day, category: f.category, account: f.account, isSubscription: f.isSubscription, autoLog: f.autoLog,
      ...(f.every !== "month" ? { every: f.every } : {}),
      ...(f.every === "week" ? { weekday: f.weekday } : {}),
      ...(f.every === "year" ? { month: f.month } : {}),
      ...(bill?.cancelledAt ? { cancelledAt: bill.cancelledAt } : {}),
      // A new (or re-scheduled) bill already due this period counts as paid unless "log now" is on; then it's logged below.
      lastLoggedMonth: bill && !changedRepeat ? bill.lastLoggedMonth : (askLogNow && f.logNow) || !billOverdue(draft, now) ? "" : periodKey(repeat, now),
    };
    saveBill(saved);
    if (askLogNow && f.logNow) {
      logBill(saved, now, { inBalance: beforeBalance && f.alreadyIn });
      showToast(`Logged ${saved.name} · ${formatMoney(saved.amount)}`);
    } else {
      runDueBills(now);
    }
    onClose();
  };
  return (
    <Sheet open={value !== null} onClose={onClose} title={bill ? "Edit bill" : "New bill or subscription"}>
      <Field label="Name"><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Rent, Netflix, Amazon Prime…" /></Field>
      <Field label={`Amount (${currencySymbol()})`}><input type="text" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <div className="row gap8" role="group" aria-label="Repeats">
        {(["week", "month", "year"] as Every[]).map((x) => (
          <button key={x} className={`chip${f.every === x ? " on" : ""}`} aria-pressed={f.every === x}
            // Adding a past payment now makes sense for this month's bill, less so for one months ago.
            onClick={() => setF({ ...f, every: x, logNow: x === "month" })}>{EVERY_LABEL[x]}</button>
        ))}
      </div>
      <div className="row gap8">
        {f.every === "week" ? (
          <Field label="Due on">
            <select value={f.weekday} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })}>
              {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
            </select>
          </Field>
        ) : (
          <>
            {f.every === "year" && (
              <Field label="Month">
                <select value={f.month} onChange={(e) => setF({ ...f, month: Number(e.target.value) })}>
                  {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
              </Field>
            )}
            <Field label="Due day">
              <select value={f.day} onChange={(e) => setF({ ...f, day: Number(e.target.value) })}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          </>
        )}
      </div>
      <div className="row gap8">
        <Field label="Category">
          <CategorySelect label="Category" value={f.category} onChange={(category) => setF({ ...f, category })} />
        </Field>
        <PaidFrom label="Paid from" value={f.account} onChange={(account) => setF({ ...f, account })} />
      </div>
      <AccountNote name={f.account} what="Each payment added to expenses" />
      <div>
        <Toggle label="Subscription" checked={f.isSubscription} onChange={(v) => setF({ ...f, isSubscription: v })} />
        <Toggle label="Add to expenses on the due date" hint="Each time it falls due, it's added to your spending" checked={f.autoLog} onChange={(v) => setF({ ...f, autoLog: v })} />
        {askLogNow && (
          <Toggle label={`Add ${periodWord} payment now`} hint="The due date has already come" checked={f.logNow} onChange={(v) => setF({ ...f, logNow: v })} />
        )}
        {beforeBalance && payer && (
          <Toggle label={`${periodWord[0].toUpperCase()}${periodWord.slice(1)} is already in ${payer.name}'s balance`} checked={f.alreadyIn} onChange={(v) => setF({ ...f, alreadyIn: v })}
            hint={`It was due before you entered ${payer.name}'s balance on ${new Date(payer.updatedAt).toLocaleDateString([], { day: "numeric", month: "short" })}. Turn this on if that balance already has it taken out, so it isn't counted twice.`} />
        )}
      </div>
      {bill && !bill.cancelledAt && (billPaid(bill, now)
        ? <p className="t-muted small" style={{ margin: 0 }}><Icon name="check" size={14} /> This {bill.every ?? "month"}'s payment is in your expenses.</p>
        : billOverdue(bill, now) && (
          <button className="btn block" onClick={() => {
            logBill(bill, now);
            showToast(`Logged ${bill.name} · ${formatMoney(bill.amount)}`);
            onClose();
          }}>Add this {bill.every ?? "month"}'s payment to expenses</button>
        ))}
      <button className="btn primary block" disabled={!f.name || !p} onClick={save}>Save</button>
      {bill && <CancelBlock bill={bill} cancelling={cancelling} setCancelling={setCancelling} date={cancelDate} setDate={setCancelDate} onDone={onClose} />}
      {bill && <button className="btn danger block" onClick={() => { deleteBill(bill.id); onClose(); }}>Delete</button>}
    </Sheet>
  );
}

/**
 * Cancel a bill or subscription (from today or the day you cancelled it), or restart a cancelled one.
 * A cancelled one shows what it has saved, and any charge from it since.
 */
function CancelBlock({ bill, cancelling, setCancelling, date, setDate, onDone }: {
  bill: Bill; cancelling: boolean; setCancelling: (v: boolean) => void; date: string; setDate: (v: string) => void; onDone: () => void;
}) {
  const s = useTally();
  const what = bill.isSubscription ? "subscription" : "bill";
  const monthly = monthlyEquivalent(bill.amount, bill.every);
  const today = new Date().toLocaleDateString("en-CA");
  const when = (t: number) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  if (bill.cancelledAt) {
    const { payments, saved } = cancelledSavings(bill);
    const late = chargedAfterCancel(bill, s);
    return (
      <div className="card col gap8" style={{ background: "var(--surface-2)" }}>
        <span className="small t-strong">Cancelled on {when(bill.cancelledAt)}</span>
        <span className="small t-muted">{payments
          ? `${payments} payment${payments === 1 ? "" : "s"} skipped so far: ${formatMoney(saved)} saved.`
          : `It won't be due again. That's ${formatMoney(monthly)} a month you keep.`}</span>
        {late.length > 0 && (
          <span className="small" style={{ color: "var(--warn)" }}>
            {late.length === 1 ? "1 charge" : `${late.length} charges`} from {bill.name} since then ({late.map((e) => `${formatMoney(e.amount)} on ${new Date(e.occurredAt).toLocaleDateString([], { day: "numeric", month: "short" })}`).join(", ")}). Check that the cancellation went through.
          </span>
        )}
        <button className="btn" onClick={() => { restartBill(bill); showToast(`Restarted ${bill.name}`, () => saveBill(bill)); onDone(); }}>Restart this {what}</button>
      </div>
    );
  }
  if (!cancelling) {
    return <button className="btn block" onClick={() => setCancelling(true)}><Icon name="close" size={16} />Cancel this {what}</button>;
  }
  const at = () => {
    if (date >= today) return Date.now();
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y, m - 1, d, 12).getTime();
  };
  return (
    <div className="card col gap8" style={{ background: "var(--surface-2)" }} role="group" aria-label={`Cancel ${bill.name}`}>
      <span className="small t-strong">Cancel {bill.name}?</span>
      <span className="small t-muted">It won't be due again, won't be added to your expenses, and leaves your reminders and totals. Payments already made stay in your spending.</span>
      <span className="small">You'll keep {formatMoney(monthly)} a month, {formatMoney(monthly * 12)} a year.</span>
      <Field label="Cancelled on"><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} /></Field>
      <div className="row gap8">
        <button className="btn danger" onClick={() => {
          cancelBill(bill, at());
          showToast(`Cancelled ${bill.name} · keeping ${formatMoney(monthly)} a month`, () => saveBill(bill));
          onDone();
        }}>Cancel {what}</button>
        <button className="btn" onClick={() => setCancelling(false)}>Keep it</button>
      </div>
    </div>
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
            <input type="text" inputMode="decimal" placeholder={`Add ${currencySymbol()}`} aria-label="Amount to add" value={add} onChange={(e) => setAdd(e.target.value)} />
            <button className="btn primary" disabled={!parsePaise(add)} onClick={() => { saveGoal({ ...goal, saved: goal.saved + parsePaise(add)! }); setAdd(""); onClose(); }}>Add</button>
          </div>
        </div>
      )}
      <Field label="Goal"><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Emergency fund" /></Field>
      <Field label={`Target (${currencySymbol()})`}><input type="text" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
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
  const [f, setF] = useState({ source: "Salary", amount: "", day: 1, account: "", note: "", autoLog: true, logNow: true, toBalance: false });
  const [seen, setSeen] = useState<typeof value>(null);
  if (value !== seen) {
    setSeen(value);
    const bank = s.accounts.find((a) => a.kind === "bank")?.name ?? "Bank";
    setF(rule
      ? { source: rule.source, amount: String(rule.amount / 100), day: rule.day, account: rule.account, note: rule.note, autoLog: rule.autoLog, logNow: false, toBalance: false }
      : { source: "Salary", amount: "", day: Math.min(new Date().getDate(), 28), account: bank, note: "", autoLog: true, logNow: true, toBalance: false });
  }
  const p = parsePaise(f.amount);
  const now = new Date();
  const monthName = now.toLocaleDateString([], { month: "long" });
  const receivedThisMonth = rule?.lastLoggedMonth === monthKey(now);
  // A new regular income whose day has already come this month: offer to add this month's too.
  const askLogNow = !rule && f.day <= now.getDate();
  // This month's lands on its day; if the account's balance was set after that, it's taken to be in it already.
  const into = accountNamed(s, f.account);
  const thisMonthAt = new Date(now.getFullYear(), now.getMonth(), f.day, 12).getTime();
  const beforeBalance = askLogNow && f.logNow && !!into?.tracked && Math.min(thisMonthAt, now.getTime()) <= into.updatedAt;
  // Set up mid-month: this month's may already be in the balance you entered.
  const save = () => {
    if (!p) return;
    const saved: RecurringIncome = {
      id: rule?.id ?? uid(), source: f.source.trim(), amount: p, day: f.day, account: f.account.trim(), note: f.note.trim(), autoLog: f.autoLog,
      lastLoggedMonth: rule?.lastLoggedMonth ?? (askLogNow && !f.logNow ? monthKey(now) : ""),
    };
    saveRecurringIncome(saved);
    if (askLogNow && f.logNow) {
      logRecurringIncome(saved, now, { inBalance: beforeBalance && f.toBalance });
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
        <Field label={`Amount (${currencySymbol()})`}><input type="text" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="120000" /></Field>
        <Field label="Arrives on">
          <select value={f.day} onChange={(e) => setF({ ...f, day: Number(e.target.value) })}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{ordinal(d)}</option>)}
          </select>
        </Field>
      </div>
      <PaidFrom label="Received in" value={f.account} onChange={(account) => setF({ ...f, account })} />
      <AccountNote name={f.account} what="Each payment added to income" incoming />
      <div>
        <Toggle label="Add to income on that day" hint="Each month, on or after the day, it's added to that month's income" checked={f.autoLog} onChange={(v) => setF({ ...f, autoLog: v })} />
        {askLogNow && (
          <Toggle label={`Add ${monthName}'s now`} hint="The day has already come this month" checked={f.logNow} onChange={(v) => setF({ ...f, logNow: v })} />
        )}
        {beforeBalance && into && (
          <Toggle label={`${monthName}'s is already in ${into.name}'s balance`} checked={f.toBalance} onChange={(v) => setF({ ...f, toBalance: v })}
            hint={`It came before you entered ${into.name}'s balance on ${new Date(into.updatedAt).toLocaleDateString([], { day: "numeric", month: "short" })}. Turn this on if that balance already includes it, so it isn't counted twice.`} />
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

const toDateInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function LoanEditor({ value, onClose }: { value: Loan | "new" | null; onClose: () => void }) {
  const loan = value && value !== "new" ? value : null;
  const s = useTally();
  const bankName = s.accounts.find((a) => a.kind === "bank")?.name ?? "Bank";
  const blank = { name: "", lender: "", principal: "", rate: "", months: "", first: "", emi: "", emiTouched: false, autoLog: true, category: "bills" as Category, account: bankName };
  const [f, setF] = useState(blank);
  const [seen, setSeen] = useState<typeof value>(null);
  if (value !== seen) {
    setSeen(value);
    const next = new Date();
    next.setMonth(next.getMonth() + 1, 5);
    setF(loan ? {
      name: loan.name, lender: loan.lender, principal: String(loan.principal / 100), rate: String(loan.ratePct), months: String(loan.months),
      first: toDateInput(loan.firstDueAt), emi: String(loan.emi / 100), emiTouched: true, autoLog: loan.autoLog, category: loan.category,
      account: loan.account || bankName,
    } : { ...blank, first: toDateInput(next.getTime()) });
  }
  const principal = parsePaise(f.principal);
  const rate = f.rate.trim() === "" ? null : Number(f.rate);
  const months = Number.parseInt(f.months, 10);
  const valid = principal !== null && rate !== null && Number.isFinite(rate) && rate >= 0 && rate < 100 && months >= 1 && months <= 600 && !!f.first;
  const computed = valid ? emiFor(principal!, rate!, months) : 0;
  const emi = f.emiTouched ? parsePaise(f.emi) : computed || null;
  const now = new Date();
  const monthName = now.toLocaleDateString(dateLocale(), { month: "long" });
  const [y, m, d] = f.first.split("-").map(Number);
  const firstDueAt = f.first ? new Date(y, m - 1, d, 12).getTime() : 0;
  const preview = valid && emi ? loanStatus({ principal: principal!, ratePct: rate!, months, emi, firstDueAt }, now.getTime()) : null;

  const save = () => {
    if (!valid || !emi) return;
    // A new loan doesn't add an EMI that already fell due this month (it's likely paid and logged);
    // the button in this sheet adds it if not. EMIs from now on are added on their day.
    let lastLoggedMonth = loan?.lastLoggedMonth ?? "";
    if (!loan) {
      const due = emiThisMonth({ firstDueAt, months } as Loan, now);
      if (due && due.getTime() <= now.getTime()) lastLoggedMonth = monthKey(now);
    }
    const saved: Loan = {
      id: loan?.id ?? uid(), name: f.name.trim(), lender: f.lender.trim(), principal: principal!, ratePct: rate!, months, emi, firstDueAt,
      category: f.category, account: f.account, autoLog: f.autoLog, lastLoggedMonth,
      createdAt: loan?.createdAt ?? Date.now(),
    };
    saveLoan(saved);
    runDueLoans(now);
    onClose();
  };
  const loggedThisMonth = loan?.lastLoggedMonth === monthKey(now);
  const dueThisMonth = loan ? emiThisMonth(loan, now) : null;

  return (
    <Sheet open={value !== null} onClose={onClose} title={loan ? loan.name : t("New loan or EMI")}>
      <Field label={t("Name")}><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("Home loan, car loan, phone on EMI…")} /></Field>
      <Field label={t("Lender (optional)")}><input type="text" value={f.lender} onChange={(e) => setF({ ...f, lender: e.target.value })} placeholder="HDFC, SBI, Bajaj Finserv…" /></Field>
      <div className="row gap8">
        <Field label={`${t("Amount borrowed")} (${currencySymbol()})`}>
          <input type="text" inputMode="decimal" value={f.principal} onChange={(e) => setF({ ...f, principal: e.target.value })} placeholder="500000" />
        </Field>
        <Field label={t("Interest (% a year)")}>
          <input type="text" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="10.5" />
        </Field>
      </div>
      <div className="row gap8">
        <Field label={t("Months")}><input type="text" inputMode="numeric" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} placeholder="36" /></Field>
        <Field label={t("First EMI")}><input type="date" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} /></Field>
      </div>
      <Field label={`${t("EMI")} (${currencySymbol()})`}>
        <input type="text" inputMode="decimal" value={f.emiTouched ? f.emi : computed ? String(computed / 100) : ""}
          onChange={(e) => setF({ ...f, emi: e.target.value, emiTouched: true })} placeholder={t("Worked out for you")} />
      </Field>
      {f.emiTouched && computed > 0 && emi !== computed && (
        <button className="btn ghost small-btn" style={{ alignSelf: "flex-start", marginTop: -6 }} onClick={() => setF({ ...f, emi: String(computed / 100) })}>
          {t("Use the standard EMI, {amount}", { amount: formatMoney(computed) })}
        </button>
      )}
      {preview && (
        <div className="card col gap4" style={{ background: "var(--surface-2)" }}>
          <span className="small">{t("{amount} still to repay", { amount: formatMoney(preview.outstanding) })} · {t("{n} EMIs left", { n: preview.left })}</span>
          <span className="tiny t-muted">{t("Total interest {amount} · last EMI {date}", { amount: formatMoney(preview.totalInterest), date: preview.endsOn.toLocaleDateString(dateLocale(), { month: "short", year: "numeric" }) })}</span>
        </div>
      )}
      <div className="row gap8">
        <Field label={t("Category")}>
          <CategorySelect label="Category" value={f.category} onChange={(category) => setF({ ...f, category })} />
        </Field>
        <PaidFrom label="EMI paid from" value={f.account} onChange={(account) => setF({ ...f, account })} />
      </div>
      <AccountNote name={f.account} what="Each EMI added to expenses" />
      <Toggle label={t("Add each EMI to expenses")} hint={t("On the EMI date each month, so it counts toward your budget")} checked={f.autoLog} onChange={(v) => setF({ ...f, autoLog: v })} />
      {loan && dueThisMonth && !loggedThisMonth && (
        <button className="btn block" onClick={() => { logEmi(loan, now); showToast(t("Added {name} EMI for {month}", { name: loan.name, month: monthName })); onClose(); }}>
          {t("Add {month}'s EMI to expenses", { month: monthName })}
        </button>
      )}
      <button className="btn primary block" disabled={!f.name.trim() || !valid || !emi} onClick={save}>{t("Save")}</button>
      {loan && <button className="btn danger block" onClick={() => { deleteLoan(loan.id); onClose(); }}>{t("Delete loan")}</button>}
      <p className="t-muted tiny" style={{ margin: 0 }}>{t("What's left is worked out from the EMI schedule. If you prepay, edit the amount borrowed and months to match your lender's statement.")}</p>
    </Sheet>
  );
}

/** Pick the account a payment comes from (or goes into): the same choices as Quick add. */
function PaidFrom({ label, value, onChange }: { label: string; value: string; onChange: (account: string) => void }) {
  return (
    <Field label={label}>
      <AccountSelect value={value} onChange={onChange} />
    </Field>
  );
}

/**
 * What's set to come out of (and into) each account over the next 30 days — bills and EMIs from
 * the account they're paid from, repeating transfers, card bills that pay themselves, regular
 * income — with the balance it leaves, so a shortfall or a card over its limit shows up early.
 */
function AccountSchedule({ onBill, onLoan }: { onBill: (id: string) => void; onLoan: (id: string) => void }) {
  const s = useTally();
  const now = new Date();
  const flows = useMemo(() => scheduledFlows(s, now, 30), [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = new Map<string, ScheduledFlow[]>();
  for (const f of flows) {
    const k = f.account.trim().toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const day = (t: number) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });

  return (
    <section className="col gap8" id="accounts-schedule">
      <div className="section-title"><span>From your accounts</span><span className="t-muted">next 30 days</span></div>
      <div className="card flush divided">
        {groups.size === 0 && (
          <Empty title="Nothing scheduled" body="Bills, EMIs, repeating transfers and card bills that pay themselves show here, under the account each one is paid from." />
        )}
        {[...groups.values()].map((list) => {
          const acct = accountNamed(s, list[0].account);
          const out = list.filter((f) => f.direction === "out").reduce((t, f) => t + f.amount, 0);
          const inn = list.filter((f) => f.direction === "in").reduce((t, f) => t + f.amount, 0);
          const card = acct?.kind === "card";
          const now$ = acct ? liveBalance(acct, s) : null;
          // A card's balance is what's owed: charges add to it, payments take it down.
          const after = now$ === null ? null : card ? now$ + out - inn : now$ - out + inn;
          const short = !card && after !== null && after < 0 ? -after : 0;
          const over = card && acct?.limit && after !== null && after > acct.limit ? after - acct.limit : 0;
          const shown = (v: number) => formatMoney(card ? -v : v);
          return (
            <div key={list[0].account} className="sched-group">
              <div className="row gap12">
                <span className="cat-icon" style={{ width: 36, height: 36, background: "var(--fill)" }}>
                  <Icon name={card ? "card" : acct ? "home" : "bag"} size={18} />
                </span>
                <span className="grow col" style={{ minWidth: 0 }}>
                  <span className="t-strong ellipsis">{acct?.name ?? list[0].account}</span>
                  <span className="tiny t-muted">
                    {out ? `${formatMoney(out)} going out` : ""}{out && inn ? " · " : ""}{inn ? `${formatMoney(inn)} coming in` : ""}
                  </span>
                </span>
                {now$ !== null && after !== null && (
                  <span className="col" style={{ alignItems: "flex-end" }}>
                    <span className="tiny t-muted">{card ? "owed" : "balance"} now → after</span>
                    <span className="small t-strong num">{shown(now$)} → {shown(after)}</span>
                  </span>
                )}
              </div>
              {short > 0 && <span className="tag warn">May run short by {formatMoney(short)}. Move money in before {day(list.find((f) => f.direction === "out")!.at)}.</span>}
              {over > 0 && <span className="tag warn">Would go {formatMoney(over)} over its limit</span>}
              {!acct && <span className="tiny t-muted">Not one of your accounts. Add it in Accounts to see its balance here.</span>}
              <ul className="sched-list">
                {list.map((f) => {
                  const open = f.ref && (f.kind === "bill" ? () => onBill(f.ref!) : f.kind === "emi" ? () => onLoan(f.ref!) : null);
                  const body = (
                    <>
                      <span className="sched-date">{day(f.at)}</span>
                      <span className="grow ellipsis">{f.label}</span>
                      <span className={`num t-strong ${f.direction === "in" ? "in" : ""}`}>{f.direction === "in" ? "+" : "−"}{formatMoney(f.amount)}</span>
                    </>
                  );
                  return <li key={f.key}>{open ? <button className="sched-item" onClick={open}>{body}</button> : <span className="sched-item">{body}</span>}</li>;
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="t-muted tiny" style={{ margin: "0 4px" }}>Open a bill or loan to change the account it's paid from. Card bills pay themselves when set up in Accounts.</p>
    </section>
  );
}
