import { useMemo, useState } from "react";
import { ACCOUNT_KIND_LABEL, deleteAccount, inMonth, counts, saveAccount, share, uid, useTally, type Account, type AccountKind } from "../data/store";
import { addMonths } from "../core/budget";
import { CATEGORIES, CATEGORY_META } from "../core/categories";
import { compactMoney, formatMoney, parsePaise } from "../core/money";
import { CategoryIcon } from "../ui/icons";
import { Empty, Field, Sheet } from "../ui/components";

export function Finances() {
  const s = useTally();
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const now = new Date();
  const income = s.settings.monthlyIncome;

  const months = useMemo(() => [5, 4, 3, 2, 1, 0].map((back) => {
    const d = addMonths(now, -back);
    return { label: d.toLocaleDateString([], { month: "short" }), spent: inMonth(s.expenses, d).filter(counts).reduce((t, e) => t + share(e), 0) };
  }), [s.expenses]); // eslint-disable-line react-hooks/exhaustive-deps
  const spent = months[5].spent;
  const maxSpent = Math.max(...months.map((m) => m.spent), 1);
  // Keep bars readable: only draw the income line when it fits near the bars.
  const showIncome = income > 0 && income <= maxSpent * 1.6;
  const max = Math.max(maxSpent * 1.1, showIncome ? income * 1.05 : 0);

  const byCat = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of inMonth(s.expenses, now).filter(counts)) totals.set(e.category, (totals.get(e.category) ?? 0) + share(e));
    return CATEGORIES.map((c) => ({ c, v: totals.get(c) ?? 0 })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  }, [s.expenses]); // eslint-disable-line react-hooks/exhaustive-deps
  const catTotal = byCat.reduce((t, x) => t + x.v, 0);
  const netWorth = s.accounts.reduce((t, a) => t + (a.kind === "card" ? -a.balance : a.balance), 0);

  // Donut geometry
  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;

  return (
    <div className="page">
      <header className="page-head"><h1 className="display">Finances</h1></header>

      <section className="card col gap12">
        <div className="col gap4">
          <span className="t-muted small">Net worth</span>
          <span className="display num" style={{ fontSize: 32 }}>{s.accounts.length ? formatMoney(netWorth) : "Add accounts below"}</span>
        </div>
        <div className="row gap12" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <Stat label="Income" value={income ? formatMoney(income) : "—"} color="var(--good)" />
          <Stat label="Spent" value={formatMoney(spent)} />
          <Stat label="Saved" value={income ? `${Math.round(((income - spent) / income) * 100)}%` : "—"} />
        </div>
      </section>

      <section className="card col gap12">
        <div className="section-title" style={{ padding: 0 }}>
          <span>Spending · last 6 months</span>
          {income > 0 && (showIncome
            ? <span className="t-muted row gap4"><span className="legend-dot" style={{ background: "var(--good)" }} />income</span>
            : <span className="t-muted">income {compactMoney(income)}/mo</span>)}
        </div>
        <div style={{ position: "relative" }}>
          <div className="row" style={{ alignItems: "flex-end", gap: 10, height: 140 }} role="img"
            aria-label={months.map((m) => `${m.label} ${formatMoney(m.spent)}`).join(", ")}>
            {months.map((m, i) => (
              <div key={m.label} className="col gap4" style={{ flex: 1, alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
                <span className="tiny t-muted num">{m.spent ? compactMoney(m.spent) : ""}</span>
                <div style={{ width: "100%", maxWidth: 34, height: `${(m.spent / max) * 100}%`, minHeight: m.spent ? 4 : 0,
                  background: i === 5 ? "var(--accent)" : "color-mix(in srgb, var(--accent) 40%, transparent)", borderRadius: 6 }} />
              </div>
            ))}
          </div>
          {showIncome && (
            <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: `${(income / max) * 100}%`,
              borderTop: "2px dashed var(--good)" }} />
          )}
        </div>
        <div className="row" style={{ gap: 10 }}>
          {months.map((m) => <span key={m.label} className="tiny t-muted" style={{ flex: 1, textAlign: "center" }}>{m.label}</span>)}
        </div>
      </section>

      {byCat.length > 0 && (
        <section className="card col gap12">
          <div className="section-title" style={{ padding: 0 }}><span>Where it went this month</span><span className="t-muted num">{formatMoney(catTotal)}</span></div>
          <div className="row gap16 wrap" style={{ alignItems: "center" }}>
            <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Spending by category">
              <g transform="rotate(-90 70 70)">
                {byCat.map(({ c, v }) => {
                  const len = (v / catTotal) * C;
                  const el = <circle key={c} cx="70" cy="70" r={R} fill="none" stroke={CATEGORY_META[c].tint} strokeWidth="20"
                    strokeDasharray={`${Math.max(len - 2, 0.5)} ${C}`} strokeDashoffset={-acc} />;
                  acc += len;
                  return el;
                })}
              </g>
            </svg>
            <div className="col gap8 grow" style={{ minWidth: 180 }}>
              {byCat.map(({ c, v }) => (
                <div key={c} className="row gap8 small">
                  <CategoryIcon category={c} size={26} />
                  <span className="grow">{CATEGORY_META[c].title}</span>
                  <span className="t-strong num">{formatMoney(v)}</span>
                  <span className="t-muted num" style={{ width: 40, textAlign: "right" }}>{Math.round((v / catTotal) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="col gap8">
        <div className="section-title"><span>Accounts</span><button className="btn ghost" onClick={() => setEditing("new")}>+ Add</button></div>
        <div className="card flush divided">
          {s.accounts.length === 0 && <Empty title="No accounts yet" body="Add your bank, cards, cash and investments to see your net worth. Balances are entered by you." />}
          {s.accounts.map((a) => (
            <button key={a.id} className="list-row" style={{ width: "100%", border: 0, background: "none", textAlign: "left" }} onClick={() => setEditing(a)}>
              <span className="grow col">
                <span className="t-strong">{a.name}</span>
                <span className="t-muted tiny">{ACCOUNT_KIND_LABEL[a.kind]} · updated {new Date(a.updatedAt).toLocaleDateString([], { day: "numeric", month: "short" })}</span>
              </span>
              <span className="t-strong num" style={{ color: a.kind === "card" ? "var(--warn)" : undefined }}>
                {a.kind === "card" ? "−" : ""}{formatMoney(a.balance)}
              </span>
            </button>
          ))}
        </div>
      </section>

      <AccountEditor value={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="col grow">
      <span className="t-muted tiny">{label}</span>
      <span className="t-strong num" style={{ color }}>{value}</span>
    </div>
  );
}

function AccountEditor({ value, onClose }: { value: Account | "new" | null; onClose: () => void }) {
  const s = useTally();
  const acct = value && value !== "new" ? value : null;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("bank");
  const [balance, setBalance] = useState("");
  const [seen, setSeen] = useState<typeof value>(null);
  if (value !== seen) {
    setSeen(value);
    setName(acct?.name ?? "");
    setKind(acct?.kind ?? "bank");
    setBalance(acct ? String(acct.balance / 100) : "");
  }
  return (
    <Sheet open={value !== null} onClose={onClose} title={acct ? "Edit account" : "New account"}>
      <Field label="Name"><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="HDFC Savings" /></Field>
      <Field label="Type">
        <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
          {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>)}
        </select>
      </Field>
      <Field label={kind === "card" ? "Amount owed (₹)" : "Balance (₹)"}>
        <input type="text" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0" />
      </Field>
      <button className="btn primary block" disabled={!name} onClick={() => {
        saveAccount({ id: acct?.id ?? uid(), name, kind, balance: parsePaise(balance) ?? 0, order: acct?.order ?? s.accounts.length, updatedAt: Date.now() });
        onClose();
      }}>Save</button>
      {acct && <button className="btn danger block" onClick={() => { deleteAccount(acct.id); onClose(); }}>Delete account</button>}
    </Sheet>
  );
}
