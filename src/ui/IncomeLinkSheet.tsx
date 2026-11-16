import { useEffect, useState } from "react";
import { incomeBeforeBalance, linkIncomes, showToast, unlinkedIncomeRules, unlinkedIncomes, useTally } from "../data/store";
import { formatMoney } from "../core/money";
import { Field, Sheet, Toggle } from "./components";

const day = (t: number) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
const short = (t: number) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/**
 * Income that went into "Bank", "UPI" or nothing — not one of your accounts — moved into the account
 * it really landed in, along with regular incomes so next month's goes there too.
 */
export function IncomeLinkSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useTally();
  const targets = s.accounts.filter((a) => a.kind === "bank" || a.kind === "cash");
  const incomes = unlinkedIncomes(s);
  const rules = unlinkedIncomeRules(s);
  const [to, setTo] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [addEarlier, setAddEarlier] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTo(targets[0]?.id ?? "");
    setPicked(new Set([...incomes.map((x) => x.id), ...rules.map((r) => r.id)]));
    setAddEarlier(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const acct = targets.find((a) => a.id === to);
  const chosen = incomes.filter((x) => picked.has(x.id));
  const chosenRules = rules.filter((r) => picked.has(r.id));
  const total = chosen.reduce((t, x) => t + x.amount, 0);
  const earlier = acct ? incomeBeforeBalance(acct, chosen) : 0;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const link = () => {
    if (!acct) return;
    const undo = linkIncomes(acct.id, chosen.map((x) => x.id), chosenRules.map((r) => r.id), addEarlier && earlier > 0);
    const parts = [chosen.length ? `${chosen.length} ${chosen.length === 1 ? "income" : "incomes"}` : "", chosenRules.length ? `${chosenRules.length} regular ${chosenRules.length === 1 ? "income" : "incomes"}` : ""].filter(Boolean);
    showToast(`Moved ${parts.join(" and ")} to ${acct.name}`, undo);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Which account gets this income?">
      {targets.length === 0 ? (
        <p className="t-muted small" style={{ margin: 0 }}>Add the bank account your income lands in (Accounts → Add account), then come back here.</p>
      ) : incomes.length + rules.length === 0 ? (
        <p className="t-muted small" style={{ margin: 0 }}>All your income goes into one of your accounts.</p>
      ) : (
        <>
          <p className="t-muted small" style={{ margin: 0 }}>These went into “Bank”, “UPI” or no account, so no balance includes them. Pick the account they landed in.</p>
          <Field label="Into">
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {targets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          {acct && !acct.tracked && <p className="tiny" style={{ margin: "-6px 0 0", color: "var(--warn)" }}>{acct.name} doesn't update from transactions, so its balance won't change. Turn that on by editing it in Accounts.</p>}

          {rules.length > 0 && (
            <div className="card flush divided pick-rows" style={{ background: "var(--surface-2)", maxHeight: "none" }}>
              {rules.map((r) => (
                <label key={r.id} className="list-row" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                  <span className="grow col" style={{ minWidth: 0 }}>
                    <span className="small t-strong ellipsis">{r.source || "Regular income"}</span>
                    <span className="tiny t-muted">Every month on the {ordinal(r.day)} · from now on</span>
                  </span>
                  <span className="num small">{formatMoney(r.amount)}</span>
                </label>
              ))}
            </div>
          )}

          {incomes.length > 0 && (
            <div className="card flush divided pick-rows" style={{ background: "var(--surface-2)" }}>
              {incomes.map((x) => (
                <label key={x.id} className="list-row" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={picked.has(x.id)} onChange={() => toggle(x.id)} />
                  <span className="grow col" style={{ minWidth: 0 }}>
                    <span className="small ellipsis">{x.source || "Income"}</span>
                    <span className="tiny t-muted">{day(x.receivedAt)}{x.account ? ` · ${x.account}` : ""}</span>
                  </span>
                  <span className="num small">{formatMoney(x.amount)}</span>
                </label>
              ))}
            </div>
          )}

          {acct && earlier > 0 && (
            <Toggle checked={addEarlier} onChange={setAddEarlier} label={`Also add the ${formatMoney(earlier)} received before ${short(acct.updatedAt)} to ${acct.name}`}
              hint={`Leave this off if the balance you entered on ${short(acct.updatedAt)} already includes it.`} />
          )}
          <button className="btn primary block" disabled={!acct || chosen.length + chosenRules.length === 0} onClick={link}>
            {chosen.length + chosenRules.length === 0 ? "Pick what to move" : `Move ${chosen.length ? formatMoney(total) : `${chosenRules.length} regular`} to ${acct?.name}`}
          </button>
        </>
      )}
    </Sheet>
  );
}
