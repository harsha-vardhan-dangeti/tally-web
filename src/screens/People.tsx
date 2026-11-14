import { useMemo, useState } from "react";
import { deleteLedgerEntry, saveLedgerEntry, setSettings, showToast, uid, useTally } from "../data/store";
import { useCloud } from "../data/cloud";
import { track } from "../data/telemetry";
import { isUpiId, payLink, people, peopleTotals, unpaidTitles, type Person, type PersonItem } from "../core/people";
import { currencySymbol, formatMoney, parsePaise } from "../core/money";
import { dateLocale, t } from "../i18n";
import { Icon } from "../ui/icons";
import { Empty, Field, Sheet } from "../ui/components";
import { ProfileButton } from "../ui/ProfileMenu";
import { shareText, whatsapp } from "../ui/share";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const day = (ms: number) => new Date(ms).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" });

/** Everyone you split with, lent to or borrowed from, and where each of you stands. */
export function People() {
  const s = useTally();
  const list = useMemo(() => people(s.expenses, s.ledger), [s.expenses, s.ledger]);
  const totals = peopleTotals(list);
  const open = list.filter((p) => p.balance !== 0);
  const settled = list.filter((p) => p.balance === 0);
  const [showSettled, setShowSettled] = useState(false);
  const [personKey, setPersonKey] = useState<string | null>(null);
  const [entry, setEntry] = useState<{ kind: "lent" | "borrowed"; person: string } | null>(null);
  const person = list.find((p) => p.key === personKey) ?? null;

  return (
    <div className="page">
      <header className="page-head">
        <div className="col">
          <h1 className="display">{t("People")}</h1>
          <span className="t-muted small">{t("Splits, money lent and money borrowed")}</span>
        </div>
        <ProfileButton />
      </header>

      <div className="people-summary">
        <div className="card col gap4">
          <span className="t-muted small">{t("Owed to you")}</span>
          <span className={`display num people-total${totals.owedToYou ? " in" : ""}`}>{formatMoney(totals.owedToYou)}</span>
        </div>
        <div className="card col gap4">
          <span className="t-muted small">{t("You owe")}</span>
          <span className={`display num people-total${totals.youOwe ? " owe" : ""}`}>{formatMoney(totals.youOwe)}</span>
        </div>
      </div>

      <div className="row gap8 wrap">
        <button className="btn" onClick={() => setEntry({ kind: "lent", person: "" })}><Icon name="plus" size={16} />{t("I lent money")}</button>
        <button className="btn" onClick={() => setEntry({ kind: "borrowed", person: "" })}><Icon name="plus" size={16} />{t("I borrowed money")}</button>
      </div>

      {list.length === 0 ? (
        <div className="card">
          <Empty title={t("No one here yet")}
            body={t("Open an expense and turn on Split, or type “dinner 1800 split with ravi, priya” in Smart add. Money you lend or borrow shows here too.")} />
        </div>
      ) : (
        <section className="col gap8">
          {open.length > 0 && (
            <>
              <div className="section-title"><span>{t("Open balances")}</span></div>
              <div className="card flush divided">
                {open.map((p) => <PersonRow key={p.key} p={p} onOpen={() => setPersonKey(p.key)} />)}
              </div>
            </>
          )}
          {open.length === 0 && <div className="card"><Empty title={t("All settled up")} body={t("Nobody owes anybody. Nice.")} /></div>}
          {settled.length > 0 && (
            <>
              <button className="btn ghost small-btn" style={{ alignSelf: "flex-start" }} onClick={() => setShowSettled(!showSettled)} aria-expanded={showSettled}>
                {showSettled ? t("Hide settled") : t("Settled ({n})", { n: settled.length })}
              </button>
              {showSettled && (
                <div className="card flush divided">
                  {settled.map((p) => <PersonRow key={p.key} p={p} onOpen={() => setPersonKey(p.key)} />)}
                </div>
              )}
            </>
          )}
        </section>
      )}

      <PaymentDetails />

      <PersonSheet person={person} onClose={() => setPersonKey(null)}
        onAdd={(kind) => { const name = person?.name ?? ""; setPersonKey(null); setEntry({ kind, person: name }); }} />
      <EntrySheet value={entry} known={list.map((p) => p.name)} onClose={() => setEntry(null)} />
    </div>
  );
}

