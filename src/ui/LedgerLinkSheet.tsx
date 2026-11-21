import { useEffect, useState } from "react";
import { ledgerBeforeBalance, linkLedger, showToast, unlinkedLedger, useTally, type LedgerEntry } from "../data/store";
import { formatMoney } from "../core/money";
import { t } from "../i18n";
import { Field, Sheet, Toggle } from "./components";

const day = (ms: number) => new Date(ms).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
const short = (ms: number) => new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });

const label = (l: LedgerEntry) => l.kind === "lent" ? t("Lent to {name}", { name: l.person })
  : l.kind === "borrowed" ? t("Borrowed from {name}", { name: l.person })
  : l.amount > 0 ? t("You paid {name} back", { name: l.person }) : t("{name} paid you back", { name: l.person });

/**
 * Money lent, borrowed or paid back that went through "UPI" or no account — so no balance moved —
 * put through the account it really came from or went into.
 */
export function LedgerLinkSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useTally();
  const targets = s.accounts.filter((a) => a.kind === "bank" || a.kind === "cash");
  const entries = unlinkedLedger(s);
  const [to, setTo] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [addEarlier, setAddEarlier] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTo(targets[0]?.id ?? "");
    setPicked(new Set(entries.map((l) => l.id)));
    setAddEarlier(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const acct = targets.find((a) => a.id === to);
  const chosen = entries.filter((l) => picked.has(l.id));
  const earlier = acct ? ledgerBeforeBalance(acct, chosen) : 0;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const link = () => {
    if (!acct) return;
    const undo = linkLedger(acct.id, chosen.map((l) => l.id), addEarlier && earlier !== 0);
    showToast(t("Moved {n} to {name}", { n: chosen.length, name: acct.name }), undo);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={t("Which account did this money go through?")}>
      {targets.length === 0 ? (
        <p className="t-muted small" style={{ margin: 0 }}>{t("Add the bank account you pay people from (Accounts → Add account), then come back here.")}</p>
      ) : entries.length === 0 ? (
        <p className="t-muted small" style={{ margin: 0 }}>{t("All your lending and borrowing goes through one of your accounts.")}</p>
      ) : (
        <>
          <p className="t-muted small" style={{ margin: 0 }}>{t("These went through “UPI” or no account, so no balance changed. Pick the account the money really left or came into.")}</p>
          <Field label={t("Account")}>
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {targets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          {acct && !acct.tracked && (
            <p className="tiny" style={{ margin: "-6px 0 0", color: "var(--warn)" }}>{t("{name} doesn't follow transactions, so its balance won't change. Turn that on by editing it in Accounts.", { name: acct.name })}</p>
          )}
          <div className="card flush divided pick-rows" style={{ background: "var(--surface-2)" }}>
            {entries.map((l) => (
              <label key={l.id} className="list-row" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} />
                <span className="grow col" style={{ minWidth: 0 }}>
                  <span className="small ellipsis">{label(l)}</span>
                  <span className="tiny t-muted">{day(l.occurredAt)}{l.account ? ` · ${l.account}` : ""}{l.note ? ` · ${l.note}` : ""}</span>
                </span>
                <span className={`num small${l.amount < 0 ? " in" : ""}`}>{l.amount < 0 ? "+" : "−"}{formatMoney(Math.abs(l.amount))}</span>
              </label>
            ))}
          </div>
          {acct && earlier !== 0 && (
            <Toggle checked={addEarlier} onChange={setAddEarlier}
              label={earlier < 0
                ? t("Also take the {amount} from before {date} out of {name}", { amount: formatMoney(-earlier), date: short(acct.updatedAt), name: acct.name })
                : t("Also add the {amount} from before {date} to {name}", { amount: formatMoney(earlier), date: short(acct.updatedAt), name: acct.name })}
              hint={t("Leave this off if the balance you entered on {date} already includes it.", { date: short(acct.updatedAt) })} />
          )}
          <button className="btn primary block" disabled={!acct || chosen.length === 0} onClick={link}>
            {chosen.length ? t("Move {n} to {name}", { n: chosen.length, name: acct?.name ?? "" }) : t("Pick what to move")}
          </button>
        </>
      )}
    </Sheet>
  );
}
