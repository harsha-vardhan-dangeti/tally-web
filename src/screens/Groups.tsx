import { useMemo, useState } from "react";
import {
  addExpense, deleteGroup, deleteLedgerEntry, likelyAccount, saveGroup, saveLedgerEntry, showToast, uid, useTally,
  type Expense, type LedgerEntry, type SplitGroup,
} from "../data/store";
import { groupStanding, memberNames, planGroupBill, unequalShares, type BillPlan, type SplitMode } from "../core/groups";
import { people, personKey, type Person } from "../core/people";
import { myShareOf } from "../core/smartParser";
import { guessCategory, type Category } from "../core/categories";
import { currencySymbol, formatMoney, parsePaise } from "../core/money";
import { AccountNote, AccountSelect } from "../ui/AccountSelect";
import { CategorySelect } from "../ui/CategorySelect";
import { Field, Sheet } from "../ui/components";
import { Icon } from "../ui/icons";

const toDateInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fromDateInput = (v: string) => {
  if (v === toDateInput(Date.now())) return Date.now();
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getTime();
};
const day = (ms: number) => new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });
const names = (list: string[]) => list.length <= 2 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;

/** Your groups in Accounts: each with where you stand, opening to its members, bills and settle-ups. */
export function GroupsSection({ creating, onCreating, onOpenExpense }: {
  creating: boolean; onCreating: (v: boolean) => void; onOpenExpense?: (e: Expense) => void;
}) {
  const s = useTally();
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SplitGroup | null>(null);
  const groups = s.settings.groups;
  const open = groups.find((g) => g.id === openId) ?? null;

  return (
    <section className="col gap8">
      <div className="section-title"><span>Splitwise groups</span>
        {groups.length > 0 && <button className="btn ghost" onClick={() => onCreating(true)}><Icon name="plus" size={14} />New group</button>}
      </div>
      <div className="card flush divided">
        {groups.length === 0 ? (
          <div className="list-row">
            <span className="acct-icon"><Icon name="split" size={18} /></span>
            <span className="grow col" style={{ minWidth: 0 }}>
              <span className="t-strong">Split bills with a group</span>
              <span className="t-muted tiny">Make one for your flat or a trip, add the people in it, then add bills: who paid and who it's split between. Tally keeps track of who owes whom.</span>
            </span>
            <button className="btn small-btn" onClick={() => onCreating(true)}>New group</button>
          </div>
        ) : groups.map((g) => <GroupRow key={g.id} group={g} onOpen={() => setOpenId(g.id)} />)}
      </div>

      <GroupSheet group={open} onClose={() => setOpenId(null)} onEdit={(g) => setEditing(g)} onOpenExpense={onOpenExpense} />
      <GroupEditor value={creating ? "new" : editing} onClose={() => { onCreating(false); setEditing(null); }}
        onSaved={(g, isNew) => { if (isNew) setOpenId(g.id); }} onDeleted={() => setOpenId(null)} />
    </section>
  );
}

function GroupRow({ group, onOpen }: { group: SplitGroup; onOpen: () => void }) {
  const s = useTally();
  const st = useMemo(() => groupStanding(group, s.expenses, s.ledger), [group, s.expenses, s.ledger]);
  return (
    <button className="list-row row-btn" onClick={onOpen}>
      <span className="acct-icon"><Icon name="split" size={18} /></span>
      <span className="grow col" style={{ minWidth: 0 }}>
        <span className="t-strong ellipsis">{group.name}</span>
        <span className="t-muted tiny ellipsis">{group.members.length ? `You, ${names(group.members)}` : "No members yet"}</span>
      </span>
      <Standing net={st.net} />
    </button>
  );
}

function Standing({ net }: { net: number }) {
  if (!net) return <span className="t-muted small">settled up</span>;
  return (
    <span className="col" style={{ alignItems: "flex-end" }}>
      <span className="tiny t-muted">{net > 0 ? "you're owed" : "you owe"}</span>
      <span className={`t-strong num ${net > 0 ? "in" : "owe"}`}>{formatMoney(Math.abs(net))}</span>
    </span>
  );
}

type Activity = { key: string; at: number; expense?: Expense; entry?: LedgerEntry };

