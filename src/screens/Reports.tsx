import { useMemo, useState } from "react";
import { billPayments, expenseTitle, share, useTally, type Bill, type Expense } from "../data/store";
import { EVERY_LABEL, nextDueDate, WEEKDAYS } from "../core/schedule";
import { allCategories, categoryMeta, type Category } from "../core/categories";
import {
  expensesIn, GROUP_LABEL, groupSpending, incomeBySource, incomesIn, monthlyCashFlow, PERIOD_LABEL, periodRange, savingsRate,
  type GroupBy, type Period, type ReportFilter,
} from "../core/reports";
import { formatMoney } from "../core/money";
import { CategoryIcon, Icon } from "../ui/icons";
import { Empty } from "../ui/components";
import { BarList, CashFlowSankey, ChartCard, DataTable, PairedColumns, StatTile, type FlowNode } from "../ui/charts";
import { download } from "../ui/download";
import { MonthDetail } from "./MonthDetail";
import { ProfileButton } from "../ui/ProfileMenu";

type Tab = "flow" | "spending" | "month";
const GROUP_PLURAL: Record<GroupBy, string> = { category: "Categories", sub: "Subcategories", merchant: "Places", account: "Payment methods", tag: "Tags" };
const TABS: [Tab, string][] = [["flow", "Cash flow"], ["spending", "Spending"], ["month", "Month in detail"]];

const isoDay = (d: Date) => d.toLocaleDateString("en-CA");
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const dayMonth = (d: Date | number) => new Date(d).toLocaleDateString([], { day: "numeric", month: "short" });
const ROWS = 15;

/** "Every month on the 25th", "Every Monday", "Every year on 3 Mar". */
function billSchedule(b: Bill): string {
  const every = b.every ?? "month";
  if (every === "week") return `Every ${WEEKDAYS[b.weekday ?? 1]}`;
  if (every === "year") return `${EVERY_LABEL.year} on ${dayMonth(new Date(2026, b.month ?? 0, b.day))}`;
  return `${EVERY_LABEL.month} on the ${ordinal(b.day)}`;
}
const fromIso = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

