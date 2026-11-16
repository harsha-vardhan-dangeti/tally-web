import { accountNamed, cardLimitUsage, creditLeft, liveBalance, saveAccount, showToast, useTally } from "../data/store";
import { formatMoney } from "../core/money";

const GENERIC = ["UPI", "Cash", "Credit card"];
const key = (v: string) => v.trim().toLowerCase();

/**
 * Where money is paid from (or goes into): your bank and cash accounts, your credit cards with the
 * credit left on each, then the general methods. The same list everywhere you pick an account.
 */
export function AccountSelect({ value, onChange, label, id }: { value: string; onChange: (v: string) => void; label?: string; id?: string }) {
  const s = useTally();
  const own = s.accounts.filter((a) => a.kind !== "card");
  const cards = s.accounts.filter((a) => a.kind === "card");
  const taken = new Set(s.accounts.map((a) => key(a.name)));
  // With your cards listed, "Credit card" alone would leave the expense on no card: offered only if already chosen.
  const generic = GENERIC.filter((g) => !(cards.length && key(g) === "credit card" && key(value) !== "credit card"));
  const other = [...generic, ...(value.trim() && !accountNamed(s, value) && !GENERIC.some((g) => key(g) === key(value)) ? [value.trim()] : [])]
    .filter((n) => !taken.has(key(n)));
  return (
    <select id={id} aria-label={label} value={accountNamed(s, value)?.name ?? value} onChange={(e) => onChange(e.target.value)}>
      {own.length > 0 && (
        <optgroup label="Your accounts">
          {own.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
        </optgroup>
      )}
      {cards.length > 0 && (
        <optgroup label="Credit cards">
          {cards.map((a) => {
            const u = cardLimitUsage(a, s);
            return <option key={a.id} value={a.name}>{a.name}{u ? ` · ${u.available >= 0 ? `${formatMoney(u.available)} left` : "over limit"}` : ""}</option>;
          })}
        </optgroup>
      )}
      <optgroup label={own.length || cards.length ? "Other" : "Paid with"}>
        {other.map((n) => <option key={n} value={n}>{n}</option>)}
      </optgroup>
    </select>
  );
}

/**
 * A line under an amount: the credit left on the chosen card (with a warning when the amount
 * won't fit), or the bank balance when it would go below zero.
 */
export function AccountHint({ account, amount }: { account: string; amount: number }) {
  const s = useTally();
  const left = creditLeft(account, s);
  if (left) {
    const { usage, card } = left;
    const after = usage.available - amount;
    const tone = after < 0 ? "var(--danger)" : usage.used + amount >= usage.limit * 0.8 ? "var(--warn)" : "var(--muted)";
    return (
      <span className="tiny" style={{ color: tone }} aria-live="polite">
        {after < 0
          ? `${formatMoney(-after)} more than the ${formatMoney(Math.max(usage.available, 0))} left on ${card.name}'s limit`
          : `${formatMoney(usage.available)} left on ${card.name}${amount ? ` · ${formatMoney(after)} after this` : ""}`}
      </span>
    );
  }
  const acct = accountNamed(s, account);
  if (acct && acct.kind !== "card" && acct.tracked && amount > 0) {
    const after = liveBalance(acct, s) - amount;
    if (after < 0) return <span className="tiny" style={{ color: "var(--warn)" }}>{acct.name} would go {formatMoney(-after)} below zero</span>;
  }
  return null;
}

/**
 * Says whether the chosen account's balance will move. For money coming in, it also says when it
 * won't because the money goes to something that isn't one of your accounts.
 */
export function AccountNote({ name, what, incoming }: { name: string; what: string; incoming?: boolean }) {
  const s = useTally();
  const acct = accountNamed(s, name);
  if (!acct) {
    if (!incoming || !s.accounts.some((a) => a.kind === "bank" || a.kind === "cash")) return null;
    return <p className="tiny" style={{ margin: "-6px 0 0", color: "var(--warn)" }}>“{name || "Nothing"}” isn't one of your accounts, so no balance changes. Pick the account it lands in.</p>;
  }
  if (acct.currency && acct.currency !== s.settings.currency) {
    return <p className="t-muted tiny" style={{ margin: "-6px 0 0" }}>{acct.name} is in {acct.currency}, so you update its balance yourself in Accounts.</p>;
  }
  if (!acct.tracked) {
    return (
      <div className="row between gap8" style={{ margin: "-6px 0 0", alignItems: "center" }}>
        <span className="tiny" style={{ color: "var(--warn)" }}>{acct.name}'s balance only changes when you edit it, so this won't move it.</span>
        <button type="button" className="btn ghost small-btn" onClick={() => {
          saveAccount({ ...acct, balance: liveBalance(acct, s), tracked: true, updatedAt: Date.now(), balanceSetAt: Date.now() });
          showToast(`${acct.name} now follows your expenses and income`);
        }}>Follow transactions</button>
      </div>
    );
  }
  return (
    <p className="t-muted tiny" style={{ margin: "-6px 0 0" }}>
      {what} {incoming ? "goes into" : "comes out of"} {acct.name}'s balance in Accounts.
    </p>
  );
}
