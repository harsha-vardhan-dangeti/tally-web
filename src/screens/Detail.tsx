import { useEffect, useState } from "react";
import {
  convertToEmi, deleteExpense, deleteLoan, expenseTitle, makeRecurring, saveRule, setSettings, share, showToast, SOURCE_LABEL, uid, updateExpense, useTally,
  type Expense,
} from "../data/store";
import { cardCycle } from "../core/cards";
import { emiFor, loanStatus } from "../core/loans";
import { useCloud } from "../data/cloud";
import { track } from "../data/telemetry";
import { payLink, shareOfPerson, splitNames } from "../core/people";
import { CURRENCIES, currencySymbol } from "../core/money";
import { t } from "../i18n";
import { shareText } from "../ui/share";
import { AccountHint, AccountSelect } from "../ui/AccountSelect";
import { categoryMeta, type Category } from "../core/categories";
import { formatMoney, parsePaise } from "../core/money";
import { Icon } from "../ui/icons";
import { CategoryIcon } from "../ui/icons";
import { Field, Sheet, Toggle } from "../ui/components";
import { CategorySelect } from "../ui/CategorySelect";

const toInput = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function Detail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const s = useTally();
  const cloud = useCloud();
  const [fxOpen, setFxOpen] = useState(false);
  const [emiOpen, setEmiOpen] = useState(false);
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

      <div className="row gap8">
        <Field label="Category">
          <CategorySelect label="Category" value={e.category} onChange={(category) => {
            // A subcategory belongs to its category; moving the expense drops one that doesn't exist there.
            set({ category, sub: e.sub && (s.settings.subcategories[category] ?? []).includes(e.sub) ? e.sub : undefined });
          }} />
        </Field>
        {((s.settings.subcategories[e.category] ?? []).length > 0 || e.sub) && (
          <Field label="Subcategory">
            <select value={e.sub ?? ""} onChange={(ev) => set({ sub: ev.target.value || undefined })}>
              <option value="">None</option>
              {[...new Set([...(s.settings.subcategories[e.category] ?? []), ...(e.sub ? [e.sub] : [])])].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
        )}
      </div>
      {e.merchant.trim().length >= 2 && openedWith !== null && e.category !== openedWith
        && !s.settings.rules.some((r) => r.match === e.merchant.trim().toLowerCase() && r.category === e.category) && (
        <button className="btn ghost small-btn" style={{ alignSelf: "flex-start", marginTop: -6 }} onClick={() => {
          saveRule({ id: uid(), match: e.merchant.trim().toLowerCase(), category: e.category, rename: "" });
          showToast(`From now on, ${e.merchant.trim()} is ${categoryMeta(e.category).title}`);
        }}>Always put {e.merchant.trim()} in {categoryMeta(e.category).title}</button>
      )}
      <div className="row gap8">
        <Field label="Paid from"><AccountSelect value={e.account} onChange={(account) => set({ account })} /></Field>
        <Field label="When">
          <input type="datetime-local" value={toInput(e.occurredAt)}
            onChange={(ev) => { const t = new Date(ev.target.value).getTime(); if (!Number.isNaN(t)) set({ occurredAt: t }); }} />
        </Field>
      </div>
      <AccountHint account={e.account} amount={0} />
      <Field label="Note"><textarea rows={2} value={e.note} onChange={(ev) => set({ note: ev.target.value })} /></Field>
      <TagsField tags={e.tags ?? []} onChange={(tags) => set({ tags: tags.length ? tags : undefined })} />

      <div className="card divided" style={{ background: "var(--surface-2)", padding: "0 14px" }}>
        <Toggle label="Split this expense" hint="Only your share counts toward budgets" checked={e.splitWays > 1}
          onChange={(v) => set({ splitWays: v ? Math.max(e.splitWays, 2) : 1 })} />
        {e.splitWays > 1 && (
          <div className="col gap8" style={{ padding: "12px 0" }}>
            <div className="row between">
              <span className="small">{e.shares ? <>Split unequally</> : <>Split <strong>{e.splitWays}</strong> ways</>} · you pay <strong>{formatMoney(share(e))}</strong></span>
              {e.shares ? (
                <button className="btn ghost small-btn" onClick={() => set({ myShare: undefined, shares: undefined })}>Split equally</button>
              ) : (
                <div className="row gap4">
                  <button className="icon-btn" aria-label="Fewer people" onClick={() => set({ splitWays: Math.max(2, e.splitWays - 1) })}>−</button>
                  <button className="icon-btn" aria-label="More people" onClick={() => set({ splitWays: Math.min(20, e.splitWays + 1) })}>+</button>
                </div>
              )}
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
                  <span className="small">{t("You owe {name} {amount}", { name: e.paidBy, amount: formatMoney(share(e)) })}</span>
                ) : splitNames(e.splitWith).map((n) => (
                  <div key={n} className="row between gap8">
                    <span className="small">{t("{name} owes you {amount}", { name: n, amount: formatMoney(shareOfPerson(e, n)) })}</span>
                    <button className="btn ghost small-btn" onClick={async () => {
                      const link = payLink(location.origin, { to: s.settings.payName || cloud.user?.name || "", amount: shareOfPerson(e, n),
                        currency: s.settings.currency, note: expenseTitle(e), upi: s.settings.upiId });
                      const result = await shareText(t("Hi {name}, your share for {what} comes to {amount}. You can pay here: {link}",
                        { name: n, what: expenseTitle(e), amount: formatMoney(shareOfPerson(e, n), { showPaise: true }), link }), t("Payment request"));
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

      <CardEmiBlock e={e} onConvert={() => setEmiOpen(true)} />

      <button className="btn danger block" onClick={() => { deleteExpense(e.id); onClose(); }}>Delete {expenseTitle(e)}</button>
      <EmiSheet e={emiOpen ? e : null} onClose={() => setEmiOpen(false)} />
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

/** Tags typed as "goa, work trip" or "#goa #work"; shown back as chips. */
function TagsField({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const s = useTally();
  const [text, setText] = useState("");
  const known = [...new Set(s.expenses.flatMap((x) => x.tags ?? []))].filter((t) => !tags.includes(t)).slice(0, 8);
  const add = (raw: string) => {
    const next = raw.split(/[,#\s]+/).map((x) => x.trim().toLowerCase().slice(0, 30)).filter(Boolean);
    if (next.length) onChange([...new Set([...tags, ...next])]);
    setText("");
  };
  return (
    <div className="col gap8">
      <label className="field">
        <span>Tags</span>
        <input type="text" value={text} placeholder={tags.length ? "Add another" : "goa, work trip…"} enterKeyHint="done"
          onChange={(ev) => setText(ev.target.value)} onBlur={() => add(text)}
          onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === ",") { ev.preventDefault(); add(text); } }} />
      </label>
      {(tags.length > 0 || known.length > 0) && (
        <div className="row gap4 wrap">
          {tags.map((t) => (
            <button key={t} className="chip on" onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>#{t} ×</button>
          ))}
          {known.map((t) => <button key={t} className="chip dashed" onClick={() => onChange([...tags, t])}>+ #{t}</button>)}
        </div>
      )}
    </div>
  );
}

/** On a card purchase: convert it to EMI, or, once converted, where the EMI plan stands. */
function CardEmiBlock({ e, onConvert }: { e: Expense; onConvert: () => void }) {
  const s = useTally();
  const card = s.accounts.find((a) => a.kind === "card" && a.name.trim().toLowerCase() === e.account.trim().toLowerCase());
  const loan = e.emiLoan ? s.loans.find((l) => l.id === e.emiLoan) : undefined;
  if (loan) {
    const st = loanStatus(loan, Date.now());
    return (
      <div className="card col gap8" style={{ background: "var(--surface-2)" }}>
        <span className="t-strong small">On EMI with {loan.lender || loan.account}</span>
        <span className="small">{loan.months} × {formatMoney(loan.emi)}{loan.ratePct ? ` at ${loan.ratePct}%` : " · no-cost"} · {st.paid} of {loan.months} billed</span>
        <span className="tiny t-muted">
          {st.outstanding ? `${formatMoney(st.outstanding)} still to be billed, blocked on the card's limit. ` : "Fully billed. "}
          Each month's EMI counts toward your budget instead of the whole purchase. Find it in Plan → Loans & EMIs.
        </span>
        <button className="btn ghost small-btn" style={{ alignSelf: "flex-start" }} onClick={() => {
          deleteLoan(loan.id);
          showToast("EMI undone · the purchase is back on the card");
        }}>Undo EMI</button>
      </div>
    );
  }
  if (!card || e.pending || e.paidBy) return null;
  return (
    <button className="btn block" onClick={onConvert}>
      <Icon name="card" size={18} />Convert to EMI
    </button>
  );
}

const MONTH_CHOICES = [3, 6, 9, 12, 18, 24];
const toDateInput = (ms: number) => new Date(ms).toLocaleDateString("en-CA");

/** Turn a card purchase into monthly instalments, as the bank does when you convert it. */
function EmiSheet({ e, onClose }: { e: Expense | null; onClose: () => void }) {
  const s = useTally();
  const [months, setMonths] = useState(6);
  const [rate, setRate] = useState("0");
  const [fee, setFee] = useState("");
  const [first, setFirst] = useState("");
  const [seen, setSeen] = useState<string | null>(null);
  const card = e ? s.accounts.find((a) => a.kind === "card" && a.name.trim().toLowerCase() === e.account.trim().toLowerCase()) : undefined;
  if ((e?.id ?? null) !== seen) {
    setSeen(e?.id ?? null);
    if (e) {
      setMonths(6); setRate("0"); setFee("");
      // The first EMI is billed on the next statement; without a statement day, a month from now.
      const now = new Date();
      const next = card?.statementDay && card.dueDay ? cardCycle(card.statementDay, card.dueDay, now).nextStatement
        : new Date(now.getFullYear(), now.getMonth() + 1, Math.min(now.getDate(), 28));
      setFirst(toDateInput(next.getTime()));
    }
  }
  if (!e || !card) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const ratePct = Number(rate);
  const validRate = rate.trim() !== "" && Number.isFinite(ratePct) && ratePct >= 0 && ratePct < 60;
  const emi = validRate ? emiFor(e.amount, ratePct, months) : 0;
  const interest = Math.max(0, emi * months - e.amount);
  const feeP = fee.trim() ? parsePaise(fee) : 0;
  const [y, m, d] = first.split("-").map(Number);
  const ready = validRate && emi > 0 && !!first && feeP !== null;

  return (
    <Sheet open onClose={onClose} title="Convert to EMI">
      <div className="card col gap4" style={{ background: "var(--surface-2)" }}>
        <span className="t-strong">{expenseTitle(e)} · {formatMoney(e.amount)}</span>
        <span className="tiny t-muted">On {card.name}</span>
      </div>
      <div className="col gap8">
        <span className="t-strong small">Months</span>
        <div className="row gap8 wrap" role="group" aria-label="Months">
          {MONTH_CHOICES.map((n) => (
            <button key={n} className={`chip${months === n ? " on" : ""}`} aria-pressed={months === n} onClick={() => setMonths(n)}>{n}</button>
          ))}
        </div>
      </div>
      <div className="row gap8">
        <Field label="Interest (% a year)">
          <input type="text" inputMode="decimal" value={rate} onChange={(ev) => setRate(ev.target.value)} placeholder="0 for no-cost EMI" />
        </Field>
        <Field label={`Processing fee (${currencySymbol()})`}>
          <input type="text" inputMode="decimal" value={fee} onChange={(ev) => setFee(ev.target.value)} placeholder="optional" />
        </Field>
      </div>
      <Field label="First EMI on"><input type="date" value={first} onChange={(ev) => setFirst(ev.target.value)} /></Field>
      {ready && (
        <div className="card col gap4" style={{ background: "var(--surface-2)" }} aria-live="polite">
          <span className="display num" style={{ fontSize: 24 }}>{months} × {formatMoney(emi)}</span>
          <span className="tiny t-muted">
            {ratePct ? `Interest ${formatMoney(interest)} in total` : "No-cost: you pay back just the price"}
            {feeP ? ` · ${formatMoney(feeP)} fee charged now` : ""}
          </span>
        </div>
      )}
      <p className="t-muted tiny" style={{ margin: 0 }}>
        The purchase moves off {card.name}'s balance and out of this month's budget. Each EMI is charged to {card.name} on its date and counts toward that
        month's budget. What's still to be billed stays blocked on the card's limit.
      </p>
      <button className="btn primary block" disabled={!ready} onClick={() => {
        const loan = convertToEmi(e, { months, ratePct, fee: feeP ?? 0, firstDueAt: new Date(y, m - 1, d, 12).getTime() });
        if (loan) showToast(`${months} EMIs of ${formatMoney(loan.emi)} on ${card.name}`);
        onClose();
      }}>Convert to {months} EMIs</button>
    </Sheet>
  );
}
