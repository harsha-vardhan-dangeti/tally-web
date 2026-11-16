import { useEffect, useState } from "react";
import {
  cardActivity, cardLimitUsage, cardStatus, earlierThanBalance, expenseTitle, linkToCard, saveAccount, showToast, unlinkedCardExpenses, useTally,
  type Account,
} from "../data/store";
import { categoryMeta } from "../core/categories";
import { formatMoney } from "../core/money";
import { BarList, ChartCard, ColumnChart, DataTable } from "./charts";
import { Progress, Sheet, Toggle } from "./components";
import { CategoryIcon, Icon } from "./icons";

const short = (d: Date | number) => new Date(d).toLocaleDateString([], { day: "numeric", month: "short" });
const shortYear = (d: Date | number) => new Date(d).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
const DAY = 86_400_000;

/**
 * One credit card: what you owe on it, its bill, what you've spent on it statement by statement, and
 * every charge and payment. Expenses paid with "Credit card" (no card named) can be moved onto it.
 */
export function CardSheet({ cardId, onClose, onEdit }: { cardId: string | null; onClose: () => void; onEdit?: (a: Account) => void }) {
  const s = useTally();
  const a = cardId ? s.accounts.find((x) => x.id === cardId && x.kind === "card") ?? null : null;
  const [all, setAll] = useState(false);
  const [linking, setLinking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [addEarlier, setAddEarlier] = useState(false);
  useEffect(() => { setAll(false); setLinking(false); setAddEarlier(false); }, [cardId]);

  const unlinked = unlinkedCardExpenses(s);
  useEffect(() => { if (linking) setPicked(new Set(unlinked.map((e) => e.id))); }, [linking]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;

  const act = cardActivity(a, s);
  const bill = cardStatus(a, s);
  const usage = cardLimitUsage(a, s);
  const foreign = !!a.currency && a.currency !== s.settings.currency;
  const money = (v: number) => formatMoney(v, foreign ? { currency: a.currency } : {});
  const cur = act.periods[act.periods.length - 1];
  const byStatement = !!a.statementDay;
  const periodTitle = (p: { start: Date; end: Date }) => `${short(p.start)} – ${short(p.end.getTime() - DAY)}`;
  const periodLabel = (p: { start: Date }) => (byStatement ? short(p.start) : p.start.toLocaleDateString([], { month: "short" }));
  const charges = act.expenses.filter((e) => !e.pending);
  const shown = all ? charges : charges.slice(0, 8);
  const chosen = unlinked.filter((e) => picked.has(e.id));
  const chosenTotal = chosen.reduce((t, e) => t + e.amount, 0);
  const earlier = earlierThanBalance(a, chosen);

  const follow = () => {
    const before = a;
    saveAccount({ ...a, tracked: true, updatedAt: Date.now() });
    showToast(`${a.name} now goes up with each expense on it and down with each payment`, () => saveAccount(before));
  };
  const link = () => {
    const undo = linkToCard(a.id, chosen.map((e) => e.id), addEarlier && earlier > 0);
    showToast(`Moved ${chosen.length} ${chosen.length === 1 ? "expense" : "expenses"} to ${a.name}`, undo);
    setLinking(false);
  };

  return (
    <Sheet open onClose={onClose} title={a.name}
      actions={onEdit && <button className="btn ghost" onClick={() => onEdit(a)}><Icon name="edit" size={16} />Edit</button>}>
      <div className="card col gap12" style={{ background: "var(--surface-2)" }}>
        <div className="col gap4">
          <span className="eyebrow">{act.owed >= 0 ? "You owe" : "In your favour"}</span>
          <span className="display num" style={{ fontSize: 32 }}>{money(Math.abs(act.owed))}</span>
          <span className="tiny t-muted">
            {a.tracked ? "Goes up with each expense on this card, down with each payment" : `The balance you entered on ${shortYear(a.updatedAt)}`}
          </span>
        </div>
        {bill && (
          <dl className="networth-split">
            <div><dt>{bill.due ? `Due ${short(bill.due.date)}` : "Bill"}</dt><dd className="num">{bill.due ? money(bill.due.amount) : "Nothing due"}</dd></div>
            <div><dt>Since the statement</dt><dd className="num">{bill.unbilled === null ? "—" : money(bill.unbilled)}</dd></div>
          </dl>
        )}
        {bill && <span className="tiny t-muted">Next statement {short(bill.nextStatement)}{a.autoPay && a.payFrom ? ` · bill paid from ${s.accounts.find((x) => x.id === a.payFrom)?.name ?? "another account"}` : ""}</span>}
        {usage && (
          <div className="col gap4">
            <Progress value={usage.share} tone={usage.tone === "over" ? "over" : usage.tone === "near" ? "warn" : "ok"} />
            <span className="tiny" style={{ color: usage.tone === "over" ? "var(--danger)" : usage.tone === "near" ? "var(--warn)" : "var(--muted)" }}>
              {usage.available >= 0 ? `${money(usage.available)} available` : `${money(-usage.available)} over the limit`} of {money(usage.limit)}
              {usage.onEmi ? ` · ${money(usage.onEmi)} on EMI` : ""}
            </span>
          </div>
        )}
        {!a.tracked && !foreign && (
          <div className="col gap8">
            <span className="small">Expenses on {a.name} aren't changing this balance.</span>
            <button className="btn primary" onClick={follow}>Follow my expenses and payments</button>
          </div>
        )}
        {(!a.statementDay || !a.dueDay || !a.limit) && (onEdit ? (
          <button className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => onEdit(a)}>
            {!a.statementDay || !a.dueDay ? "Add statement and due days to see each bill" : "Add the credit limit"}
          </button>
        ) : (
          <span className="tiny t-muted">{!a.statementDay || !a.dueDay ? "Add statement and due days in Accounts to see each bill." : "Add the credit limit in Accounts to see what's left."}</span>
        ))}
      </div>

      {unlinked.length > 0 && (
        <div className="card col gap8">
          <span className="small">
            {unlinked.length === 1 ? "1 expense" : `${unlinked.length} expenses`} ({formatMoney(unlinked.reduce((t, e) => t + e.amount, 0))}) {unlinked.length === 1 ? "says" : "say"} “Credit card” without naming a card, so no card's balance includes {unlinked.length === 1 ? "it" : "them"}.
          </span>
          {!linking ? (
            <button className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setLinking(true)}>Choose which go on {a.name}</button>
          ) : (
            <>
              <div className="card flush divided pick-rows" style={{ background: "var(--surface-2)" }}>
                {unlinked.map((e) => (
                  <label key={e.id} className="list-row" style={{ cursor: "pointer" }}>
                    <input type="checkbox" checked={picked.has(e.id)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })} />
                    <span className="grow col" style={{ minWidth: 0 }}>
                      <span className="small ellipsis">{expenseTitle(e)}</span>
                      <span className="tiny t-muted">{shortYear(e.occurredAt)}</span>
                    </span>
                    <span className="num small">{formatMoney(e.amount)}</span>
                  </label>
                ))}
              </div>
              {earlier > 0 && (
                <Toggle checked={addEarlier} onChange={setAddEarlier} label={`Also add the ${formatMoney(earlier)} spent before ${short(a.updatedAt)} to what you owe`}
                  hint={`Leave this off if the balance you entered on ${short(a.updatedAt)} already includes them.`} />
              )}
              <div className="row gap8">
                <button className="btn primary" disabled={!chosen.length} onClick={link}>
                  {chosen.length ? `Move ${chosen.length} (${formatMoney(chosenTotal)}) to ${a.name}` : "Pick expenses to move"}
                </button>
                <button className="btn ghost" onClick={() => setLinking(false)}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      <ChartCard title={byStatement ? "Spent each statement" : "Spent each month"}
        subtitle={`${formatMoney(cur.spent)} so far ${byStatement ? "this statement" : "this month"}${cur.paid ? ` · ${formatMoney(cur.paid)} paid` : ""}`}
        table={<DataTable head={[byStatement ? "Statement" : "Month", "Spent", "Paid"]}
          rows={act.periods.map((p) => [periodTitle(p), formatMoney(p.spent), formatMoney(p.paid)]).reverse()} />}>
        <ColumnChart height={160} ariaLabel={`Spending on ${a.name} over the last ${act.periods.length} ${byStatement ? "statements" : "months"}`}
          columns={act.periods.map((p, i) => ({ key: p.start.toISOString(), label: periodLabel(p), title: periodTitle(p), value: p.spent, emphasis: i === act.periods.length - 1 }))} />
      </ChartCard>

      {act.byCategory.length > 0 && (
        <section className="col gap8">
          <div className="section-title"><span>{byStatement ? "This statement" : "This month"} by category</span></div>
          <div className="card">
            <BarList rows={act.byCategory.slice(0, 6).map((c) => ({
              key: c.category, lead: <CategoryIcon category={c.category} size={32} />, label: categoryMeta(c.category).title, value: c.amount,
            }))} />
          </div>
        </section>
      )}

      <section className="col gap8">
        <div className="section-title"><span>On this card</span>
          {charges.length > 8 && <button className="btn ghost" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${charges.length}`}</button>}
        </div>
        {charges.length === 0 ? (
          <div className="card"><p className="t-muted small" style={{ margin: 0 }}>Nothing yet. When you add an expense, pick {a.name} under “Paid from”, or type it: “450 swiggy {a.name.trim().split(/\s+/)[0].toLowerCase()} card”.</p></div>
        ) : (
          <div className="card flush divided">
            {shown.map((e) => (
              <div key={e.id} className="list-row">
                <CategoryIcon category={e.category} size={32} />
                <span className="grow col" style={{ minWidth: 0 }}>
                  <span className="small t-strong ellipsis">{expenseTitle(e)}</span>
                  <span className="tiny t-muted ellipsis">{shortYear(e.occurredAt)}{e.emiLoan ? " · moved to EMI" : ""}{a.tracked && e.occurredAt <= a.updatedAt ? " · in the balance you entered" : ""}</span>
                </span>
                <span className="num small" style={{ textDecoration: e.emiLoan ? "line-through" : undefined }}>{formatMoney(e.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {act.payments.length > 0 && (
        <section className="col gap8">
          <div className="section-title"><span>Bill payments</span></div>
          <div className="card flush divided">
            {act.payments.slice(0, 6).map((t) => (
              <div key={t.id} className="list-row">
                <span className="acct-icon"><Icon name="transfer" size={18} /></span>
                <span className="grow col" style={{ minWidth: 0 }}>
                  <span className="small t-strong ellipsis">From {s.accounts.find((x) => x.id === t.fromId)?.name ?? t.fromName}</span>
                  <span className="tiny t-muted">{shortYear(t.occurredAt)}</span>
                </span>
                <span className="num small in">{formatMoney(t.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </Sheet>
  );
}
