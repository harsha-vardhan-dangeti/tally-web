import { useMemo, useState } from "react";
import {
  ACCOUNT_KIND_LABEL, accountsNow, addTransfer, cardLimitUsage, cardStatus, deleteAccount, deleteLedgerEntry, deleteScheduledTransfer, deleteTransfer, homeBalance,
  investmentReturn, investmentsSummary, liveBalance, moneyIn, netInvested, runDueTransfers, saveAccount, saveLedgerEntry, saveScheduledTransfer, setSettings, showToast,
  sipsInto, uid, unlinkedGroups, useTally, type Account, type AccountKind, type Expense, type ScheduledTransfer,
} from "../data/store";
import { people } from "../core/people";
import { monthKey } from "../core/budget";
import { CURRENCIES } from "../core/money";
import { Progress, Toggle } from "../ui/components";
import { netWorthSeries } from "../core/reports";
import { formatMoney, parsePaise, currencySymbol } from "../core/money";
import { Icon } from "../ui/icons";
import { Empty, Field, Sheet } from "../ui/components";
import { ChartCard, DataTable, TrendLine } from "../ui/charts";
import { ProfileButton } from "../ui/ProfileMenu";
import { CardSheet } from "../ui/CardSheet";
import { AccountSheet } from "./AccountSheet";
import { GroupsSection } from "./Groups";
import { LinkAccountsSheet } from "../ui/LinkAccountsSheet";

const GROUPS: { kinds: AccountKind[]; title: string }[] = [
  { kinds: ["bank", "cash"], title: "Cash and bank" },
  { kinds: ["investment"], title: "Investments" },
  { kinds: ["card"], title: "Credit cards" },
];

