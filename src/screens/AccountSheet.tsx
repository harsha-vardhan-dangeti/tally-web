import { useEffect, useMemo, useState } from "react";
import { accountItems, investmentReturn, liveBalance, saveAccount, showToast, useTally, type Account, type Expense, type Income } from "../data/store";
import { formatMoney } from "../core/money";
import { Sheet } from "../ui/components";
import { Icon } from "../ui/icons";
import { IncomeEditor } from "./Calendar";

const ICON = { income: "trend", expense: "bag", transfer: "transfer", ledger: "split" } as const;
const day = (t: number) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
const short = (t: number) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });

/**
 * A bank, cash or investment account: its balance, what came in and went out this month, and every
 * income, expense, transfer and loan to a person that went through it. Income can be added from here.
 */
export function AccountSheet({ accountId, onClose, onEdit, onOpenExpense }: {
  accountId: string | null; onClose: () => void; onEdit: (a: Account) => void; onOpenExpense?: (e: Expense) => void;
}) {
  const s = useTally();
  const a = accountId ? s.accounts.find((x) => x.id === accountId && x.kind !== "card") ?? null : null;
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");
  const [all, setAll] = useState(false);
  const [income, setIncome] = useState<{ income: Income | null; day: Date; account?: string } | null>(null);
  useEffect(() => { setFilter("all"); setAll(false); }, [accountId]);
  const items = useMemo(() => (a ? accountItems(a, s) : []), [a, s]);
  if (!a) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;

  const balance = liveBalance(a, s);
  const foreign = !!a.currency && a.currency !== s.settings.currency;
  const money = (v: number) => formatMoney(v, foreign ? { currency: a.currency } : {});
  const follows = !!a.tracked && !foreign;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const thisMonth = items.filter((x) => x.at >= monthStart);
  const moneyIn = thisMonth.filter((x) => x.amount > 0).reduce((t, x) => t + x.amount, 0);
  const moneyOut = thisMonth.filter((x) => x.amount < 0).reduce((t, x) => t - x.amount, 0);
  const shownAll = items.filter((x) => filter === "all" || (filter === "in" ? x.amount > 0 : x.amount < 0));
  const shown = all ? shownAll : shownAll.slice(0, 12);
  const ret = investmentReturn(a, s);

  const follow = () => {
    const before = a;
    saveAccount({ ...a, balance, tracked: true, updatedAt: Date.now(), balanceSetAt: Date.now() });
    showToast(`${a.name} now follows your expenses and income`, () => saveAccount(before));
  };

  return (
    <>
      <Sheet open onClose={onClose} title={a.name}
        actions={<button className="btn ghost" onClick={() => onEdit(a)}><Icon name="edit" size={16} />Edit</button>}>
        <div className="card col gap12" style={{ background: "var(--surface-2)" }}>
          <div className="col gap4">
            <span className="eyebrow">{a.kind === "investment" ? "Value" : "Balance"}</span>
            <span className="display num" style={{ fontSize: 32, color: balance < 0 ? "var(--warn)" : undefined }}>{balance < 0 ? "−" : ""}{money(Math.abs(balance))}</span>
            <span className="tiny t-muted">
              {follows ? `Follows your income and expenses since you set it on ${short(a.updatedAt)}`
                : foreign ? `In ${a.currency}: you update this balance yourself`
                : `The balance you entered on ${day(a.updatedAt)}. Income and expenses don't change it.`}
            </span>
            {ret && <span className="tiny" style={{ color: ret.gain < 0 ? "var(--warn)" : "var(--muted)" }}>Invested {formatMoney(ret.invested)} · {ret.gain >= 0 ? "+" : "−"}{formatMoney(Math.abs(ret.gain))}</span>}
          </div>
          {(moneyIn > 0 || moneyOut > 0) && (
            <dl className="networth-split">
              <div><dt>In this month</dt><dd className="num in">{formatMoney(moneyIn)}</dd></div>
              <div><dt>Out this month</dt><dd className="num">{formatMoney(moneyOut)}</dd></div>
            </dl>
          )}
          {!follows && !foreign && <button className="btn" onClick={follow}>Follow my income and expenses</button>}
          {a.kind !== "investment" && (
            <button className="btn primary" onClick={() => setIncome({ income: null, day: new Date(), account: a.name })}>
              <Icon name="plus" size={16} />Add income to {a.name}
            </button>
          )}
        </div>

        <section className="col gap8">
          <div className="section-title">
            <span>Money in and out</span>
            {items.length > 0 && (
              <div className="view-switch" role="group" aria-label="Show">
                {(["all", "in", "out"] as const).map((f) => (
                  <button key={f} aria-pressed={filter === f} onClick={() => { setFilter(f); setAll(false); }}>{f === "all" ? "All" : f === "in" ? "In" : "Out"}</button>
                ))}
              </div>
            )}
          </div>
          {shownAll.length === 0 ? (
            <div className="card">
              <p className="t-muted small" style={{ margin: 0 }}>
                {items.length === 0
                  ? `Nothing yet. Income you add with “Received in: ${a.name}”, and expenses paid from it, show up here.`
                  : filter === "in" ? "No money in yet." : "No money out yet."}
              </p>
            </div>
          ) : (
            <div className="card flush divided">
              {shown.map((x) => {
                const open = x.income ? () => setIncome({ income: x.income!, day: new Date(x.at) }) : x.expense && onOpenExpense ? () => onOpenExpense(x.expense!) : undefined;
                const body = (
                  <>
                    <span className="acct-icon"><Icon name={ICON[x.kind]} size={18} /></span>
                    <span className="grow col" style={{ minWidth: 0 }}>
                      <span className="small t-strong ellipsis">{x.title}</span>
                      <span className="tiny t-muted ellipsis">
                        {day(x.at)}{x.detail ? ` · ${x.detail}` : ""}{follows && !x.counted ? " · in the balance you entered" : ""}
                      </span>
                    </span>
                    <span className={`num small t-strong${x.amount > 0 ? " in" : ""}`}>{x.amount > 0 ? "+" : "−"}{formatMoney(Math.abs(x.amount))}</span>
                  </>
                );
                return open
                  ? <button key={x.key} className="list-row row-btn" onClick={open}>{body}</button>
                  : <div key={x.key} className="list-row">{body}</div>;
              })}
            </div>
          )}
          {shownAll.length > 12 && (
            <button className="btn ghost" style={{ alignSelf: "center" }} onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${shownAll.length}`}</button>
          )}
        </section>
      </Sheet>
      <IncomeEditor value={income} onClose={() => setIncome(null)} />
    </>
  );
}
