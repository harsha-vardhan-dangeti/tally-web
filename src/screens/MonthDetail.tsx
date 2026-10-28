import { useMemo, useState } from "react";
import { useTally } from "../data/store";
import { addMonths, monthRange } from "../core/budget";
import { categoryMeta } from "../core/categories";
import { compactMoney, formatMoney } from "../core/money";
import {
  categoryBreakdown, cumulative, insights, monthStats, monthlyTotals, paymentSplit, spentThroughDay, topMerchants, weekdayAverages, WEEKDAYS,
  type Insight,
} from "../core/analytics";
import { CategoryIcon, Icon } from "../ui/icons";
import { Empty } from "../ui/components";
import {
  BarList, ChartCard, ColumnChart, DataTable, LegendItem, PaceChart, ShareBar, SpendCalendar, StatTile,
} from "../ui/charts";

const PAYMENT_COLORS = ["var(--viz-cat-1)", "var(--viz-cat-2)", "var(--viz-cat-3)", "var(--viz-cat-4)"];
const pct = (part: number, whole: number) => Math.round((part / Math.max(whole, 1)) * 100);

/** Reports → Month: one month in depth — pace, daily spending, payment methods, categories, places. */
export function MonthDetail() {
  const s = useTally();
  const [offset, setOffset] = useState(0);
  const now = new Date();
  const month = addMonths(now, offset);
  const prevMonth = addMonths(month, -1);
  const budget = s.settings.monthlyBudget;
  const income = s.settings.monthlyIncome;

  const a = useMemo(() => {
    const [start, end] = monthRange(month);
    const stats = monthStats(s.expenses, month, now);
    const prev = monthStats(s.expenses, prevMonth, now);
    const lastDay = new Date(month.getFullYear(), month.getMonth(), stats.days);
    // Payment colours follow the account across months: slots go by all-time spend, not this month's rank.
    const order = paymentSplit(s.expenses, new Date(0), new Date(8.64e15), 99).map((p) => p.account);
    return {
      stats, prev,
      prevSamePoint: spentThroughDay(s.expenses, prevMonth, stats.elapsed),
      categories: categoryBreakdown(s.expenses, month, s.budgets),
      months: monthlyTotals(s.expenses, month, 6),
      weekdays: weekdayAverages(s.expenses, stats.isCurrent ? now : lastDay),
      merchants: topMerchants(s.expenses, start, end, 5),
      payments: paymentSplit(s.expenses, start, end).map((p) => {
        const slot = order.indexOf(p.account);
        return { ...p, color: p.account !== "Other" && slot >= 0 && slot < 4 ? PAYMENT_COLORS[slot] : "var(--viz-muted)" };
      }),
      notes: insights(s.expenses, month, now, budget, s.budgets),
    };
  }, [s.expenses, s.budgets, offset, budget]); // eslint-disable-line react-hooks/exhaustive-deps

  const { stats, prev } = a;
  const monthName = month.toLocaleDateString([], { month: "long" });
  const prevName = prevMonth.toLocaleDateString([], { month: "long" });
  const hasAny = s.expenses.some((e) => !e.pending);

  // Spent vs last month at the same point (or the whole month, for finished months).
  const compareTo = stats.isCurrent ? a.prevSamePoint : prev.total;
  const change = compareTo > 0 ? pct(Math.abs(stats.total - compareTo), compareTo) : null;
  const spentDelta = change === null ? undefined
    : `${change}% ${stats.total >= compareTo ? "more" : "less"} than ${prevName}${stats.isCurrent ? ` by the ${ordinal(stats.elapsed)}` : ""}`;
  const perDayBudget = budget > 0 ? Math.round(budget / stats.days) : 0;
  const busiest = a.weekdays.reduce((best, d) => (d.average > best.average ? d : best), a.weekdays[0]);
  const sixMonthAvg = Math.round(a.months.reduce((t, x) => t + x.total, 0) / Math.max(a.months.filter((x) => x.total > 0).length, 1));
  const showIncome = income > 0 && income <= Math.max(...a.months.map((x) => x.total), 1) * 1.6;
  const rows = a.categories.filter((r) => r.total > 0 || r.limit);

  return (
    <>
      <div className="report-toolbar span-2">
        <div className="month-switch" role="group" aria-label="Month">
          <button className="icon-btn" onClick={() => setOffset((o) => o - 1)} aria-label="Previous month"><Icon name="back" size={18} /></button>
          <span className="t-strong">{month.toLocaleDateString([], { month: "long", year: "numeric" })}</span>
          <button className="icon-btn" onClick={() => setOffset((o) => Math.min(o + 1, 0))} disabled={offset === 0} aria-label="Next month"><Icon name="next" size={18} /></button>
        </div>
      </div>

      {!hasAny ? (
        <div className="card span-2">
          <Empty title="Your spending patterns show up here" body="Log a few expenses and Tally charts your pace, busiest days, top places and categories." />
        </div>
      ) : (
        <>
          <section className="kpis span-2" aria-label={`${monthName} at a glance`}>
            <StatTile label={`Spent in ${monthName}`} value={formatMoney(stats.total)} delta={spentDelta}
              tone={change === null ? undefined : stats.total > compareTo ? "bad" : "good"} />
            <StatTile label="Daily average" value={formatMoney(stats.dailyAvg)}
              delta={perDayBudget ? `${formatMoney(Math.abs(stats.dailyAvg - perDayBudget))} ${stats.dailyAvg > perDayBudget ? "over" : "under"} your ${formatMoney(perDayBudget)} a day` : undefined}
              tone={perDayBudget ? (stats.dailyAvg > perDayBudget ? "bad" : "good") : undefined}
              note={perDayBudget ? undefined : `over ${stats.elapsed} day${stats.elapsed === 1 ? "" : "s"}`} />
            <StatTile label="Expenses" value={String(stats.count)}
              note={stats.count ? `${formatMoney(Math.round(stats.total / stats.count))} on average` : "None logged"} />
            {stats.projected !== null ? (
              <StatTile label="Month-end estimate" value={formatMoney(stats.projected)}
                delta={budget > 0 ? `${formatMoney(Math.abs(budget - stats.projected))} ${stats.projected > budget ? "over" : "under"} budget` : undefined}
                tone={budget > 0 ? (stats.projected > budget ? "bad" : "good") : undefined}
                note={budget > 0 ? undefined : "at your daily average"} />
            ) : budget > 0 ? (
              <StatTile label="Against budget" value={formatMoney(Math.abs(budget - stats.total))}
                delta={stats.total > budget ? "over budget" : "under budget"} tone={stats.total > budget ? "bad" : "good"} />
            ) : (
              <StatTile label="No-spend days" value={String(stats.noSpendDays)} note={`of ${stats.days} days`} />
            )}
          </section>

          {a.notes.length > 0 && (
            <section className="insights span-2" aria-label="Insights">
              {a.notes.map((n) => <InsightCard key={n.title} insight={n} />)}
            </section>
          )}

          <ChartCard className="span-2" title="Spending pace"
            subtitle={`Running total for ${monthName}, against ${prevName}${budget > 0 ? " and an even pace through your budget" : ""}`}
            legend={<>
              <LegendItem kind="line" label={monthName} />
              {stats.projected !== null && stats.elapsed < stats.days && <LegendItem kind="dash" label="Projected" />}
              <LegendItem kind="muted" label={prevName} />
              {budget > 0 && <LegendItem kind="ref" label="Even budget pace" />}
            </>}
            table={<DataTable head={["Day", monthName, prevName, ...(budget > 0 ? ["Budget pace"] : [])]}
              rows={cumulative(stats.daily).map((v, i) => [i + 1, i < stats.elapsed ? formatMoney(v) : "—",
                i < prev.days ? formatMoney(cumulative(prev.daily)[i]) : "—",
                ...(budget > 0 ? [formatMoney(Math.round((budget * (i + 1)) / stats.days))] : [])])} />}>
            <PaceChart days={stats.days} elapsed={stats.elapsed} current={cumulative(stats.daily)} previous={cumulative(prev.daily)}
              budget={budget} projected={stats.projected} monthName={monthName} prevName={prevName} />
          </ChartCard>

          <div className="fin-col">
            <ChartCard title="Daily spending"
              subtitle={perDayBudget ? `Darker days cost more. Your budget allows ${formatMoney(perDayBudget)} a day.` : "Darker days cost more."}
              table={<DataTable head={["Day", "Spent", "Expenses"]}
                rows={stats.daily.slice(0, stats.elapsed).map((v, i) => [
                  new Date(month.getFullYear(), month.getMonth(), i + 1).toLocaleDateString([], { weekday: "short", day: "numeric" }),
                  v ? formatMoney(v) : "—", stats.dailyCount[i]])} />}>
              <SpendCalendar month={month} daily={stats.daily} counts={stats.dailyCount} elapsed={stats.elapsed} budget={budget} />
              <p className="viz-foot">
                {stats.noSpendDays} no-spend day{stats.noSpendDays === 1 ? "" : "s"}
                {stats.biggest && <> · biggest: {stats.biggest.merchant || stats.biggest.note || categoryMeta(stats.biggest.category).title}, {formatMoney(Math.floor(stats.biggest.amount / stats.biggest.splitWays))}</>}
              </p>
            </ChartCard>
            <ChartCard title="How you pay" subtitle={`${monthName}, by payment method`}
              table={<DataTable head={["Method", "Spent", "Share"]} rows={a.payments.map((p) => [p.account, formatMoney(p.total), `${pct(p.total, stats.total)}%`])} />}>
              {a.payments.length === 0 ? <Empty title="Nothing logged this month" body="Payment methods appear as you log." /> : (
                <ShareBar parts={a.payments.map((p) => ({ key: p.account, label: p.account, value: p.total, color: p.color }))} />
              )}
            </ChartCard>
          </div>

          <ChartCard title="Where it went" subtitle={`By category, with your usual monthly spend for comparison`}
            legend={rows.some((r) => r.average) ? <><LegendItem kind="bar" label={monthName} /><LegendItem kind="tick" label="Usual month (average of up to 3)" /></> : undefined}
            table={<DataTable head={["Category", monthName, "Share", "Usual month", "Budget"]}
              rows={rows.map((r) => [categoryMeta(r.category).title, formatMoney(r.total), `${Math.round(r.share * 100)}%`,
                r.average !== null ? formatMoney(r.average) : "—", r.limit ? formatMoney(r.limit) : "—"])} />}>
            {rows.length === 0 ? <Empty title="Nothing logged this month" body="Categories appear as you log." /> : (
              <BarList markerLabel="Usual month" rows={rows.map((r) => ({
                key: r.category,
                lead: <CategoryIcon category={r.category} size={32} />,
                label: categoryMeta(r.category).title,
                value: r.total,
                marker: r.average,
                flag: r.limit ? <LimitFlag total={r.total} limit={r.limit} /> : undefined,
                detail: <>{Math.round(r.share * 100)}% of spending{r.average !== null && <> · usual {formatMoney(r.average)}</>}{r.limit ? <> · budget {formatMoney(r.limit)}</> : null}</>,
              }))} />
            )}
          </ChartCard>

          <ChartCard title="Last 6 months" subtitle={`Average ${formatMoney(sixMonthAvg)} a month`}
            table={<DataTable head={["Month", "Spent"]} rows={a.months.map((x) => [x.month.toLocaleDateString([], { month: "short", year: "numeric" }), formatMoney(x.total)])} />}>
            <ColumnChart ariaLabel={a.months.map((x) => `${x.month.toLocaleDateString([], { month: "short" })} ${formatMoney(x.total)}`).join(", ")}
              refLine={showIncome ? { value: income, label: `Income ${compactMoney(income)}` } : undefined}
              columns={a.months.map((x, i) => ({
                key: x.month.toISOString(), label: x.month.toLocaleDateString([], { month: "short" }), value: x.total,
                title: x.month.toLocaleDateString([], { month: "long", year: "numeric" }), emphasis: i === a.months.length - 1,
              }))} />
          </ChartCard>

          <ChartCard title="By day of the week"
            subtitle={busiest && busiest.average > 0 ? `${fullWeekday(busiest.weekday)}s cost you most: about ${formatMoney(busiest.average)}` : "Average spend on each day of the week"}
            table={<DataTable head={["Day", "Average", "Total (13 weeks)"]} rows={a.weekdays.map((d) => [WEEKDAYS[d.weekday], formatMoney(d.average), formatMoney(d.total)])} />}>
            <ColumnChart ariaLabel={a.weekdays.map((d) => `${WEEKDAYS[d.weekday]} ${formatMoney(d.average)}`).join(", ")}
              columns={a.weekdays.map((d) => ({
                key: String(d.weekday), label: WEEKDAYS[d.weekday], value: d.average, title: `${fullWeekday(d.weekday)}, average over 13 weeks`,
                emphasis: d.weekday === busiest?.weekday && d.average > 0,
              }))} />
          </ChartCard>

          <ChartCard title="Top places" subtitle={`Where most of ${monthName}'s money went`}
            table={<DataTable head={["Place", "Times", "Spent"]} rows={a.merchants.map((x) => [x.name, x.count, formatMoney(x.total)])} />}>
            {a.merchants.length === 0 ? <Empty title="No places yet" body="Add a merchant when you log, or use Smart add: “lunch 350 at Chutneys”." /> : (
              <BarList rows={a.merchants.map((x) => ({
                key: x.name, lead: <CategoryIcon category={x.category} size={32} />, label: x.name, value: x.total,
                detail: <>{x.count} time{x.count === 1 ? "" : "s"} · {formatMoney(Math.round(x.total / x.count))} each on average</>,
              }))} />
            )}
          </ChartCard>

        </>
      )}
    </>
  );
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const fullWeekday = (i: number) => ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i];

function InsightCard({ insight }: { insight: Insight }) {
  const icon = insight.tone === "warn" ? "alert" : insight.tone === "good" ? "check" : "info";
  return (
    <article className={`insight ${insight.tone}`}>
      <span className="insight-icon"><Icon name={icon} size={18} stroke={2.2} /></span>
      <div className="col gap4">
        <strong>{insight.title}</strong>
        <span className="t-muted small">{insight.detail}</span>
      </div>
    </article>
  );
}

/** Category budget status: an icon and words, never colour alone. */
function LimitFlag({ total, limit }: { total: number; limit: number }) {
  if (total > limit) return <span className="tag danger"><Icon name="alert" size={12} stroke={2.4} />Over budget</span>;
  if (total >= limit * 0.8) return <span className="tag warn"><Icon name="alert" size={12} stroke={2.4} />{pct(total, limit)}% used</span>;
  return null;
}