/** Accounts: what you have and owe, how it has moved, and money moved between accounts. */
export function Accounts({ onOpen }: { onOpen?: (e: Expense) => void } = {}) {
  const s = useTally();
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [viewingAccount, setViewingAccount] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  // Everything logged against "UPI", "Cash", "Credit card" or nothing: no balance moved for it.
  const loose = useMemo(() => unlinkedGroups(s), [s]);
  const looseCount = loose.reduce((t, g) => t + g.expenses.length + g.incomes.length + g.ledger.length, 0);
  const looseRepeats = loose.reduce((t, g) => t + g.bills.length + g.loans.length + g.rules.length, 0);
  const hasBank = s.accounts.some((a) => a.kind === "bank" || a.kind === "cash");
  const [moving, setMoving] = useState(false);
  const [sip, setSip] = useState<ScheduledTransfer | "new" | null>(null);
  const [allTransfers, setAllTransfers] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const now = new Date();
  const series = useMemo(() => netWorthSeries(accountsNow(s), now, 12, s.loans), [s.accounts, s.loans, s.expenses, s.incomes, s.ledger]); // eslint-disable-line react-hooks/exhaustive-deps
  const latest = series[series.length - 1] ?? { assets: 0, debts: 0, net: 0 };
  // Only months with a recorded balance are worth charting.
  const charted = series.slice(series.findIndex((p) => p.assets !== 0 || p.debts !== 0));
  // Only against a month with account balances recorded: loans alone would make a huge false jump.
  const prev = charted.length > 1 && charted[charted.length - 2].assets ? charted[charted.length - 2].net : null;
  const signed = (v: number) => `${v < 0 ? "−" : ""}${formatMoney(Math.abs(v))}`;
  const investIds = new Set(s.accounts.filter((a) => a.kind === "investment").map((a) => a.id));
  const sips = s.settings.scheduledTransfers.filter((r) => investIds.has(r.toId)).sort((a, b) => a.day - b.day);
  const others = s.settings.scheduledTransfers.filter((r) => !investIds.has(r.toId));

  return (
    <div className="page wide">
      <header className="page-head">
        <h1 className="display">Accounts</h1>
        <ProfileButton />
      </header>
      <div className="row gap8 wrap span-2">
        {s.accounts.length >= 1 && <button className="btn" onClick={() => setMoving(true)}><Icon name="transfer" size={16} />Transfer</button>}
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

          {hasBank && (looseCount > 0 || looseRepeats > 0) && (
            <div className="banner span-2" role="status">
              <Icon name="alert" size={20} />
              <span className="grow small">
                {looseCount
                  ? `${looseCount} ${looseCount === 1 ? "entry isn't" : "entries aren't"} linked to any of your accounts (${loose.slice(0, 3).map((g) => g.label).join(", ")}), so no balance changed for ${looseCount === 1 ? "it" : "them"}.`
                  : `${looseRepeats} ${looseRepeats === 1 ? "bill or regular income isn't" : "bills and regular incomes aren't"} set to an account, so next time ${looseRepeats === 1 ? "it" : "they"} won't move a balance.`}
              </span>
              <button className="btn small-btn" onClick={() => setLinking(true)}>Link them</button>
            </div>
          )}

          {GROUPS.map((g) => {
            const list = s.accounts.filter((a) => g.kinds.includes(a.kind));
            if (!list.length) return null;
            const total = list.reduce((t, a) => t + (a.kind === "card" ? -homeBalance(a, s) : homeBalance(a, s)), 0);
            return (
              <section key={g.title} className="col gap8">
                <div className="section-title"><span>{g.title}</span><span className="t-muted num">{g.kinds.includes("card") ? cardsSummary(list, s) || signed(total) : g.kinds.includes("investment") ? investSummary(s) || signed(total) : signed(total)}</span></div>
                <div className="card flush divided">
                  {list.map((acct) => (
                    <button key={acct.id} className="list-row row-btn" onClick={() => (acct.kind === "card" ? setViewing(acct.id) : setViewingAccount(acct.id))}>
                      <span className={`acct-icon ${acct.kind}`}><Icon name={acct.kind === "card" ? "card" : acct.kind === "investment" ? "trend" : acct.kind === "cash" ? "bag" : "home"} size={18} /></span>
                      <span className="grow col">
                        <span className="t-strong">{acct.name}</span>
                        <span className="t-muted tiny">{ACCOUNT_KIND_LABEL[acct.kind]} · {acct.kind === "investment" ? `value as of ${new Date(acct.updatedAt).toLocaleDateString([], { day: "numeric", month: "short" })}` : acct.tracked ? "follows your expenses and income" : `balance you entered ${new Date(acct.updatedAt).toLocaleDateString([], { day: "numeric", month: "short" })} · doesn't follow transactions`}</span>
                        <CardDue acct={acct} />
                        <CardLine acct={acct} />
                        <InvestLine acct={acct} />
                      </span>
                      <AccountBalance acct={acct} />
                    </button>
                  ))}
                </div>
              </section>
            );
          })}

          {s.accounts.some((a) => a.kind === "investment") && s.accounts.some((a) => a.kind !== "investment" && a.kind !== "card") && (
            <section className="col gap8">
              <div className="section-title"><span>SIPs</span>
                <button className="btn ghost" onClick={() => setSip("new")}><Icon name="plus" size={14} />Add SIP</button>
              </div>
              {sips.length === 0 ? (
                <div className="card"><p className="t-muted small" style={{ margin: 0 }}>Add each SIP with the investment it goes into (Groww, Zerodha, PPF…) and the account it leaves. Tally moves the money on its day each month and adds it to what you've invested.</p></div>
              ) : (
                <div className="card flush divided">
                  {sips.map((r) => {
                    const into = s.accounts.find((x) => x.id === r.toId);
                    const from = s.accounts.find((x) => x.id === r.fromId);
                    return (
                      <button key={r.id} className="list-row row-btn" onClick={() => setSip(r)}>
                        <span className="acct-icon investment"><Icon name="trend" size={18} /></span>
                        <span className="grow col" style={{ minWidth: 0 }}>
                          <span className="t-strong ellipsis">{r.note || into?.name}</span>
                          <span className="t-muted tiny ellipsis">{r.note ? `${into?.name} · ` : ""}{ordinal(r.day)} of every month from {from?.name ?? "deleted account"}</span>
                        </span>
                        <span className="t-strong num">{formatMoney(r.amount)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {others.length > 0 && (
            <section className="col gap8">
              <div className="section-title"><span>Repeating transfers</span></div>
              <div className="card flush divided">
                {others.map((r) => {
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

      <GroupsSection creating={newGroup} onCreating={setNewGroup} onOpenExpense={onOpen} />

      <AccountSheet accountId={viewingAccount} onClose={() => setViewingAccount(null)} onOpenExpense={onOpen}
        onEdit={(a) => { setViewingAccount(null); setEditing(a); }} />
      <LinkAccountsSheet open={linking} onClose={() => setLinking(false)} />
      <CardSheet cardId={viewing} onClose={() => setViewing(null)} onEdit={(a) => { setViewing(null); setEditing(a); }} onOpenExpense={onOpen} />
      <AccountEditor value={editing} onClose={() => setEditing(null)} onSplitwise={() => { setEditing(null); setNewGroup(true); }} />
      <TransferSheet open={moving} onClose={() => setMoving(false)} />
      <SipSheet value={sip} onClose={() => setSip(null)} />
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
/** "today", "tomorrow", "in 4 days" until a date; "3 days ago" after it. */
function whenText(date: Date, now = new Date()): string {
  const days = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
const dueDay = (d: Date) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

/** A card's bill, said plainly: how much to pay and the last day to pay it. */
function CardDue({ acct }: { acct: Account }) {
  const s = useTally();
  if (acct.kind !== "card") return null;
  const bill = cardStatus(acct, s);
  if (!bill) return <span className="tiny t-muted">Add its statement and due days to see each bill and when to pay it</span>;
  const payer = acct.autoPay && acct.payFrom ? s.accounts.find((a) => a.id === acct.payFrom)?.name : null;
  if (bill.overdue) {
    return (
      <span className="card-due over small">
        <Icon name="alert" size={14} />{formatMoney(bill.overdue.amount)} overdue · was due {dueDay(bill.overdue.date)} ({whenText(bill.overdue.date)})
      </span>
    );
  }
  if (bill.due) {
    const soon = bill.due.date.getTime() - Date.now() < 4 * 86_400_000;
    return (
      <span className={`card-due small${soon ? " soon" : ""}`}>
        Pay {formatMoney(bill.due.amount)} by {dueDay(bill.due.date)} · {whenText(bill.due.date)}{payer ? ` · paid automatically from ${payer}` : ""}
      </span>
    );
  }
  return <span className="tiny t-muted">Nothing due now · next statement {shortDate(bill.nextStatement)}, to pay by {shortDate(bill.nextDue)}</span>;
}

function CardLine({ acct }: { acct: Account }) {
  const s = useTally();
  const bill = cardStatus(acct, s);
  const usage = cardLimitUsage(acct, s);
  if (!bill && !usage) return null;
  return (
    <>
      {usage && (
        <span className="card-usage">
          <Progress value={usage.share} tone={usage.tone === "over" ? "over" : usage.tone === "near" ? "warn" : "ok"} />
          <span className="tiny" style={{ color: usage.tone === "over" ? "var(--danger)" : usage.tone === "near" ? "var(--warn)" : "var(--muted)" }}>
            {usage.available >= 0 ? `${formatMoney(usage.available)} available` : `${formatMoney(-usage.available)} over the limit`}
            {` · ${Math.round(usage.share * 100)}% of ${formatMoney(usage.limit)} used`}
            {usage.onEmi ? ` · ${formatMoney(usage.onEmi)} of it on EMI` : ""}
          </span>
        </span>
      )}
      {bill?.unbilled ? <span className="tiny t-muted">{formatMoney(bill.unbilled)} spent since the statement, on the next bill</span> : null}
    </>
  );
}

const pctText = (p: number | null) => (p === null ? "" : ` (${p >= 0 ? "+" : "−"}${Math.abs(p * 100).toFixed(1)}%)`);

/** An investment's returns, and the SIPs going into it. */
function InvestLine({ acct }: { acct: Account }) {
  const s = useTally();
  if (acct.kind !== "investment") return null;
  const r = investmentReturn(acct, s);
  const sips = sipsInto(acct, s);
  const monthly = sips.reduce((t, x) => t + x.amount, 0);
  return (
    <>
      {r ? (
        <span className="tiny" style={{ color: r.gain < 0 ? "var(--warn)" : "var(--muted)" }}>
          Invested {formatMoney(r.invested)} · {r.gain >= 0 ? "+" : "−"}{formatMoney(Math.abs(r.gain))}{pctText(r.pct)}
        </span>
      ) : <span className="tiny t-muted">Add how much you've put in to see returns</span>}
      {sips.length > 0 && <span className="tiny t-muted">{sips.length === 1 ? "SIP" : `${sips.length} SIPs`} · {formatMoney(monthly)} a month</span>}
    </>
  );
}

/** "₹2,40,000 · +₹18,000 (8.1%)" across investments. */
function investSummary(s: ReturnType<typeof useTally>): string {
  const x = investmentsSummary(s);
  if (!x.withReturns) return "";
  return `${formatMoney(x.value)} · ${x.gain >= 0 ? "+" : "−"}${formatMoney(Math.abs(x.gain))}${pctText(x.invested ? x.gain / x.invested : null)}`;
}

/** "₹14,000 of ₹1,50,000 used" across the cards that have a limit. */
function cardsSummary(cards: Account[], s: ReturnType<typeof useTally>): string {
  // What's to pay first: the total billed and the earliest last day to pay it.
  const bills = cards.map((c) => cardStatus(c, s)).flatMap((b) => (b?.overdue ? [b.overdue] : b?.due ? [b.due] : []));
  const late = cards.map((c) => cardStatus(c, s)?.overdue).filter((b): b is NonNullable<typeof b> => !!b);
  if (late.length) return `${formatMoney(late.reduce((t, b) => t + b.amount, 0))} overdue`;
  if (bills.length) {
    const first = bills.reduce((a, b) => (b.date < a.date ? b : a));
    return `${formatMoney(bills.reduce((t, b) => t + b.amount, 0))} to pay · first by ${shortDate(first.date)}`;
  }
  const usages = cards.map((c) => cardLimitUsage(c, s)).filter((u): u is NonNullable<typeof u> => !!u);
  if (!usages.length) return "";
  const used = usages.reduce((t, u) => t + u.used, 0), limit = usages.reduce((t, u) => t + u.limit, 0);
  return `${formatMoney(used)} of ${formatMoney(limit)} used`;
}

const today = () => new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd in local time
const PERSON = "__person";
/** An amount that may be 0; null when empty or not a number. */
const amountOrZero = (v: string) => (/^\s*0+(\.0*)?\s*$/.test(v) ? 0 : v.trim() ? parsePaise(v) : null);

/** A SIP: a monthly transfer from a bank account into an investment. */
function SipSheet({ value, onClose }: { value: ScheduledTransfer | "new" | null; onClose: () => void }) {
  const s = useTally();
  const editing = value && value !== "new" ? value : null;
  const investments = s.accounts.filter((a) => a.kind === "investment");
  const payers = s.accounts.filter((a) => a.kind === "bank" || a.kind === "cash");
  const [name, setName] = useState("");
  const [toId, setToId] = useState("");
  const [newInto, setNewInto] = useState("");
  const [fromId, setFromId] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(5);
  const [recordNow, setRecordNow] = useState(false);
  const [seen, setSeen] = useState<typeof value>(null);
  if (value !== seen) {
    setSeen(value);
    if (value) {
      setName(editing?.note ?? "");
      setToId(editing?.toId ?? investments[0]?.id ?? NEW_INTO);
      setNewInto("");
      setFromId(editing?.fromId ?? payers[0]?.id ?? "");
      setAmount(editing ? String(editing.amount / 100) : "");
      setDay(editing?.day ?? Math.min(new Date().getDate(), 28));
      setRecordNow(false);
    }
  }
  const paise = parsePaise(amount) ?? 0;
  const creating = toId === NEW_INTO;
  const ready = paise > 0 && fromId && (creating ? !!newInto.trim() : !!toId);
  const now = new Date();
  const passed = day <= now.getDate();
  const key = monthKey(now);

  const save = () => {
    if (!ready) return;
    let into = toId;
    if (creating) {
      into = uid();
      saveAccount({ id: into, name: newInto.trim(), kind: "investment", balance: 0, order: s.accounts.length, updatedAt: Date.now(), balanceSetAt: Date.now(), invested: 0, investedAt: Date.now() });
    }
    const rule: ScheduledTransfer = {
      id: editing?.id ?? uid(), fromId, toId: into, amount: paise, day, note: name.trim(),
      // A new SIP whose day has passed starts next month, unless this month's should be recorded now.
      lastLoggedMonth: editing ? editing.lastLoggedMonth : passed && !recordNow ? key : "",
    };
    saveScheduledTransfer(rule);
    if (!editing && passed && recordNow) runDueTransfers();
    showToast(editing ? "SIP updated" : `SIP added · ${formatMoney(paise)} on the ${ordinal(day)}`);
    onClose();
  };

  return (
    <Sheet open={value !== null} onClose={onClose} title={editing ? "Edit SIP" : "New SIP"}>
      <Field label="Fund or plan"><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Parag Parikh Flexi Cap" autoFocus={!editing} /></Field>
      <div className="row gap8">
        <Field label="Invested in">
          <select value={toId} onChange={(e) => setToId(e.target.value)}>
            {investments.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            <option value={NEW_INTO}>New investment account…</option>
          </select>
        </Field>
        <Field label="Paid from">
          <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {payers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      </div>
      {creating && (
        <Field label="Where is it invested?"><input type="text" value={newInto} onChange={(e) => setNewInto(e.target.value)} placeholder="Groww, Zerodha, Kuvera, PPF…" /></Field>
      )}
      <div className="row gap8">
        <Field label={`Amount (${currencySymbol()})`}>
          <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" />
        </Field>
        <Field label="Day of the month">
          <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{ordinal(d)}</option>)}
          </select>
        </Field>
      </div>
      {!editing && passed && (
        <div className="card" style={{ background: "var(--surface-2)", padding: "0 14px" }}>
          <Toggle label="Record this month's SIP now" checked={recordNow} onChange={setRecordNow}
            hint={`The ${ordinal(day)} has passed. Turn on if this month's ${paise ? formatMoney(paise) : "SIP"} isn't in your balances yet; otherwise it starts next month.`} />
        </div>
      )}
      <p className="t-muted tiny" style={{ margin: 0 }}>Each month on its day, Tally moves the amount from the bank account to the investment and adds it to what you've invested. A SIP is saving, not spending, so your budget doesn't change.</p>
      <button className="btn primary block" disabled={!ready} onClick={save}>{editing ? "Save" : paise ? `Add SIP · ${formatMoney(paise)} a month` : "Enter an amount"}</button>
      {editing && (
        <button className="btn danger block" onClick={() => {
          deleteScheduledTransfer(editing.id);
          showToast("SIP stopped. Past instalments stay.", () => saveScheduledTransfer(editing));
          onClose();
        }}>Stop SIP</button>
      )}
    </Sheet>
  );
}
const NEW_INTO = "__new";

function TransferSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useTally();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [person, setPerson] = useState("");
  const [seen, setSeen] = useState(false);
  if (open !== seen) {
    setSeen(open);
    if (open) {
      // Most transfers leave a bank: start there, going to the first other account.
      const from = s.accounts.find((a) => a.kind === "bank") ?? s.accounts[0];
      setFromId(from?.id ?? "");
      setToId(s.accounts.find((a) => a.id !== from?.id)?.id ?? PERSON);
      setPerson("");
      setAmount("");
      setDate(today());
      setNote("");
      setRepeat(false);
    }
  }
  const from = s.accounts.find((a) => a.id === fromId);
  const toPerson = toId === PERSON;
  const to = s.accounts.find((a) => a.id === toId);
  const paise = parsePaise(amount) ?? 0;
  const known = useMemo(() => people(s.expenses, s.ledger).map((p) => p.name), [s.expenses, s.ledger]);
  const ready = from && (toPerson ? !!person.trim() : to && from.id !== to.id) && paise > 0 && date;
  const shown = (a: Account) => formatMoney(a.kind === "card" ? -liveBalance(a, s) : liveBalance(a, s));
  const after = (a: Account, n: number) => shown(moneyIn(a, n));

  const save = () => {
    if (!ready) return;
    const [y, m, d] = date.split("-").map(Number);
    const at = new Date(y, m - 1, d, 12);
    const isToday = at.toDateString() === new Date().toDateString();
    if (toPerson) {
      // Money sent to someone: they owe it to you, and it leaves the account.
      const name = person.trim();
      const entry = { id: uid(), person: name, amount: paise, kind: "lent" as const, note: note.trim(), occurredAt: isToday ? Date.now() : at.getTime(),
        createdAt: Date.now(), account: from.name };
      saveLedgerEntry(entry);
      showToast(`${name} owes you ${formatMoney(paise)} · see People`, () => deleteLedgerEntry(entry.id, false));
      onClose();
      return;
    }
    if (!to) return;
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
    <Sheet open={open} onClose={onClose} title={toPerson ? "Send money to someone" : "Transfer between accounts"}>
      <div className="row gap8">
        <Field label="From">
          <select value={fromId} onChange={(e) => { setFromId(e.target.value); if (e.target.value === toId) setToId(fromId); }}>
            {s.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="To">
          <select value={toId} onChange={(e) => { setToId(e.target.value); if (e.target.value === fromId) setFromId(toId); }}>
            <optgroup label="Your accounts">
              {s.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </optgroup>
            <optgroup label="Someone else">
              <option value={PERSON}>A person (they'll owe you)</option>
            </optgroup>
          </select>
        </Field>
      </div>
      {toPerson && (
        <Field label="Who are you sending it to?">
          <input type="text" list="transfer-people" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Name" />
          <datalist id="transfer-people">{known.map((n) => <option key={n} value={n} />)}</datalist>
        </Field>
      )}
      <div className="row gap8">
        <Field label={`Amount (${currencySymbol()})`}>
          <input type="text" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" />
        </Field>
        <Field label="Date"><input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="Note"><input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional, like “Card bill”" /></Field>
      {!toPerson && (
        <div className="card" style={{ background: "var(--surface-2)", padding: "0 14px" }}>
          <Toggle label="Repeat every month" hint={`On the ${ordinal(Math.min(Number(date.split("-")[2]) || 1, 28))}, like a SIP or rent to a flatmate`} checked={repeat} onChange={setRepeat} />
        </div>
      )}
      {toPerson && from && (
        <div className="card col gap4 small" style={{ background: "var(--surface-2)" }} aria-live="polite">
          <div className="row between"><span className="t-muted">{from.name}</span><span className="num">{shown(from)} → <b>{after(from, -paise)}</b></span></div>
          <div className="row between"><span className="t-muted">{person.trim() || "They"} will owe you</span><span className="num in t-strong">{formatMoney(paise)}</span></div>
          <span className="t-muted tiny">It shows in People until they pay you back. Lending isn't spending, so your budget doesn't change.</span>
        </div>
      )}

      {from && to && from.id !== to.id && (
        <div className="card col gap4 small" style={{ background: "var(--surface-2)" }} aria-live="polite">
          <div className="row between"><span className="t-muted">{from.name}</span><span className="num">{shown(from)} → <b>{after(from, -paise)}</b></span></div>
          <div className="row between"><span className="t-muted">{to.name}</span><span className="num">{shown(to)} → <b>{after(to, paise)}</b></span></div>
          <span className="t-muted tiny">
            {to.kind === "card" ? "Paying a card lowers what you owe. " : ""}A transfer isn't spending, so your budget doesn't change.
          </span>
        </div>
      )}

      <button className="btn primary block" disabled={!ready} onClick={save}>{!paise ? "Enter an amount" : toPerson ? `Send ${formatMoney(paise)}` : `Transfer ${formatMoney(paise)}`}</button>
    </Sheet>
  );
}

function AccountEditor({ value, onClose, onSplitwise }: { value: Account | "new" | null; onClose: () => void; onSplitwise: () => void }) {
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
  const [limit, setLimit] = useState("");
  const [payFrom, setPayFrom] = useState("");
  const [autoPay, setAutoPay] = useState(false);
  const [invested, setInvested] = useState("");
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
    setLimit(acct?.limit ? String(acct.limit / 100) : "");
    setPayFrom(acct?.payFrom ?? s.accounts.find((a) => a.kind === "bank")?.id ?? "");
    setAutoPay(!!acct?.autoPay);
    const inv = acct ? netInvested(acct, s) : null;
    setInvested(inv !== null ? String(inv / 100) : "");
  }
  const banks = s.accounts.filter((a) => a.kind !== "card" && a.id !== acct?.id);
  const foreign = currency !== home;
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  return (
    <Sheet open={value !== null} onClose={onClose} title={acct ? "Edit account" : "New account"}>
      <Field label="Name"><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="HDFC Savings" /></Field>
      <div className="row gap8">
        <Field label="Type">
          <select value={kind} onChange={(e) => (e.target.value === "splitwise" ? onSplitwise() : setKind(e.target.value as AccountKind))}>
            {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>)}
            {!acct && <option value="splitwise">Splitwise group…</option>}
          </select>
        </Field>
        <Field label="Currency">
          <select value={currency} onChange={(e) => { setCurrency(e.target.value); setRate(String(s.settings.fxRates[e.target.value] ?? "")); }}>
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
        </Field>
      </div>
      <Field label={`${kind === "card" ? "Amount owed" : kind === "investment" ? "Value now" : "Balance"} (${currencySymbol(currency)})`}>
        <input type="text" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0" />
      </Field>
      {kind === "investment" && (
        <Field label={`Invested so far (${currencySymbol(currency)})`}>
          <input type="text" inputMode="decimal" value={invested} onChange={(e) => setInvested(e.target.value)} placeholder="What you've put in, for returns" />
        </Field>
      )}
      {foreign && (
        <Field label={`1 ${currency} in ${home}, for net worth`}>
          <input type="text" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="83.2" />
        </Field>
      )}
      {kind === "card" && (
        <Field label={`Credit limit (${currencySymbol(currency)})`}>
          <input type="text" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="150000" />
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
      {kind === "card" && statementDay > 0 && dueDay > 0 && banks.length > 0 && (
        <div className="card col gap8" style={{ background: "var(--surface-2)", padding: "0 14px 12px" }}>
          <Toggle label="Pay the bill automatically" checked={autoPay} onChange={setAutoPay}
            hint="On the due date, Tally records paying what's due from the account below: a transfer, so it isn't counted as spending twice." />
          {autoPay && (
            <Field label="Pay from">
              <select value={payFrom} onChange={(e) => setPayFrom(e.target.value)}>
                {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
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
          id: acct?.id ?? uid(), name: name.trim(), kind, balance: amount, order: acct?.order ?? s.accounts.length, updatedAt: Date.now(), balanceSetAt: Date.now(),
          ...(acct?.history ? { history: acct.history } : {}),
          ...(tracked && !foreign ? { tracked: true } : {}),
          ...(foreign ? { currency } : {}),
          ...(kind === "card" && statementDay && dueDay ? { statementDay, dueDay } : {}),
          ...(kind === "card" && parsePaise(limit) ? { limit: parsePaise(limit)! } : {}),
          ...(kind === "card" && statementDay && dueDay && autoPay && payFrom ? { autoPay: true, payFrom } : {}),
          ...(kind === "investment" && amountOrZero(invested) !== null ? { invested: amountOrZero(invested)!, investedAt: Date.now() } : {}),
        });
        onClose();
      }}>Save</button>
      {kind === "card" && (!statementDay || !dueDay) && <p className="t-muted tiny" style={{ margin: 0 }}>Set both days to see each bill and its due date, and to have it show in Coming up.</p>}
      {acct && <button className="btn danger block" onClick={() => { deleteAccount(acct.id); onClose(); }}>Delete account</button>}
    </Sheet>
  );
}
