import { useEffect, useState } from "react";
import { deleteExpense, expenseTitle, makeRecurring, saveRule, setSettings, share, showToast, SOURCE_LABEL, uid, updateExpense, useTally, type Expense } from "../data/store";
import { useCloud } from "../data/cloud";
import { track } from "../data/telemetry";
import { payLink, sharePerPerson, splitNames } from "../core/people";
import { CURRENCIES, currencySymbol } from "../core/money";
import { t } from "../i18n";
import { shareText } from "../ui/share";
import { categoryMeta, pickableCategories, type Category } from "../core/categories";
import { formatMoney, parsePaise } from "../core/money";
import { Icon } from "../ui/icons";
import { CategoryIcon } from "../ui/icons";
import { Field, Sheet, Toggle } from "../ui/components";

const toInput = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function Detail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const s = useTally();
  const cloud = useCloud();
  const [fxOpen, setFxOpen] = useState(false);
  const e: Expense | undefined = s.expenses.find((x) => x.id === id);
  const [amount, setAmount] = useState("");
  // The category this sheet opened with: after changing it, offer to make the change a rule.
  const [openedWith, setOpenedWith] = useState<Category | null>(null);
  useEffect(() => { if (e) { setAmount(String(e.amount / 100)); setOpenedWith(e.category); setFxOpen(!!e.fx); } }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Amount edits from the foreign-currency fields land in the expense; keep the amount field in step.
  useEffect(() => { if (e) setAmount(String(e.amount / 100)); }, [e?.amount]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!e) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const set = (patch: Partial<Expense>) => updateExpense(e.id, patch);
  const commitAmount = () => {
    const p = parsePaise(amount);
    if (p && p !== e.amount) set({ amount: p });
    else setAmount(String(e.amount / 100));
  };

  return (
    <Sheet open={!!id} onClose={() => { commitAmount(); onClose(); }} title={categoryMeta(e.category).title}>
      <div className="col gap8" style={{ alignItems: "center", textAlign: "center" }}>
        <CategoryIcon category={e.category} size={56} />
        <input type="text" aria-label="Merchant" value={e.merchant} placeholder="Merchant"
          onChange={(ev) => set({ merchant: ev.target.value })}
          style={{ textAlign: "center", fontWeight: 600, background: "transparent", border: 0 }} />
        <div className="row" style={{ justifyContent: "center", gap: 2 }}>
          <span className="display" style={{ fontSize: 40, color: "var(--muted)" }}>{currencySymbol()}</span>
          <input type="text" inputMode="decimal" aria-label="Amount in rupees" value={amount} onChange={(ev) => setAmount(ev.target.value)}
            onBlur={commitAmount} className="display num"
            style={{ fontSize: 40, fontWeight: 700, background: "transparent", border: 0, width: `${Math.max(amount.length, 1) + 1}ch`, padding: 0 }} />
        </div>
        <span className="t-muted small">{new Date(e.occurredAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · {SOURCE_LABEL[e.source]}</span>
        {!fxOpen && (
          <button className="btn ghost small-btn" onClick={() => setFxOpen(true)}><Icon name="globe" size={14} />{t("Paid in another currency?")}</button>
        )}
      </div>

      {fxOpen && <ForeignAmount e={e} onRemove={() => { set({ fx: undefined }); setFxOpen(false); }} />}

      {e.pending && (
        <div className="card" style={{ background: "var(--warn-soft)" }}>
          <p className="small" style={{ margin: "0 0 10px", color: "var(--warn)" }}>Captured automatically. It won't count toward budgets until you confirm.</p>
          <button className="btn primary block" onClick={() => set({ pending: false })}>Confirm this expense</button>
        </div>
      )}

      <Field label="Category">
        <select value={e.category} onChange={(ev) => set({ category: ev.target.value as Category })}>
          {pickableCategories(e.category).map((c) => <option key={c} value={c}>{categoryMeta(c).title}</option>)}
        </select>
      </Field>
      {e.merchant.trim().length >= 2 && openedWith !== null && e.category !== openedWith
        && !s.settings.rules.some((r) => r.match === e.merchant.trim().toLowerCase() && r.category === e.category) && (
        <button className="btn ghost small-btn" style={{ alignSelf: "flex-start", marginTop: -6 }} onClick={() => {
          saveRule({ id: uid(), match: e.merchant.trim().toLowerCase(), category: e.category, rename: "" });
          showToast(`From now on, ${e.merchant.trim()} is ${categoryMeta(e.category).title}`);
        }}>Always put {e.merchant.trim()} in {categoryMeta(e.category).title}</button>
      )}
      <div className="row gap8">
        <Field label="Paid from"><input type="text" value={e.account} onChange={(ev) => set({ account: ev.target.value })} /></Field>
        <Field label="When">
          <input type="datetime-local" value={toInput(e.occurredAt)}
            onChange={(ev) => { const t = new Date(ev.target.value).getTime(); if (!Number.isNaN(t)) set({ occurredAt: t }); }} />
        </Field>
      </div>
      <Field label="Note"><textarea rows={2} value={e.note} onChange={(ev) => set({ note: ev.target.value })} /></Field>

      <div className="card divided" style={{ background: "var(--surface-2)", padding: "0 14px" }}>
        <Toggle label="Split this expense" hint="Only your share counts toward budgets" checked={e.splitWays > 1}
          onChange={(v) => set({ splitWays: v ? Math.max(e.splitWays, 2) : 1 })} />
        {e.splitWays > 1 && (
          <div className="col gap8" style={{ padding: "12px 0" }}>
            <div className="row between">
              <span className="small">Split <strong>{e.splitWays}</strong> ways · you pay <strong>{formatMoney(share(e))}</strong></span>
              <div className="row gap4">
                <button className="icon-btn" aria-label="Fewer people" onClick={() => set({ splitWays: Math.max(2, e.splitWays - 1) })}>−</button>
                <button className="icon-btn" aria-label="More people" onClick={() => set({ splitWays: Math.min(20, e.splitWays + 1) })}>+</button>
              </div>
            </div>
            <input type="text" placeholder={t("With (names, separated by commas)")} aria-label={t("Split with")} value={e.splitWith} onChange={(ev) => set({ splitWith: ev.target.value })} />
            {splitNames(e.splitWith).length > 0 && (
              <label className="field">
                <span>{t("Who paid?")}</span>
                <select value={e.paidBy ?? ""} onChange={(ev) => set({ paidBy: ev.target.value || undefined })}>
                  <option value="">{t("You")}</option>
                  {splitNames(e.splitWith).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
            {splitNames(e.splitWith).length > 0 && (
              <div className="col gap4">
                {e.paidBy ? (
                  <span className="small">{t("You owe {name} {amount}", { name: e.paidBy, amount: formatMoney(sharePerPerson(e)) })}</span>
                ) : splitNames(e.splitWith).map((n) => (
                  <div key={n} className="row between gap8">
                    <span className="small">{t("{name} owes you {amount}", { name: n, amount: formatMoney(sharePerPerson(e)) })}</span>
                    <button className="btn ghost small-btn" onClick={async () => {
                      const link = payLink(location.origin, { to: s.settings.payName || cloud.user?.name || "", amount: sharePerPerson(e),
                        currency: s.settings.currency, note: expenseTitle(e), upi: s.settings.upiId });
                      const result = await shareText(t("Hi {name}, your share for {what} comes to {amount}. You can pay here: {link}",
                        { name: n, what: expenseTitle(e), amount: formatMoney(sharePerPerson(e), { showPaise: true }), link }), t("Payment request"));
                      if (result === "copied") showToast(t("Message copied. Paste it in any chat."));
                      if (result === "shared" || result === "copied") track("pay_request_shared", { via: result });
                    }}>{t("Ask to pay")}</button>
                  </div>
                ))}
                <span className="tiny t-muted">{t("Balances with each person are in People.")}</span>
              </div>
            )}
          </div>
        )}
        <Toggle label="Repeat monthly" hint="Shows in Plan with a reminder" checked={e.recurring}
          onChange={(v) => (v ? makeRecurring(e) : set({ recurring: false }))} />
        <Toggle label="Exclude from budget" hint="For reimbursable or one-off spends" checked={e.exclude} onChange={(v) => set({ exclude: v })} />
      </div>

      <button className="btn danger block" onClick={() => { deleteExpense(e.id); onClose(); }}>Delete {expenseTitle(e)}</button>
    </Sheet>
  );
}

/** An amount paid abroad: what was paid there and the rate, which set the amount in the home currency. */
function ForeignAmount({ e, onRemove }: { e: Expense; onRemove: () => void }) {
  const s = useTally();
  const home = s.settings.currency;
  const others = CURRENCIES.filter((c) => c.code !== home);
  const [currency, setCurrency] = useState(e.fx?.currency ?? (home === "USD" ? "EUR" : "USD"));
  const [paid, setPaid] = useState(e.fx ? String(e.fx.amount / 100) : "");
  const [rate, setRate] = useState(String(e.fx?.rate ?? s.settings.fxRates[e.fx?.currency ?? currency] ?? ""));
  const apply = (cur: string, paidText: string, rateText: string) => {
    const p = parsePaise(paidText);
    const r = Number(rateText);
    if (!p || !(r > 0) || !Number.isFinite(r)) return;
    updateExpense(e.id, { fx: { currency: cur, amount: p, rate: r }, amount: Math.round(p * r) });
    setSettings({ fxRates: { ...s.settings.fxRates, [cur]: r } });
  };
  return (
    <div className="card col gap8" style={{ background: "var(--surface-2)" }}>
      <div className="row between"><span className="t-strong small">{t("Paid in another currency")}</span>
        <button className="btn ghost small-btn" onClick={onRemove}>{t("Remove")}</button></div>
      <div className="row gap8">
        <Field label={t("Currency")}>
          <select value={currency} onChange={(ev) => {
            const c = ev.target.value; setCurrency(c);
            const known = s.settings.fxRates[c]; if (known) setRate(String(known));
            apply(c, paid, known ? String(known) : rate);
          }}>
            {others.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
        </Field>
        <Field label={t("Amount paid")}>
          <input type="text" inputMode="decimal" value={paid} onChange={(ev) => setPaid(ev.target.value)} onBlur={() => apply(currency, paid, rate)} placeholder="25" />
        </Field>
      </div>
      <Field label={t("1 {code} in {home}", { code: currency, home })}>
        <input type="text" inputMode="decimal" value={rate} onChange={(ev) => setRate(ev.target.value)} onBlur={() => apply(currency, paid, rate)} placeholder="83.2" />
      </Field>
      <span className="tiny t-muted">
        {e.fx ? t("{paid} at {rate} = {home}", { paid: formatMoney(e.fx.amount, { currency: e.fx.currency, showPaise: true }), rate: e.fx.rate, home: formatMoney(e.amount, { showPaise: true }) })
          : t("Use the rate on your card statement. Tally remembers it for next time.")}
      </span>
    </div>
  );
}