function PersonRow({ p, onOpen }: { p: Person; onOpen: () => void }) {
  const shared = p.items.filter((i) => i.expenseId).length;
  return (
    <button className="list-row row-btn" onClick={onOpen}>
      <span className="person-avatar" aria-hidden="true">{initials(p.name)}</span>
      <span className="grow col" style={{ minWidth: 0 }}>
        <span className="t-strong ellipsis">{p.name}</span>
        <span className="tiny t-muted ellipsis">
          {shared ? (shared === 1 ? t("1 shared expense") : t("{n} shared expenses", { n: shared })) + " · " : ""}{t("last {date}", { date: day(p.lastAt) })}
        </span>
      </span>
      <span className="col" style={{ alignItems: "flex-end" }}>
        <span className={`t-strong num ${p.balance > 0 ? "in" : p.balance < 0 ? "owe" : ""}`}>{formatMoney(Math.abs(p.balance))}</span>
        <span className="tiny t-muted">{p.balance > 0 ? t("owes you") : p.balance < 0 ? t("you owe") : t("settled")}</span>
      </span>
    </button>
  );
}

function itemLabel(i: PersonItem, name: string): string {
  switch (i.kind) {
    case "split": return t("Their share of {what}", { what: i.title });
    case "paid-for-you": return t("{name} paid for {what}", { name, what: i.title });
    case "lent": return i.title ? t("You lent · {note}", { note: i.title }) : t("You lent");
    case "borrowed": return i.title ? t("You borrowed · {note}", { note: i.title }) : t("You borrowed");
    case "settled": return i.amount < 0 ? t("{name} paid you back", { name }) : t("You paid {name} back", { name });
  }
}

function PersonSheet({ person: p, onClose, onAdd }: { person: Person | null; onClose: () => void; onAdd: (kind: "lent" | "borrowed") => void }) {
  const s = useTally();
  const cloud = useCloud();
  if (!p) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;

  const name = s.settings.payName.trim() || cloud.user?.name || "";
  const what = unpaidTitles(p);
  const request = () => {
    const link = payLink(location.origin, { to: name, amount: p.balance, currency: s.settings.currency, note: what.join(", "), upi: s.settings.upiId });
    const amount = formatMoney(p.balance, { showPaise: true });
    return what.length
      ? t("Hi {name}, your share for {what} comes to {amount}. You can pay here: {link}", { name: p.name, what: what.join(", "), amount, link })
      : t("Hi {name}, you owe me {amount}. You can pay here: {link}", { name: p.name, amount, link });
  };
  const ask = async () => {
    const result = await shareText(request(), t("Payment request"));
    if (result === "copied") showToast(t("Message copied. Paste it in any chat."));
    if (result === "failed") showToast(t("Couldn't share from this browser"));
    if (result === "shared" || result === "copied") track("pay_request_shared", { via: result });
  };
  const settle = () => {
    const entry = { id: uid(), person: p.name, amount: -p.balance, kind: "settled" as const, note: "", occurredAt: Date.now(), createdAt: Date.now() };
    saveLedgerEntry(entry);
    showToast(t("Settled up with {name}", { name: p.name }), () => deleteLedgerEntry(entry.id, false));
  };

  return (
    <Sheet open onClose={onClose} title={p.name}>
      <div className="card col gap4" style={{ background: "var(--surface-2)", alignItems: "center", textAlign: "center" }}>
        <span className="t-muted small">
          {p.balance > 0 ? t("{name} owes you", { name: p.name }) : p.balance < 0 ? t("You owe {name}", { name: p.name }) : t("All settled up")}
        </span>
        <span className={`display num people-total ${p.balance > 0 ? "in" : p.balance < 0 ? "owe" : ""}`}>{formatMoney(Math.abs(p.balance), { showPaise: true })}</span>
      </div>

      {p.balance > 0 && (
        <div className="col gap8">
          <div className="row gap8">
            <button className="btn primary grow" onClick={() => void ask()}><Icon name="upload" size={18} />{t("Ask to pay")}</button>
            <button className="btn" onClick={() => { whatsapp(request()); track("pay_request_shared", { via: "whatsapp" }); }}>WhatsApp</button>
          </div>
          {!isUpiId(s.settings.upiId) && s.settings.currency === "INR" && (
            <span className="tiny t-muted">{t("Add your UPI ID at the bottom of People and the link opens their UPI app with the amount filled in.")}</span>
          )}
        </div>
      )}
      {p.balance !== 0 && (
        <button className="btn block" onClick={settle}><Icon name="check" size={18} />
          {p.balance > 0 ? t("{name} paid me back", { name: p.name }) : t("I paid {name} back", { name: p.name })}
        </button>
      )}
      <div className="row gap8">
        <button className="btn ghost small-btn" onClick={() => onAdd("lent")}><Icon name="plus" size={14} />{t("Lent more")}</button>
        <button className="btn ghost small-btn" onClick={() => onAdd("borrowed")}><Icon name="plus" size={14} />{t("Borrowed more")}</button>
      </div>

      <div className="col gap8">
        <span className="t-strong small">{t("History")}</span>
        <div className="card flush divided" style={{ background: "var(--surface-2)" }}>
          {p.items.map((i) => (
            <div key={i.key} className="list-row">
              <span className="grow col" style={{ minWidth: 0 }}>
                <span className="small ellipsis">{itemLabel(i, p.name)}</span>
                <span className="tiny t-muted">{day(i.at)}</span>
              </span>
              <span className={`num small t-strong ${i.amount > 0 ? "in" : "owe"}`}>{i.amount > 0 ? "+" : "−"}{formatMoney(Math.abs(i.amount))}</span>
              {i.entryId && (
                <button className="icon-btn" aria-label={t("Remove")} onClick={() => deleteLedgerEntry(i.entryId!)}><Icon name="close" size={16} /></button>
              )}
            </div>
          ))}
        </div>
        <span className="tiny t-muted">{t("+ means they owe you more, − means you owe them more. Shared expenses change when you edit the expense.")}</span>
      </div>
    </Sheet>
  );
}

const toDateInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function EntrySheet({ value, known, onClose }: { value: { kind: "lent" | "borrowed"; person: string } | null; known: string[]; onClose: () => void }) {
  const [person, setPerson] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(toDateInput(Date.now()));
  const [seen, setSeen] = useState<typeof value>(null);
  if (value !== seen) {
    setSeen(value);
    if (value) { setPerson(value.person); setAmount(""); setNote(""); setDate(toDateInput(Date.now())); }
  }
  const p = parsePaise(amount);
  const lent = value?.kind === "lent";
  const save = () => {
    if (!p || !person.trim()) return;
    const [y, m, d] = date.split("-").map(Number);
    const today = toDateInput(Date.now()) === date;
    saveLedgerEntry({
      id: uid(), person: person.trim(), amount: lent ? p : -p, kind: value!.kind, note: note.trim(),
      occurredAt: today ? Date.now() : new Date(y, m - 1, d, 12).getTime(), createdAt: Date.now(),
    });
    showToast(lent ? t("{name} owes you {amount}", { name: person.trim(), amount: formatMoney(p) }) : t("You owe {name} {amount}", { name: person.trim(), amount: formatMoney(p) }));
    onClose();
  };
  return (
    <Sheet open={value !== null} onClose={onClose} title={lent ? t("Money you lent") : t("Money you borrowed")}>
      <Field label={lent ? t("Who did you lend to?") : t("Who did you borrow from?")}>
        <input type="text" list="people-names" value={person} onChange={(e) => setPerson(e.target.value)} autoFocus={!value?.person} placeholder={t("Name")} />
      </Field>
      <datalist id="people-names">{known.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="row gap8">
        <Field label={`${t("Amount")} (${currencySymbol()})`}>
          <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus={!!value?.person} />
        </Field>
        <Field label={t("When")}><input type="date" value={date} max={toDateInput(Date.now())} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label={t("Note (optional)")}><input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Rent help, concert tickets…")} /></Field>
      <button className="btn primary block" disabled={!p || !person.trim()} onClick={save}>{t("Save")}</button>
      <p className="t-muted tiny" style={{ margin: 0 }}>{t("This doesn't count as spending. It only changes what you and they owe each other.")}</p>
    </Sheet>
  );
}

function PaymentDetails() {
  const s = useTally();
  const cloud = useCloud();
  const [name, setName] = useState(s.settings.payName);
  const [upi, setUpi] = useState(s.settings.upiId);
  const upiOk = !upi.trim() || isUpiId(upi);
  return (
    <section className="col gap8">
      <div className="section-title"><span>{t("Your payment details")}</span></div>
      <div className="card col gap12">
        <p className="t-muted small" style={{ margin: 0 }}>{t("Shown on the payment link you send. The link's details stay in the link; Tally doesn't store them on a server.")}</p>
        <div className="row gap8 wrap">
          <Field label={t("Your name")}>
            <input type="text" value={name} placeholder={cloud.user?.name || t("Name")} onChange={(e) => setName(e.target.value)}
              onBlur={() => setSettings({ payName: name.trim() })} />
          </Field>
          {s.settings.currency === "INR" && (
            <Field label={t("UPI ID")}>
              <input type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" value={upi} placeholder="name@okhdfcbank"
                onChange={(e) => setUpi(e.target.value)} onBlur={() => { if (upiOk) setSettings({ upiId: upi.trim() }); }} aria-invalid={!upiOk} />
            </Field>
          )}
        </div>
        {!upiOk && <span className="small" style={{ color: "var(--danger)" }}>{t("A UPI ID looks like name@bank.")}</span>}
      </div>
    </section>
  );
}