/** Reports: income and spending over any period, grouped and filtered the way you ask. */
export function Reports({ onOpen }: { onOpen?: (e: Expense) => void }) {
  const s = useTally();
  const [allRows, setAllRows] = useState(false);
  const [tab, setTab] = useState<Tab>("flow");
  const [period, setPeriod] = useState<Period>("this-month");
  const now = new Date();
  const [from, setFrom] = useState(isoDay(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(isoDay(now));
  const [groupBy, setGroupBy] = useState<GroupBy>("category");
  const [category, setCategory] = useState<Category | "">("");
  const [account, setAccount] = useState("");
  const [tag, setTag] = useState("");
  const tags = useMemo(() => [...new Set(s.expenses.flatMap((e) => e.tags ?? []))].sort(), [s.expenses]);

  const range = useMemo(() => periodRange(period, now, { from: fromIso(from), to: fromIso(to) }), [period, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const filter: ReportFilter = { categories: category ? [category] : undefined, accounts: account ? [account] : undefined, tag: tag || undefined };
  const spent = useMemo(() => expensesIn(s.expenses, range, filter), [s.expenses, range, category, account, tag]); // eslint-disable-line react-hooks/exhaustive-deps
  // Income doesn't have categories or tags, so those filters leave it out rather than mixing scopes.
  const received = useMemo(() => (category || tag ? [] : incomesIn(s.incomes, range, filter)), [s.incomes, range, category, account, tag]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupSpending(spent, groupBy), [spent, groupBy]);
  const spendingTotal = groups.reduce((t, g) => t + g.total, 0);
  const totalIn = received.reduce((t, x) => t + x.amount, 0);
  const rate = savingsRate(totalIn, spendingTotal);
  const months = useMemo(() => monthlyCashFlow(s.expenses, tag ? [] : s.incomes, range, filter), [s.expenses, s.incomes, range, category, account, tag]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = Math.max(1, Math.round((Math.min(range[1].getTime(), Date.now()) - range[0].getTime()) / 86_400_000));
  const accounts = useMemo(() => [...new Set([...s.expenses.filter((e) => !e.paidBy).map((e) => e.account), ...s.incomes.map((x) => x.account)].filter(Boolean))].sort(), [s.expenses, s.incomes]);
  const billsHere = useMemo(() => (category ? s.bills.filter((b) => b.category === category) : []), [s.bills, category]);
  const rows = useMemo(() => [...spent].sort((a, b) => b.occurredAt - a.occurredAt), [spent]);
  const title = category ? categoryMeta(category).title : "";
  const rangeText = `${range[0].toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })} – ${new Date(range[1].getTime() - 1).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`;

  // The flow: income sources in, spending groups and savings out. Small groups fold into "Other".
  const flow = useMemo(() => {
    const sources: FlowNode[] = incomeBySource(received).slice(0, 4).map((x) => ({ key: `in:${x.label}`, label: x.label, value: x.total, color: "var(--viz-cat-3)" }));
    const restIn = totalIn - sources.reduce((t, n) => t + n.value, 0);
    if (restIn > 0) sources.push({ key: "in:other", label: "Other income", value: restIn, color: "var(--viz-cat-3)" });
    if (spendingTotal > totalIn) sources.push({ key: "in:savings", label: totalIn ? "From savings" : "Spent", value: spendingTotal - totalIn, color: "var(--viz-muted)" });
    const targets: FlowNode[] = groups.slice(0, 6).map((g) => ({
      key: `out:${g.key}`, label: g.label, value: g.total, color: groupBy === "category" ? categoryMeta(g.category).tint : "var(--viz-emph)",
    }));
    const restOut = spendingTotal - targets.reduce((t, n) => t + n.value, 0);
    if (restOut > 0) targets.push({ key: "out:other", label: `${groups.length - 6} more`, value: restOut, color: "var(--viz-muted)" });
    if (totalIn > spendingTotal) targets.push({ key: "out:saved", label: "Left over", value: totalIn - spendingTotal, color: "var(--viz-cat-3)" });
    return { sources, targets };
  }, [received, groups, groupBy, totalIn, spendingTotal]);

  const exportCsv = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [[GROUP_LABEL[groupBy], "Spent (INR)", "Share", "Expenses"].join(",")];
    for (const g of groups) lines.push([esc(g.label), (g.total / 100).toFixed(2), `${Math.round(g.share * 100)}%`, String(g.count)].join(","));
    download(`tally-report-${isoDay(range[0])}-to-${isoDay(new Date(range[1].getTime() - 1))}.csv`, lines.join("\n"), "text/csv");
  };

  return (
    <div className="page wide">
      <header className="page-head">
        <h1 className="display">Reports</h1>
        <ProfileButton />
      </header>

      <div className="segmented span-2" role="tablist" aria-label="Report">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "month" ? <MonthDetail /> : (
        <>
          <div className="report-toolbar card span-2">
            <label className="field"><span>Period</span>
              <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
              </select>
            </label>
            {period === "custom" && (
              <>
                <label className="field"><span>From</span><input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
                <label className="field"><span>To</span><input type="date" value={to} min={from} max={isoDay(now)} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
              </>
            )}
            <label className="field"><span>Group by</span>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
              </select>
            </label>
            <label className="field"><span>Category</span>
              <select value={category} onChange={(e) => {
                setCategory(e.target.value as Category | "");
                setAllRows(false);
                // One category grouped by category is a single bar: show it by subcategory or place instead.
                if (e.target.value && groupBy === "category") setGroupBy((s.settings.subcategories[e.target.value] ?? []).length ? "sub" : "merchant");
              }}>
                <option value="">All categories</option>
                {allCategories().map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            <label className="field"><span>Paid with / into</span>
              <select value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="">All accounts</option>
                {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            {tags.length > 0 && (
              <label className="field"><span>Tag</span>
                <select value={tag} onChange={(e) => setTag(e.target.value)}>
                  <option value="">All tags</option>
                  {tags.map((x) => <option key={x} value={x}>#{x}</option>)}
                </select>
              </label>
            )}
          </div>
          <p className="t-muted small span-2" style={{ margin: "-4px 4px 0" }}>
            {rangeText}{category ? ` · ${categoryMeta(category).title} only, so income isn't included` : ""}{account ? ` · ${account}` : ""}{tag ? ` · #${tag} only` : ""}
          </p>

          <section className="kpis span-2" aria-label="Totals for this report">
            {tab === "flow" ? (
              <>
                <StatTile label="Income" value={category ? "—" : formatMoney(totalIn)} note={category ? "Not split by category" : `${received.length} payment${received.length === 1 ? "" : "s"}`} />
                <StatTile label="Spending" value={formatMoney(spendingTotal)} note={`${spent.length} expense${spent.length === 1 ? "" : "s"}`} />
                <StatTile label={totalIn >= spendingTotal ? "Left over" : "Overspent"} value={category ? "—" : formatMoney(Math.abs(totalIn - spendingTotal))}
                  tone={category || !totalIn ? undefined : totalIn >= spendingTotal ? "good" : "bad"}
                  delta={category || !totalIn ? undefined : totalIn >= spendingTotal ? "more came in than went out" : "more went out than came in"} />
                <StatTile label="Savings rate" value={rate === null || category ? "—" : `${Math.round(rate * 100)}%`} note={rate === null ? "Log income to see it" : "of income kept"} />
              </>
            ) : (
              <>
                <StatTile label="Spending" value={formatMoney(spendingTotal)} note={`${spent.length} expense${spent.length === 1 ? "" : "s"}`} />
                <StatTile label="Per day" value={formatMoney(Math.round(spendingTotal / days))} note={`over ${days} day${days === 1 ? "" : "s"}`} />
                <StatTile label="Biggest group" value={groups[0]?.label ?? "—"} note={groups[0] ? `${formatMoney(groups[0].total)} · ${Math.round(groups[0].share * 100)}%` : undefined} />
                <StatTile label={GROUP_PLURAL[groupBy]} value={String(groups.length)} />
              </>
            )}
          </section>

          {spent.length === 0 && received.length === 0 ? (
            <div className="card span-2"><Empty title="Nothing in this period" body="Pick a longer period, or clear the filters." /></div>
          ) : tab === "flow" ? (
            <>
              <ChartCard className="span-2" title="Where the money went"
                subtitle={totalIn ? `Money in on the left, where it went on the right, by ${GROUP_LABEL[groupBy].toLowerCase()}` : "No income logged in this period, so this shows spending only. Add income in Activity or Plan."}
                table={<DataTable head={["", "Amount", "Share"]} rows={[
                  ...flow.sources.map((n) => [`In: ${n.label}`, formatMoney(n.value), `${Math.round((n.value / Math.max(totalIn, spendingTotal, 1)) * 100)}%`]),
                  ...flow.targets.map((n) => [`Out: ${n.label}`, formatMoney(n.value), `${Math.round((n.value / Math.max(totalIn, spendingTotal, 1)) * 100)}%`]),
                ]} />}>
                <CashFlowSankey sources={flow.sources} targets={flow.targets}
                  ariaLabel={`Cash flow: ${formatMoney(totalIn)} in, ${formatMoney(spendingTotal)} spent across ${groups.length} groups`} />
              </ChartCard>
              {months.length > 1 && (
                <ChartCard className="span-2" title="Income and spending by month" subtitle="Hover or focus a month to see what was left over"
                  table={<DataTable head={["Month", "Income", "Spending", "Left over"]}
                    rows={months.map((m) => [m.month.toLocaleDateString([], { month: "short", year: "numeric" }), formatMoney(m.income), formatMoney(m.spending),
                      `${m.net < 0 ? "−" : ""}${formatMoney(Math.abs(m.net))}`])} />}>
                  <PairedColumns ariaLabel={`Income and spending for ${months.length} months`}
                    columns={months.map((m) => ({ key: m.month.toISOString(), label: m.month.toLocaleDateString([], { month: "short" }),
                      title: m.month.toLocaleDateString([], { month: "long", year: "numeric" }), income: category ? 0 : m.income, spending: m.spending }))} />
                </ChartCard>
              )}
            </>
          ) : (
            <>
            <ChartCard className="span-2" title={`Spending by ${GROUP_LABEL[groupBy].toLowerCase()}`} subtitle={`${formatMoney(spendingTotal)} across ${groups.length} · ${rangeText}`}
              legend={<button className="btn ghost small-btn" onClick={exportCsv}><Icon name="download" size={16} />Export CSV</button>}
              table={<DataTable head={[GROUP_LABEL[groupBy], "Spent", "Share", "Expenses", "Average"]}
                rows={groups.map((g) => [g.label, formatMoney(g.total), `${Math.round(g.share * 100)}%`, g.count, formatMoney(Math.round(g.total / g.count))])} />}>
              <BarList rows={groups.slice(0, 25).map((g) => ({
                key: g.key, label: g.label, value: g.total,
                lead: groupBy === "account" ? <span className="acct-icon"><Icon name="card" size={16} /></span> : <CategoryIcon category={g.category} size={32} />,
                detail: <>{Math.round(g.share * 100)}% · {g.count} expense{g.count === 1 ? "" : "s"} · {formatMoney(Math.round(g.total / g.count))} each on average</>,
              }))} />
              {groups.length > 25 && <p className="viz-foot">The rest ({groups.length - 25} more) are in the table and the export.</p>}
            </ChartCard>

            {category && (
              <section className="col gap8 span-2" aria-label={`Bills in ${title}`}>
                <div className="section-title"><span>Bills and subscriptions in {title}</span>
                  {billsHere.length > 0 && (() => {
                    const paid = billsHere.reduce((t, b) => t + billPayments(b, spent).reduce((u, e) => u + share(e), 0), 0);
                    return <span className="t-muted small num">{paid ? `${formatMoney(paid)} paid in this period` : "None paid in this period"}</span>;
                  })()}
                </div>
                {billsHere.length === 0 ? (
                  <div className="card"><p className="t-muted small" style={{ margin: 0 }}>No bills or subscriptions in {title}. Ones you add in Plan with this category show up here, with what each cost in the period.</p></div>
                ) : (
                  <div className="card flush divided">
                    {billsHere.map((b) => {
                      const paid = billPayments(b, spent);
                      const paidTotal = paid.reduce((t, e) => t + share(e), 0);
                      return (
                        <div key={b.id} className="list-row">
                          <CategoryIcon category={b.category} size={32} />
                          <span className="grow col" style={{ minWidth: 0 }}>
                            <span className="t-strong ellipsis">{b.name}{b.isSubscription ? <span className="t-muted tiny"> · subscription</span> : null}</span>
                            <span className="tiny t-muted ellipsis">
                              {formatMoney(b.amount)} · {billSchedule(b)} · {b.cancelledAt ? `cancelled ${dayMonth(b.cancelledAt)}` : `next due ${dayMonth(nextDueDate(b))}`}
                            </span>
                          </span>
                          <span className="col" style={{ alignItems: "flex-end" }}>
                            <span className="t-strong num">{paid.length ? formatMoney(paidTotal) : "—"}</span>
                            <span className="tiny t-muted">{paid.length ? `paid ${paid.length === 1 ? "once" : `${paid.length} times`}` : "not paid in this period"}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            <section className="col gap8 span-2" aria-label="Expenses in this report">
              <div className="section-title"><span>{category ? `Every ${title} expense` : "Every expense"}</span>
                <span className="t-muted small num">{rows.length} · {formatMoney(spendingTotal)}</span>
              </div>
              <div className="card flush divided">
                {(allRows ? rows : rows.slice(0, ROWS)).map((e) => {
                  const isBill = billsHere.some((b) => billPayments(b, [e]).length > 0) || e.id.startsWith("bill-");
                  const body = (
                    <>
                      <CategoryIcon category={e.category} size={32} />
                      <span className="grow col" style={{ minWidth: 0 }}>
                        <span className="t-strong ellipsis">{expenseTitle(e)}</span>
                        <span className="tiny t-muted ellipsis">
                          {[dayMonth(e.occurredAt), category ? e.sub : categoryMeta(e.category).title, isBill ? "bill" : "", e.paidBy ? `${e.paidBy} paid` : e.account].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="col" style={{ alignItems: "flex-end" }}>
                        <span className="t-strong num">{formatMoney(share(e))}</span>
                        {e.splitWays > 1 && <span className="tiny t-muted num">of {formatMoney(e.amount)}</span>}
                      </span>
                    </>
                  );
                  return onOpen
                    ? <button key={e.id} className="list-row row-btn" onClick={() => onOpen(e)} aria-label={`Open ${expenseTitle(e)}`}>{body}</button>
                    : <div key={e.id} className="list-row">{body}</div>;
                })}
              </div>
              {rows.length > ROWS && (
                <button className="btn ghost" style={{ alignSelf: "center" }} onClick={() => setAllRows(!allRows)}>{allRows ? "Show fewer" : `Show all ${rows.length}`}</button>
              )}
            </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