/** One group: where you stand with each member, a button to add a bill, and everything in it. */
function GroupSheet({ group, onClose, onEdit, onOpenExpense }: {
  group: SplitGroup | null; onClose: () => void; onEdit: (g: SplitGroup) => void; onOpenExpense?: (e: Expense) => void;
}) {
  const s = useTally();
  const [adding, setAdding] = useState(false);
  const [settling, setSettling] = useState<Person | null>(null);
  const [all, setAll] = useState(false);
  const st = useMemo(() => (group ? groupStanding(group, s.expenses, s.ledger) : null), [group, s.expenses, s.ledger]);
  const activity = useMemo<Activity[]>(() => {
    if (!group) return [];
    return [
      ...s.expenses.filter((e) => e.group === group.id).map((e) => ({ key: `e-${e.id}`, at: e.occurredAt, expense: e })),
      ...s.ledger.filter((l) => l.group === group.id).map((l) => ({ key: `l-${l.id}`, at: l.occurredAt, entry: l })),
    ].sort((a, b) => b.at - a.at);
  }, [group, s.expenses, s.ledger]);
  if (!group || !st) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const shown = all ? activity : activity.slice(0, 15);

  return (
    <>
      <Sheet open onClose={onClose} title={group.name}
        actions={<button className="btn ghost" onClick={() => onEdit(group)}><Icon name="edit" size={16} />Edit</button>}>
        <div className="card col gap12" style={{ background: "var(--surface-2)" }}>
          <div className="col gap4">
            <span className="eyebrow">In this group</span>
            <span className={`display num ${st.net > 0 ? "in" : st.net < 0 ? "owe" : ""}`} style={{ fontSize: 30 }}>
              {st.net ? formatMoney(Math.abs(st.net)) : "Settled up"}
            </span>
            {st.net !== 0 && <span className="tiny t-muted">{st.net > 0 ? "is owed to you" : "is what you owe"}</span>}
          </div>
          <button className="btn primary" onClick={() => setAdding(true)} disabled={!group.members.length}><Icon name="plus" size={16} />Add a bill</button>
          {!group.members.length && <span className="tiny t-muted">Add people to the group first (Edit).</span>}
        </div>

        {st.members.length > 0 && (
          <section className="col gap8">
            <div className="section-title"><span>Members</span></div>
            <div className="card flush divided">
              {st.members.map((p) => (
                <div key={p.key} className="list-row">
                  <span className="person-avatar" aria-hidden="true">{p.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}</span>
                  <span className="grow col" style={{ minWidth: 0 }}>
                    <span className="t-strong ellipsis">{p.name}</span>
                    <span className={`tiny ${p.balance > 0 ? "in" : p.balance < 0 ? "owe" : "t-muted"}`}>
                      {p.balance > 0 ? `owes you ${formatMoney(p.balance)}` : p.balance < 0 ? `you owe ${formatMoney(-p.balance)}` : "settled up"}
                    </span>
                  </span>
                  {p.balance !== 0 && <button className="btn small-btn" onClick={() => setSettling(p)}>Settle up</button>}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="col gap8">
          <div className="section-title"><span>Bills and payments</span></div>
          {activity.length === 0 ? (
            <div className="card"><p className="t-muted small" style={{ margin: 0 }}>No bills yet. Add one with “Add a bill”.</p></div>
          ) : (
            <div className="card flush divided">
              {shown.map((a) => a.expense ? <BillRow key={a.key} e={a.expense} onOpen={onOpenExpense} /> : <PaymentRow key={a.key} l={a.entry!} />)}
            </div>
          )}
          {activity.length > 15 && <button className="btn ghost" style={{ alignSelf: "center" }} onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${activity.length}`}</button>}
        </section>
      </Sheet>
      <BillSheet group={adding ? group : null} onClose={() => setAdding(false)} />
      <SettleSheet group={group} person={settling} onClose={() => setSettling(null)} />
    </>
  );
}

function BillRow({ e, onOpen }: { e: Expense; onOpen?: (e: Expense) => void }) {
  const share = myShareOf(e);
  const payer = e.paidBy?.trim();
  const lent = payer ? 0 : e.amount - share;
  const body = (
    <>
      <span className="acct-icon"><Icon name="bag" size={18} /></span>
      <span className="grow col" style={{ minWidth: 0 }}>
        <span className="small t-strong ellipsis">{e.merchant || e.note || "Bill"}</span>
        <span className="tiny t-muted ellipsis">{day(e.occurredAt)} · {payer ? `${payer} paid` : "You paid"} {formatMoney(e.amount)}{e.shares ? " · unequal" : e.splitWays > 1 ? ` · ${e.splitWays} ways` : ""}</span>
      </span>
      <span className="col" style={{ alignItems: "flex-end" }}>
        <span className="tiny t-muted">{payer ? "you owe" : lent ? "you lent" : "just you"}</span>
        <span className={`num small t-strong ${payer ? "owe" : lent ? "in" : ""}`}>{formatMoney(payer ? share : lent || e.amount)}</span>
      </span>
    </>
  );
  return onOpen ? <button className="list-row row-btn" onClick={() => onOpen(e)}>{body}</button> : <div className="list-row">{body}</div>;
}

function PaymentRow({ l }: { l: LedgerEntry }) {
  const title = l.kind === "settled" ? (l.amount < 0 ? `${l.person} paid you` : `You paid ${l.person}`) : l.amount > 0 ? `You paid for ${l.person}` : `${l.person} paid for you`;
  return (
    <div className="list-row">
      <span className="acct-icon"><Icon name={l.kind === "settled" ? "check" : "split"} size={18} /></span>
      <span className="grow col" style={{ minWidth: 0 }}>
        <span className="small t-strong ellipsis">{title}</span>
        <span className="tiny t-muted ellipsis">{day(l.occurredAt)}{l.note ? ` · ${l.note}` : ""}{l.account ? ` · ${l.account}` : ""}</span>
      </span>
      <span className="num small t-strong">{formatMoney(Math.abs(l.amount))}</span>
      <button className="icon-btn" aria-label={`Delete: ${title}, ${formatMoney(Math.abs(l.amount))}`} onClick={() => deleteLedgerEntry(l.id)}><Icon name="trash" size={18} /></button>
    </div>
  );
}

/** Add a bill: what it was, how much, who paid, and who it's split between (equally). */
/** Add a group bill from Quick add: picks up the group you last added to, or offers to make one. */
export function GroupBillAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useTally();
  const groups = s.settings.groups;
  const [groupId, setGroupId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const last = [...s.expenses].filter((e) => e.group).sort((a, b) => b.createdAt - a.createdAt)[0]?.group;
      setGroupId(groups.some((g) => g.id === last) ? last! : groups[0]?.id ?? null);
      setCreating(false);
    }
  }
  const group = open ? groups.find((g) => g.id === groupId) ?? null : null;

  return (
    <>
      <BillSheet group={group} onClose={onClose} choices={groups} onPick={(g) => setGroupId(g.id)} />
      <Sheet open={open && !group && !creating} onClose={onClose} title="New group bill">
        <div className="col gap8">
          <span className="t-strong">Make a group first</span>
          <span className="t-muted small">A group is the people you split with, like your flat or a trip. Make one, then add its bills here.</span>
        </div>
        <button className="btn primary block" onClick={() => setCreating(true)}>New group</button>
      </Sheet>
      <GroupEditor value={open && creating ? "new" : null} onClose={() => setCreating(false)}
        onSaved={(g) => { setGroupId(g.id); setCreating(false); }} onDeleted={() => {}} />
    </>
  );
}

function BillSheet({ group, onClose, choices, onPick }: {
  group: SplitGroup | null; onClose: () => void; choices?: SplitGroup[]; onPick?: (g: SplitGroup) => void;
}) {
  const s = useTally();
  const [what, setWhat] = useState("");
  const [amount, setAmount] = useState("");
  const [payer, setPayer] = useState("");
  const [among, setAmong] = useState<string[]>([]);
  const [mode, setMode] = useState<SplitMode>("equal");
  const [values, setValues] = useState<Record<string, string>>({});
  const [date, setDate] = useState(toDateInput(Date.now()));
  const [category, setCategory] = useState<Category>("other");
  const [picked, setPicked] = useState(false);
  const [account, setAccount] = useState("");
  const [seen, setSeen] = useState<SplitGroup | null>(null);
  if (group !== seen) {
    setSeen(group);
    if (group && seen && choices) {
      // Switched group in Quick add: keep what you typed, start the split over with the new members.
      setPayer(""); setAmong(["", ...group.members]); setMode("equal"); setValues({});
    } else if (group) {
      setWhat(""); setAmount(""); setPayer(""); setAmong(["", ...group.members]); setMode("equal"); setValues({}); setDate(toDateInput(Date.now()));
      setCategory("other"); setPicked(false);
      setAccount(likelyAccount(s, s.expenses.filter((e) => e.group && !e.paidBy).map((e) => e.account)));
    }
  }
  if (!group) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;

  const paise = parsePaise(amount) ?? 0;
  const everyone = ["", ...group.members];
  const label = (n: string) => (n === "" ? "You" : n);
  const unequal = mode === "equal" ? null : unequalShares(paise, mode, everyone.map((n) => ({
    person: n, value: mode === "exact" ? parsePaise(values[n] ?? "") ?? 0 : Number(values[n]) || 0,
  })));
  const plan: BillPlan | null = !unequal ? planGroupBill(paise, payer, among)
    : unequal.left === 0 && unequal.shares.length ? planGroupBill(paise, payer, [], unequal.shares) : null;
  const others = among.filter((n) => n !== "");
  const toggle = (n: string) => setAmong(among.includes(n) ? among.filter((x) => x !== n) : [...among, n]);
  // Switching to amounts or percentages starts from an equal split of whoever is ticked.
  const switchTo = (m: SplitMode) => {
    setMode(m);
    if (m === "equal" || !among.length) return;
    const n = among.length;
    if (m === "exact") {
      if (!paise) { setValues({}); return; }
      const base = Math.floor(paise / n), extra = paise - base * n;
      setValues(Object.fromEntries(among.map((p, i) => [p, String((base + (i < extra ? 1 : 0)) / 100)])));
    } else {
      const base = Math.floor(10000 / n) / 100;
      setValues(Object.fromEntries(among.map((p, i) => [p, String(i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base)])));
    }
  };
  const unit = mode === "percent" ? "%" : currencySymbol(s.settings.currency);
  const leftText = !unequal || !paise ? "" : unequal.left === 0 ? "" : mode === "percent"
    ? (unequal.left > 0 ? `${unequal.left}% left to assign` : `${-unequal.left}% too much`)
    : (unequal.left > 0 ? `${formatMoney(unequal.left)} left to assign` : `${formatMoney(-unequal.left)} too much`);
  const owers = plan?.kind === "expense" && plan.shares ? Object.entries(plan.shares) : [];
  const summary = !paise || !plan ? "" : plan.kind === "none"
    ? "This bill doesn't include you, so it doesn't change what anyone owes you or you owe."
    : plan.kind === "lent" ? (unequal ? plan.entries.map((x) => `${x.person} owes you ${formatMoney(x.amount)}`).join(". ") + "." : `${names(others)} each owe you about ${formatMoney(plan.each)}.`)
    : plan.splitWays === 1 ? "Just you: it's added to your spending."
    : payer ? `Your share is ${formatMoney(plan.yourShare)}. You'll owe ${payer} that.`
    : unequal ? `Your share is ${formatMoney(plan.yourShare)}. ${owers.map(([n, v]) => `${n} owes you ${formatMoney(v)}`).join(", ")}.`
    : `${formatMoney(plan.each)} each. ${names(others)} ${others.length === 1 ? "owes" : "each owe"} you ${formatMoney(plan.each)}.`;

  const save = () => {
    const at = fromDateInput(date);
    const title = what.trim() || "Bill";
    if (!plan) return;
    if (plan.kind === "expense") {
      addExpense({ amount: paise, category, merchant: title, note: group.name, account: payer ? null : account, occurredAt: at, source: "manual",
        splitWays: plan.splitWays, splitWith: plan.splitWith, ...(plan.paidBy ? { paidBy: plan.paidBy } : {}), group: group.id,
        ...(plan.shares && plan.myShare !== undefined ? { myShare: plan.myShare, shares: plan.shares } : {}) });
    } else if (plan.kind === "lent") {
      const now = Date.now();
      for (const x of plan.entries) {
        saveLedgerEntry({ id: uid(), person: x.person, amount: x.amount, kind: "lent", note: title, occurredAt: at, createdAt: now, account, group: group.id });
      }
    }
    showToast(`Added ${title} to ${group.name}`);
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={choices ? "New group bill" : `New bill in ${group.name}`}>
      {choices && (
        <Field label="Group">
          <select value={group.id} onChange={(e) => { const g = choices.find((x) => x.id === e.target.value); if (g) onPick?.(g); }}>
            {choices.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="What was it?">
        <input type="text" value={what} maxLength={60} placeholder="Groceries, Rent, Dinner…"
          onChange={(e) => { setWhat(e.target.value); if (!picked) setCategory(guessCategory(e.target.value)); }} />
      </Field>
      <div className="row gap8">
        <Field label={`Amount (${currencySymbol(s.settings.currency)})`}>
          <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Paid by">
          <select value={payer} onChange={(e) => setPayer(e.target.value)}>
            <option value="">You</option>
            {group.members.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      </div>

      <div className="col gap8">
        <div className="row between gap8" style={{ alignItems: "center" }}>
          <span className="t-strong small">Split</span>
          <div className="view-switch" role="group" aria-label="How to split">
            {([["equal", "Equally"], ["exact", "Amounts"], ["percent", "Percent"]] as const).map(([m, l]) => (
              <button key={m} aria-pressed={mode === m} onClick={() => switchTo(m)}>{l}</button>
            ))}
          </div>
        </div>
        {mode === "equal" ? (
          <div className="row gap8 wrap" role="group" aria-label="Split equally between">
            {everyone.map((n) => (
              <button key={n || "you"} className={`chip${among.includes(n) ? " on" : ""}`} aria-pressed={among.includes(n)} onClick={() => toggle(n)}>
                {among.includes(n) && <Icon name="check" size={14} />}{label(n)}
              </button>
            ))}
          </div>
        ) : (
          <div className="col gap8">
            {everyone.map((n) => (
              <label key={n || "you"} className="row gap8" style={{ alignItems: "center" }}>
                <span className="small grow ellipsis">{label(n)}</span>
                <span className="row gap4" style={{ alignItems: "center", width: 140 }}>
                  {mode === "exact" && <span className="small t-muted">{unit}</span>}
                  <input type="text" inputMode="decimal" aria-label={`${n === "" ? "Your" : `${n}'s`} ${mode === "percent" ? "percent" : "amount"}`} placeholder="0"
                    value={values[n] ?? ""} onChange={(e) => setValues({ ...values, [n]: e.target.value })} />
                  {mode === "percent" && <span className="small t-muted">%</span>}
                </span>
              </label>
            ))}
            {leftText && <span className="small" style={{ color: unequal && unequal.left < 0 ? "var(--danger)" : "var(--warn)" }} aria-live="polite">{leftText}</span>}
            {mode === "percent" && unequal?.left === 0 && paise > 0 && (
              <span className="tiny t-muted">{unequal.shares.map((x) => `${label(x.person)} ${formatMoney(x.amount)}`).join(" · ")}</span>
            )}
          </div>
        )}
      </div>

      <div className="row gap8">
        <Field label="Date"><input type="date" value={date} max={toDateInput(Date.now())} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Category">
          <CategorySelect value={category} onChange={(c) => { setCategory(c); setPicked(true); }} />
        </Field>
      </div>

      {!payer && plan && plan.kind !== "none" && (
        <>
          <Field label="Paid from"><AccountSelect value={account} onChange={setAccount} /></Field>
          <AccountNote name={account} what="This bill" />
        </>
      )}

      {summary && <div className="card small" style={{ background: "var(--surface-2)" }} aria-live="polite">{summary}</div>}
      <button className="btn primary block" disabled={!paise || !plan || plan.kind === "none"} onClick={save}>Add bill</button>
    </Sheet>
  );
}

/** Record a payment between you and one member, in this group. */
function SettleSheet({ group, person, onClose }: { group: SplitGroup; person: Person | null; onClose: () => void }) {
  const s = useTally();
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [date, setDate] = useState(toDateInput(Date.now()));
  const [seen, setSeen] = useState<Person | null>(null);
  if (person !== seen) {
    setSeen(person);
    if (person) {
      setAmount(String(Math.abs(person.balance) / 100)); setDate(toDateInput(Date.now()));
      setAccount(likelyAccount(s, s.ledger.map((l) => l.account)));
    }
  }
  if (!person) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const theyPay = person.balance > 0;
  const paise = parsePaise(amount) ?? 0;
  const left = Math.abs(person.balance) - paise;
  const save = () => {
    saveLedgerEntry({ id: uid(), person: person.name, amount: theyPay ? -paise : paise, kind: "settled", note: group.name,
      occurredAt: fromDateInput(date), createdAt: Date.now(), account, group: group.id });
    showToast(theyPay ? `${person.name} paid you ${formatMoney(paise)}` : `You paid ${person.name} ${formatMoney(paise)}`);
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={theyPay ? `${person.name} paid you` : `You paid ${person.name}`}>
      <p className="small t-muted" style={{ margin: 0 }}>
        {theyPay ? `${person.name} owes you ${formatMoney(person.balance)} in ${group.name}.` : `You owe ${person.name} ${formatMoney(-person.balance)} in ${group.name}.`}
      </p>
      <div className="row gap8">
        <Field label={`Amount (${currencySymbol(s.settings.currency)})`}>
          <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Date"><input type="date" value={date} max={toDateInput(Date.now())} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label={theyPay ? "Received in" : "Paid from"}><AccountSelect value={account} onChange={setAccount} /></Field>
      <AccountNote name={account} what="This payment" incoming={theyPay} />
      {paise > 0 && left > 0 && <span className="tiny t-muted">{formatMoney(left)} will still be {theyPay ? "owed to you" : "owed"}.</span>}
      {paise > 0 && left < 0 && <span className="tiny" style={{ color: "var(--warn)" }}>That's {formatMoney(-left)} more than {theyPay ? "they owe" : "you owe"}; the difference flips to the other side.</span>}
      <button className="btn primary block" disabled={!paise} onClick={save}>{theyPay ? "Record payment received" : "Record payment"}</button>
    </Sheet>
  );
}

/** Make or edit a group: its name and the people in it. */
function GroupEditor({ value, onClose, onSaved, onDeleted }: {
  value: SplitGroup | "new" | null; onClose: () => void; onSaved: (g: SplitGroup, isNew: boolean) => void; onDeleted: () => void;
}) {
  const s = useTally();
  const g = value && value !== "new" ? value : null;
  const [name, setName] = useState("");
  const [members, setMembers] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [seen, setSeen] = useState<typeof value>(null);
  if (value !== seen) {
    setSeen(value);
    setName(g?.name ?? ""); setMembers(g?.members.join(", ") ?? ""); setConfirm(false);
  }
  const known = useMemo(() => people(s.expenses, s.ledger).map((p) => p.name), [s.expenses, s.ledger]);
  const list = memberNames(members);
  const typed = members.split(",").pop()?.trim().toLowerCase() ?? "";
  const suggestions = known.filter((n) => !list.some((m) => personKey(m) === personKey(n)) && (!typed || n.toLowerCase().startsWith(typed))).slice(0, 6);
  const addSuggestion = (n: string) => {
    const parts = members.split(",");
    parts[parts.length - 1] = ` ${n}`;
    setMembers(`${parts.join(",").replace(/^\s+/, "")}, `);
  };
  const clash = s.settings.groups.some((x) => x.id !== g?.id && x.name.toLowerCase() === name.trim().toLowerCase());
  const save = () => {
    const group: SplitGroup = { id: g?.id ?? uid(), name: name.trim(), members: list, createdAt: g?.createdAt ?? Date.now() };
    saveGroup(group);
    showToast(g ? `Saved ${group.name}` : `Made ${group.name}`);
    onClose();
    onSaved(group, !g);
  };
  return (
    <Sheet open={value !== null} onClose={onClose} title={g ? `Edit ${g.name}` : "New group"}>
      <Field label="Group name"><input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Flat 302, Goa trip…" /></Field>
      {clash && <span className="small" style={{ color: "var(--danger)" }}>You already have a group called {name.trim()}.</span>}
      <Field label="People in it (besides you)">
        <input type="text" value={members} onChange={(e) => setMembers(e.target.value)} placeholder="Ravi, Priya, Arjun" />
      </Field>
      {suggestions.length > 0 && (
        <div className="row gap8 wrap" aria-label="People you've split with">
          {suggestions.map((n) => <button key={n} className="chip" onClick={() => addSuggestion(n)}><Icon name="plus" size={14} />{n}</button>)}
        </div>
      )}
      <p className="t-muted tiny" style={{ margin: 0 }}>Separate names with commas. Use the same names as in People and their balances join up.</p>
      <button className="btn primary block" disabled={!name.trim() || clash || !list.length} onClick={save}>{g ? "Save" : "Make group"}</button>
      {g && (confirm ? (
        <div className="card col gap8" style={{ background: "var(--danger-soft)" }} role="alertdialog" aria-label="Confirm delete">
          <span className="small t-strong" style={{ color: "var(--danger)" }}>Delete {g.name}? Its bills and payments stay in People and your spending.</span>
          <div className="row gap8">
            <button className="btn danger" onClick={() => { deleteGroup(g.id); showToast(`Deleted ${g.name}`, () => saveGroup(g)); onClose(); onDeleted(); }}>Delete</button>
            <button className="btn" onClick={() => setConfirm(false)}>Keep it</button>
          </div>
        </div>
      ) : <button className="btn danger block" onClick={() => setConfirm(true)}>Delete group</button>)}
    </Sheet>
  );
}
