import { useEffect, useMemo, useState } from "react";
import {
  forgetMethod, linkGroups, previewLink, showToast, suggestAccount, unlinkedGroups, useTally, type LinkChoice, type MoneyGroup,
} from "../data/store";
import { formatMoney } from "../core/money";
import { Sheet, Toggle } from "./components";
import { Icon } from "./icons";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "42 expenses · ₹18,450 out · 2 incomes · ₹1,200 in · 1 bill". */
function groupLine(g: MoneyGroup): string {
  return [
    g.expenses.length ? plural(g.expenses.length, "expense") : "",
    g.ledger.length ? plural(g.ledger.length, "loan entry", "loan entries") : "",
    g.out ? `${formatMoney(g.out)} out` : "",
    g.incomes.length ? plural(g.incomes.length, "income") : "",
    g.in ? `${formatMoney(g.in)} in` : "",
    g.bills.length ? plural(g.bills.length, "bill") : "",
    g.loans.length ? plural(g.loans.length, "EMI") : "",
    g.rules.length ? plural(g.rules.length, "regular income") : "",
  ].filter(Boolean).join(" · ");
}

/**
 * Everything paid with "UPI", "Cash", "Credit card" or nothing — not one of your accounts, so no balance
 * moved — put on the account it really went through, with a preview of each balance before anything changes.
 */
export function LinkAccountsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useTally();
  const groups = useMemo(() => (open ? unlinkedGroups(s) : []), [open, s]);
  const targets = s.accounts.filter((a) => a.kind === "bank" || a.kind === "cash" || a.kind === "card");
  const [choices, setChoices] = useState<Record<string, LinkChoice>>({});
  const [addEarlier, setAddEarlier] = useState(false);
  useEffect(() => {
    if (!open) return;
    setChoices(Object.fromEntries(unlinkedGroups(s).map((g) => [g.key, { key: g.key, accountId: suggestAccount(g.key, s), remember: g.key !== "" }])));
    setAddEarlier(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = Object.values(choices).filter((c) => c.accountId && groups.some((g) => g.key === c.key));
  const preview = useMemo(() => previewLink(list, addEarlier, s), [list, addEarlier, s]);
  // Would "count them too" change anything? Only when some chosen entries were recorded before a balance was entered.
  const earlierMatters = useMemo(() => {
    const a = previewLink(list, false, s), b = previewLink(list, true, s);
    return a.some((x, i) => x.after !== b[i]?.after);
  }, [list, s]);
  const count = groups.filter((g) => choices[g.key]?.accountId).reduce((t, g) => t + g.expenses.length + g.incomes.length + g.ledger.length, 0);
  const remembered = Object.entries(s.settings.methodAccounts)
    .map(([key, id]) => ({ key, account: s.accounts.find((a) => a.id === id) }))
    .filter((x) => x.account);
  const set = (key: string, patch: Partial<LinkChoice>) => setChoices((c) => ({ ...c, [key]: { ...c[key], ...patch } }));

  const apply = () => {
    const undo = linkGroups(list, addEarlier);
    showToast(`Linked ${plural(count, "entry", "entries")} to your accounts`, undo);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Link to your accounts">
      {targets.length === 0 ? (
        <p className="t-muted small" style={{ margin: 0 }}>Add your bank account, cash and cards in Accounts first, then come back to link what you've logged.</p>
      ) : (
        <>
          {remembered.length > 0 && (
            <div className="card col gap8" style={{ background: "var(--surface-2)" }}>
              <span className="small t-strong">Already sent to an account automatically</span>
              {remembered.map((r) => (
                <div key={r.key} className="row between gap8" style={{ alignItems: "center" }}>
                  <span className="small">{r.key.toUpperCase() === r.key ? r.key : r.key.replace(/\b\w/g, (c) => c.toUpperCase())} → {r.account!.name}</span>
                  <button className="btn ghost small-btn" onClick={() => forgetMethod(r.key)}>Stop</button>
                </div>
              ))}
            </div>
          )}

          {groups.length === 0 ? (
            <p className="t-muted small" style={{ margin: 0 }}>Everything you've logged goes through one of your accounts.</p>
          ) : (
            <>
              <p className="t-muted small" style={{ margin: 0 }}>These went through something that isn't one of your accounts, so no balance changed for them. Pick the account each really came out of or went into.</p>
              <div className="col gap8">
                {groups.map((g) => {
                  const c = choices[g.key];
                  if (!c) return null;
                  return (
                    <div key={g.key} className="card col gap8">
                      <div className="col">
                        <span className="t-strong">{g.label}</span>
                        <span className="tiny t-muted">{groupLine(g)}</span>
                      </div>
                      <select aria-label={`Account for ${g.label}`} value={c.accountId} onChange={(e) => set(g.key, { accountId: e.target.value })}>
                        <option value="">Leave as it is</option>
                        {targets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      {c.accountId && g.key !== "" && (
                        <label className="row gap8 small" style={{ alignItems: "center", cursor: "pointer" }}>
                          <input type="checkbox" checked={c.remember} onChange={(e) => set(g.key, { remember: e.target.checked })} style={{ width: 18, height: 18 }} />
                          Use {targets.find((a) => a.id === c.accountId)?.name} for future “{g.label}” payments too
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>

              {earlierMatters && (
                <Toggle checked={addEarlier} onChange={setAddEarlier} label="Also count ones from before I entered each balance"
                  hint="Leave this off if the balances you entered already include them. Entries you logged after entering a balance always count." />
              )}

              {preview.length > 0 && (
                <div className="card col gap8" style={{ background: "var(--surface-2)" }}>
                  <span className="small t-strong">After linking</span>
                  {preview.map((p) => {
                    const sign = p.account.kind === "card" ? -1 : 1;
                    const show = (v: number) => `${sign * v < 0 ? "−" : ""}${formatMoney(Math.abs(v))}`;
                    return (
                      <div key={p.account.id} className="row between gap8 small">
                        <span>{p.account.name}{!p.account.tracked ? " (doesn't follow transactions)" : ""}</span>
                        <span className="num">{show(p.before)} <Icon name="next" size={12} /> <strong>{show(p.after)}</strong></span>
                      </div>
                    );
                  })}
                </div>
              )}

              <button className="btn primary block" disabled={list.length === 0} onClick={apply}>
                {list.length === 0 ? "Pick an account above" : count ? `Link ${plural(count, "entry", "entries")}` : "Link bills and regular income"}
              </button>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
