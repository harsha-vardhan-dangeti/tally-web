import { useMemo, useState } from "react";
import {
  ACCOUNT_KIND_LABEL, accountsNow, addTransfer, cardStatus, deleteAccount, deleteScheduledTransfer, deleteTransfer, homeBalance, liveBalance, moneyIn,
  saveAccount, saveScheduledTransfer, setSettings, showToast, uid, useTally, type Account, type AccountKind,
} from "../data/store";
import { monthKey } from "../core/budget";
import { CURRENCIES } from "../core/money";
import { Toggle } from "../ui/components";
import { netWorthSeries } from "../core/reports";
import { formatMoney, parsePaise, currencySymbol } from "../core/money";
import { Icon } from "../ui/icons";
import { Empty, Field, Sheet } from "../ui/components";
import { ChartCard, DataTable, TrendLine } from "../ui/charts";
import { ProfileButton } from "../ui/ProfileMenu";

const GROUPS: { kinds: AccountKind[]; title: string }[] = [
  { kinds: ["bank", "cash"], title: "Cash and bank" },
  { kinds: ["investment"], title: "Investments" },
  { kinds: ["card"], title: "Credit cards" },
];

/** Accounts: what you have and owe, how it has moved, and money moved between accounts. */
export function Accounts() {
  const s = useTally();
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [moving, setMoving] = useState(false);
  const [allTransfers, setAllTransfers] = useState(false);
  const now = new Date();
  const series = useMemo(() => netWorthSeries(accountsNow(s), now, 12, s.loans), [s.accounts, s.loans, s.expenses, s.incomes]); // eslint-disable-line react-hooks/exhaustive-deps
  const latest = series[series.length - 1] ?? { assets: 0, debts: 0, net: 0 };
  // Only months with a recorded balance are worth charting.
  const charted = series.slice(series.findIndex((p) => p.assets !== 0 || p.debts !== 0));
  const prev = charted.length > 1 ? charted[charted.length - 2].net : null;
  const signed = (v: number) => `${v < 0 ? "−" : ""}${formatMoney(Math.abs(v))}`;

  return (
    <div className="page wide">
      <header className="page-head">
        <h1 className="display">Accounts</h1>
        <ProfileButton />
      </header>
      <div className="row gap8 wrap span-2">
        {s.accounts.length >= 2 && <button className="btn" onClick={() => setMoving(true)}><Icon name="transfer" size={16} />Transfer</button>}
        <button className="btn primary" onClick={() => setEditing("new")}><Icon name="plus" size={16} />Add account</button>
      </div>

      <section className="card networth span-2">
        <div className="col gap4">
          <span className="eyebrow">Net worth</span>
          <span className="display num networth-value">{s.accounts.length ? signed(latest.net) : "—"}</span>
          {prev !== null && latest.net !== prev && (
            <span className={`small t-strong ${latest.net > prev ? "in" : "out"}`}>
              {latest.net > prev ? "▲" : "▼"} {formatMoney(Math.abs(latest.net - prev))} since last month
            </span>
          )}
        </div>
        <dl className="networth-split">
          <div><dt>You have</dt><dd className="num">{formatMoney(latest.assets)}</dd></div>
          <div><dt>You owe</dt><dd className="num">{formatMoney(latest.debts)}</dd></div>
        </dl>
      </section>

      {s.accounts.length === 0 ? (
        <div className="card span-2">
          <Empty title="No accounts yet" body="Add your bank accounts, cards, cash and investments. Balances are entered by you, and Tally keeps each month's so you can see net worth change."
            action={<button className="btn primary" onClick={() => setEditing("new")}>Add an account</button>} />
        </div>
      ) : (
        <>
          {charted.length > 1 && (
            <ChartCard className="span-2" title="Net worth over time" subtitle="Month-end balances, from the balances you've recorded each month"
              table={<DataTable head={["Month", "You have", "You owe", "Net worth"]}
                rows={charted.map((p) => [p.month.toLocaleDateString([], { month: "short", year: "numeric" }), formatMoney(p.assets), formatMoney(p.debts), signed(p.net)])} />}>
              <TrendLine valueLabel="net worth" ariaLabel={`Net worth over ${charted.length} months, now ${signed(latest.net)}`}
                points={charted.map((p) => ({ key: p.month.toISOString(), label: p.month.toLocaleDateString([], { month: "short" }),
                  title: p.month.toLocaleDateString([], { month: "long", year: "numeric" }), value: p.net }))} />
            </ChartCard>
          )}

          {GROUPS.map((g) => {
            const list = s.accounts.filter((a) => g.kinds.includes(a.kind));
            if (!list.length) return null;
            const total = list.reduce((t, a) => t + (a.kind === "card" ? -homeBalance(a, s) : homeBalance(a, s)), 0);
            return (
              <section key={g.title} className="col gap8">
                <div className="section-title"><span>{g.title}</span><span className="t-muted num">{signed(total)}</span></div>
                <div className="card flush divided">
                  {list.map((acct) => (
                    <button key={acct.id} className="list-row row-btn" onClick={() => setEditing(acct)}>
                      <span className={`acct-icon ${acct.kind}`}><Icon name={acct.kind === "card" ? "card" : acct.kind === "investment" ? "trend" : acct.kind === "cash" ? "bag" : "home"} size={18} /></span>
                      <span className="grow col">
                        <span className="t-strong">{acct.name}</span>
                        <span className="t-muted tiny">{ACCOUNT_KIND_LABEL[acct.kind]} · {acct.tracked ? "follows your expenses and income" : `updated ${new Date(acct.updatedAt).toLocaleDateString([], { day: "numeric", month: "short" })}`}</span>
                        <CardLine acct={acct} />
                      </span>
                      <AccountBalance acct={acct} />
                    </button>
                  ))}
                </div>
              </section>
            );
          })}

          {s.settings.scheduledTransfers.length > 0 && (
            <section className="col gap8">
              <div className="section-title"><span>Repeating transfers</span></div>
              <div className="card flush divided">
                {s.settings.scheduledTransfers.map((r) => {
                  const name = (id: string) => s.accounts.find((x) => x.id === id)?.name ?? "deleted account";
                  return (
                    <div key={r.id} className="list-row">
                      <span className="acct-icon"><Icon name="repeat" size={18} /></span>
                      <span className="grow col" style={{ minWidth: 0 }}>
                        <span className="t-strong ellipsis">{name(r.fromId)} → {name(r.toId)}</span>
                        <span className="t-muted tiny ellipsis">Every month on the {ordinal(r.day)}{r.note ? ` · ${r.note}` : ""}</span>
                      </span>
                      <span className="t-strong num">{formatMoney(r.amount)}</span>
                      <button className="icon-btn" aria-label={`Stop repeating ${formatMoney(r.amount)} from ${name(r.fromId)}`} onClick={() => {
                        deleteScheduledTransfer(r.id);
                        showToast("Stopped. Transfers already made stay.", () => saveScheduledTransfer(r));
                      }}><Icon name="close" size={18} /></button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {s.transfers.length > 0 && (
            <section className="col gap8">
              <div className="section-title"><span>Transfers</span>
                {s.transfers.length > 5 && <button className="btn ghost" onClick={() => setAllTransfers(!allTransfers)}>{allTransfers ? "Show fewer" : `Show all ${s.transfers.length}`}</button>}
              </div>
              <div className="card flush divided">
                {(allTransfers ? s.transfers : s.transfers.slice(0, 5)).map((t) => {
                  const name = (id: string, fallback: string) => s.accounts.find((x) => x.id === id)?.name ?? fallback;
                  return (
                    <div key={t.id} className="list-row">
                      <span className="acct-icon"><Icon name="transfer" size={18} /></span>
                      <span className="grow col" style={{ minWidth: 0 }}>
                        <span className="t-strong ellipsis">{name(t.fromId, t.fromName)} → {name(t.toId, t.toName)}</span>
                        <span className="t-muted tiny ellipsis">
                          {new Date(t.occurredAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}{t.note ? ` · ${t.note}` : ""}
                        </span>
                      </span>
                      <span className="t-strong num">{formatMoney(t.amount)}</span>
                      <button className="icon-btn" aria-label={`Remove transfer of ${formatMoney(t.amount)} and put both balances back`} onClick={() => deleteTransfer(t.id)}>
                        <Icon name="trash" size={18} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      <AccountEditor value={editing} onClose={() => setEditing(null)} />
      <TransferSheet open={moving} onClose={() => setMoving(false)} />
    </div>
  );
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const shortDate = (d: Date) => d.toLocaleDateString([], { day: "numeric", month: "short" });

/** A card shows what's owed as a negative; money left over on a card shows as positive. */
function AccountBalance({ acct }: { acct: Account }) {
  const s = useTally();
  const live = liveBalance(acct, s);
  const value = acct.kind === "card" ? -live : live;
  const foreign = acct.currency && acct.currency !== s.settings.currency;
  return (
    <span className="col" style={{ alignItems: "flex-end" }}>
      <span className="t-strong num" style={{ color: value < 0 ? "var(--warn)" : undefined }}>{formatMoney(value, foreign ? { currency: acct.currency } : {})}</span>
      {foreign && <span className="tiny t-muted num">{s.settings.fxRates[acct.currency!] ? `≈ ${formatMoney(acct.kind === "card" ? -homeBalance(acct, s) : homeBalance(acct, s))}` : "no rate set"}</span>}
    </span>
  );
}

/** A credit card's bill: what's due and when, and what's been spent since the statement. */
function CardLine({ acct }: { acct: Account }) {
  const s = useTally();
  const bill = cardStatus(acct, s);
  if (!bill) return null;
  const soon = bill.due && bill.due.date.getTime() - Date.now() < 4 * 86_400_000;
  return (
    <span className="tiny" style={{ color: soon ? "var(--warn)" : "var(--muted)" }}>
      {bill.due ? `${formatMoney(bill.due.amount)} due ${shortDate(bill.due.date)}` : `Next statement ${shortDate(bill.nextStatement)}`}
      {bill.unbilled ? ` · ${formatMoney(bill.unbilled)} spent since the statement` : ""}
    </span>
  );
}

const today = () => new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd in local time

function TransferSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useTally();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [seen, setSeen] = useState(false);
  if (open !== seen) {
    setSeen(open);
    if (open) {
      // Most transfers leave a bank: start there, going to the first other account.
      const from = s.accounts.find((a) => a.kind === "bank") ?? s.accounts[0];
      setFromId(from?.id ?? "");
      setToId(s.accounts.find((a) => a.id !== from?.id)?.id ?? "");
      setAmount("");
      setDate(today());
      setNote("");
      setRepeat(false);
    }
  }
  const from = s.accounts.find((a) => a.id === fromId);
  const to = s.accounts.find((a) => a.id === toId);
  const paise = parsePaise(amount) ?? 0;
  const ready = from && to && from.id !== to.id && paise > 0 && date;
  const shown = (a: Account) => formatMoney(a.kind === "card" ? -liveBalance(a, s) : liveBalance(a, s));
  const after = (a: Account, n: number) => shown(moneyIn(a, n));

  const save = () => {
    if (!ready) return;
    const [y, m, d] = date.split("-").map(Number);
    const at = new Date(y, m - 1, d, 12);
    const isToday = at.toDateString() === new Date().toDateString();
    const t = addTransfer({ fromId: from.id, toId: to.id, amount: paise, note: note.trim(), occurredAt: isToday ? Date.now() : at.getTime() });
    if (t) showToast(`Moved ${formatMoney(paise)} from ${from.name} to ${to.name}`, () => deleteTransfer(t.id, false));
    if (repeat) {
      // This month's is the one just made; the next comes on the same day next month.
      saveScheduledTransfer({ id: uid(), fromId: from.id, toId: to.id, amount: paise, day: Math.min(d, 28), note: note.trim(),
        lastLoggedMonth: monthKey(at) === monthKey(new Date()) ? monthKey(at) : "" });
    }
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Transfer between accounts">
      <div className="row gap8">
        <Field label="From">
          <select value={fromId} onChange={(e) => { setFromId(e.target.value); if (e.target.value === toId) setToId(fromId); }}>
            {s.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="To">
          <select value={toId} onChange={(e) => { setToId(e.target.value); if (e.target.value === fromId) setFromId(toId); }}>
            {s.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="row gap8">
        <Field label={`Amount (${currencySymbol()})`}>
          <input type="text" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" />
        </Field>
        <Field label="Date"><input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="Note"><input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional, like “Card bill”" /></Field>
      <div className="card" style={{ background: "var(--surface-2)", padding: "0 14px" }}>
        <Toggle label="Repeat every month" hint={`On the ${ordinal(Math.min(Number(date.split("-")[2]) || 1, 28))}, like a SIP or rent to a flatmate`} checked={repeat} onChange={setRepeat} />
      </div>

      {from && to && from.id !== to.id && (
        <div className="card col gap4 small" style={{ background: "var(--surface-2)" }} aria-live="polite">
          <div className="row between"><span className="t-muted">{from.name}</span><span className="num">{shown(from)} → <b>{after(from, -paise)}</b></span></div>
          <div className="row between"><span className="t-muted">{to.name}</span><span className="num">{shown(to)} → <b>{after(to, paise)}</b></span></div>
          <span className="t-muted tiny">
            {to.kind === "card" ? "Paying a card lowers what you owe. " : ""}A transfer isn't spending, so your budget doesn't change.
          </span>
        </div>
      )}

      <button className="btn primary block" disabled={!ready} onClick={save}>{paise ? `Transfer ${formatMoney(paise)}` : "Enter an amount"}</button>
    </Sheet>
  );
}

function AccountEditor({ value, onClose }: { value: Account | "new" | null; onClose: () => void }) {
  const s = useTally();
  const acct = value && value !== "new" ? value : null;
  const home = s.settings.currency;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AccountKind>("bank");
  const [balance, setBalance] = useState("");
  const [tracked, setTracked] = useState(true);
  const [currency, setCurrency] = useState(home);
  const [rate, setRate] = useState("");
  const [statementDay, setStatementDay] = useState(0);
  const [dueDay, setDueDay] = useState(0);
  const [seen, setSeen] = useState<typeof value>(null);
  if (value !== seen) {
    setSeen(value);
    setName(acct?.name ?? "");
    setKind(acct?.kind ?? "bank");
    // The balance as it stands now, including transactions since it was last set.
    setBalance(acct ? String(liveBalance(acct, s) / 100) : "");
    setTracked(acct ? !!acct.tracked : true);
    setCurrency(acct?.currency ?? home);
    setRate(acct?.currency ? String(s.settings.fxRates[acct.currency] ?? "") : "");
    setStatementDay(acct?.statementDay ?? 0);
    setDueDay(acct?.dueDay ?? 0);
  }
  const foreign = currency !== home;
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  return (
    <Sheet open={value !== null} onClose={onClose} title={acct ? "Edit account" : "New account"}>
      <Field label="Name"><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="HDFC Savings" /></Field>
      <div className="row gap8">
        <Field label="Type">
          <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Currency">
          <select value={currency} onChange={(e) => { setCurrency(e.target.value); setRate(String(s.settings.fxRates[e.target.value] ?? "")); }}>
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
        </Field>
      </div>
      <Field label={`${kind === "card" ? "Amount owed" : "Balance"} (${currencySymbol(currency)})`}>
        <input type="text" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0" />
      </Field>
      {foreign && (
        <Field label={`1 ${currency} in ${home}, for net worth`}>
          <input type="text" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="83.2" />
        </Field>
      )}
      {kind === "card" && (
        <div className="row gap8">
          <Field label="Statement day">
            <select value={statementDay} onChange={(e) => setStatementDay(Number(e.target.value))}>
              <option value={0}>Not set</option>
              {days.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Payment due day">
            <select value={dueDay} onChange={(e) => setDueDay(Number(e.target.value))}>
              <option value={0}>Not set</option>
              {days.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
        </div>
      )}
      {!foreign && (
        <div className="card" style={{ background: "var(--surface-2)", padding: "0 14px" }}>
          <Toggle label="Update from my expenses and income" checked={tracked} onChange={setTracked}
            hint={`Anything logged with “Paid from: ${name.trim() || "this account"}” or received into it moves this balance. Set the balance again whenever you check your bank.`} />
        </div>
      )}
      <button className="btn primary block" disabled={!name.trim()} onClick={() => {
        // A transfer can leave a balance below zero, so a leading minus is kept.
        const amount = (parsePaise(balance.trim().replace(/^[-−]/, "")) ?? 0) * (/^\s*[-−]/.test(balance) ? -1 : 1);
        const r = Number(rate);
        if (foreign && r > 0) setSettings({ fxRates: { ...s.settings.fxRates, [currency]: r } });
        saveAccount({
          id: acct?.id ?? uid(), name: name.trim(), kind, balance: amount, order: acct?.order ?? s.accounts.length, updatedAt: Date.now(),
          ...(acct?.history ? { history: acct.history } : {}),
          ...(tracked && !foreign ? { tracked: true } : {}),
          ...(foreign ? { currency } : {}),
          ...(kind === "card" && statementDay && dueDay ? { statementDay, dueDay } : {}),
        });
        onClose();
      }}>Save</button>
      {kind === "card" && (!statementDay || !dueDay) && <p className="t-muted tiny" style={{ margin: 0 }}>Set both days to see each bill and its due date, and to have it show in Coming up.</p>}
      {acct && <button className="btn danger block" onClick={() => { deleteAccount(acct.id); onClose(); }}>Delete account</button>}
    </Sheet>
  );
}
