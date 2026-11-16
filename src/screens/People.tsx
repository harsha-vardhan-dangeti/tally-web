import { useMemo, useRef, useState } from "react";
import { deleteLedgerEntry, importSplitwise, removeSplitwise, saveLedgerEntry, setSettings, showToast, uid, useTally } from "../data/store";
import { guessMe, parseSplitwise, planBalances, planSplitwise, type SplitwiseFile } from "../core/splitwise";
import { AccountHint, AccountSelect } from "../ui/AccountSelect";
import { useCloud } from "../data/cloud";
import { track } from "../data/telemetry";
import { isUpiId, payLink, people, peopleTotals, unpaidTitles, type Person, type PersonItem } from "../core/people";
import { currencySymbol, formatMoney, parsePaise } from "../core/money";
import { dateLocale, t } from "../i18n";
import { Icon } from "../ui/icons";
import { Empty, Field, Sheet, Toggle } from "../ui/components";
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
  const [entry, setEntry] = useState<EntryRequest | null>(null);
  const [splitwise, setSplitwise] = useState(false);
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
        <button className="btn ghost" onClick={() => setSplitwise(true)}><Icon name="download" size={16} />{t("Import from Splitwise")}</button>
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
        onAdd={(kind, amount) => { const name = person?.name ?? ""; setPersonKey(null); setEntry({ kind, person: name, amount }); }} />
      <EntrySheet value={entry} known={list.map((p) => p.name)} onClose={() => setEntry(null)} />
      <SplitwiseSheet open={splitwise} known={list.map((p) => p.name)} onClose={() => setSplitwise(false)} />
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
  // Splitwise rows are shares of shared expenses.
  if (i.entryId?.startsWith("sw-") && i.kind === "lent") return t("Their share of {what}", { what: i.title });
  if (i.entryId?.startsWith("sw-") && i.kind === "borrowed") return t("{name} paid for {what}", { name, what: i.title });
  switch (i.kind) {
    case "split": return t("Their share of {what}", { what: i.title });
    case "paid-for-you": return t("{name} paid for {what}", { name, what: i.title });
    case "lent": return i.title ? t("You lent · {note}", { note: i.title }) : t("You lent");
    case "borrowed": return i.title ? t("You borrowed · {note}", { note: i.title }) : t("You borrowed");
    case "settled": return i.amount < 0 ? t("{name} paid you back", { name }) : t("You paid {name} back", { name });
  }
}

function PersonSheet({ person: p, onClose, onAdd }: { person: Person | null; onClose: () => void; onAdd: (kind: EntryKind, amount?: number) => void }) {
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
        <button className="btn block" onClick={() => onAdd("settled", -p.balance)}><Icon name="check" size={18} />
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
                <span className="tiny t-muted">{day(i.at)}{i.account ? ` · ${i.amount > 0 ? t("from {account}", { account: i.account }) : t("into {account}", { account: i.account })}` : ""}{i.entryId?.startsWith("sw-") ? " · Splitwise" : ""}</span>
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

type EntryKind = "lent" | "borrowed" | "settled";
/** A sheet to record money lent, borrowed or paid back. For "settled", `amount` is the change: − they paid you, + you paid them. */
interface EntryRequest { kind: EntryKind; person: string; amount?: number }

function EntrySheet({ value, known, onClose }: { value: EntryRequest | null; known: string[]; onClose: () => void }) {
  const s = useTally();
  const [person, setPerson] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(toDateInput(Date.now()));
  const [account, setAccount] = useState("");
  const [seen, setSeen] = useState<typeof value>(null);
  if (value !== seen) {
    setSeen(value);
    if (value) {
      setPerson(value.person); setAmount(value.amount ? String(Math.abs(value.amount) / 100) : ""); setNote("");
      setDate(toDateInput(Date.now())); setAccount(s.settings.defaultAccount);
    }
  }
  const p = parsePaise(amount);
  const kind = value?.kind ?? "lent";
  // + when the money leaves you: you lent it, or you paid them back.
  const sign = kind === "lent" || (kind === "settled" && (value?.amount ?? 0) > 0) ? 1 : -1;
  const leaves = sign > 0;
  const name = person.trim();
  const save = () => {
    if (!p || !name) return;
    const [y, m, d] = date.split("-").map(Number);
    const today = toDateInput(Date.now()) === date;
    const entry = {
      id: uid(), person: name, amount: sign * p, kind, note: note.trim(),
      occurredAt: today ? Date.now() : new Date(y, m - 1, d, 12).getTime(), createdAt: Date.now(),
      ...(account.trim() ? { account: account.trim() } : {}),
    };
    saveLedgerEntry(entry);
    const undo = () => deleteLedgerEntry(entry.id, false);
    if (kind === "settled") showToast(t("Recorded {amount} with {name}", { amount: formatMoney(p), name }), undo);
    else showToast(kind === "lent" ? t("{name} owes you {amount}", { name, amount: formatMoney(p) }) : t("You owe {name} {amount}", { name, amount: formatMoney(p) }), undo);
    onClose();
  };
  const title = kind === "lent" ? t("Money you lent") : kind === "borrowed" ? t("Money you borrowed")
    : leaves ? t("You paid {name} back", { name }) : t("{name} paid you back", { name });
  return (
    <Sheet open={value !== null} onClose={onClose} title={title}>
      {kind !== "settled" && (
        <Field label={kind === "lent" ? t("Who did you lend to?") : t("Who did you borrow from?")}>
          <input type="text" list="people-names" value={person} onChange={(e) => setPerson(e.target.value)} autoFocus={!value?.person} placeholder={t("Name")} />
        </Field>
      )}
      <datalist id="people-names">{known.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="row gap8">
        <Field label={`${t("Amount")} (${currencySymbol()})`}>
          <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus={!!value?.person} />
        </Field>
        <Field label={t("When")}><input type="date" value={date} max={toDateInput(Date.now())} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label={leaves ? t("Paid from") : t("Received into")}>
        <AccountSelect value={account} onChange={setAccount} label={leaves ? t("Paid from") : t("Received into")} />
      </Field>
      {leaves && <AccountHint account={account} amount={p ?? 0} />}
      {kind === "settled" && value?.amount && p && p < Math.abs(value.amount) ? (
        <span className="tiny t-muted">{t("Part of it: {left} will still be open.", { left: formatMoney(Math.abs(value.amount) - p) })}</span>
      ) : null}
      {kind !== "settled" && <Field label={t("Note (optional)")}><input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Rent help, concert tickets…")} /></Field>}
      <button className="btn primary block" disabled={!p || !name} onClick={save}>{t("Save")}</button>
      <p className="t-muted tiny" style={{ margin: 0 }}>{t("This doesn't count as spending. It changes what you and they owe each other, and the balance of the account you pick if Tally follows it.")}</p>
    </Sheet>
  );
}

function RateField({ currency }: { currency: string }) {
  const s = useTally();
  const [rate, setRate] = useState("");
  const save = () => {
    const r = Number(rate);
    if (r > 0 && Number.isFinite(r)) setSettings({ fxRates: { ...s.settings.fxRates, [currency]: r } });
  };
  return (
    <Field label={t("1 {currency} in {home}", { currency, home: s.settings.currency })}>
      <input type="text" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); }} placeholder="83.2" />
    </Field>
  );
}

/** "flat-302_2026-11-16_export.csv" → "flat 302". */
const groupFromFile = (name: string) => name.replace(/\.[a-z]+$/i, "").replace(/_\d{4}-\d{2}-\d{2}_export$/i, "").replace(/[_-]+/g, " ").trim();

function SplitwiseSheet({ open, known, onClose }: { open: boolean; known: string[]; onClose: () => void }) {
  const s = useTally();
  const cloud = useCloud();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<SplitwiseFile | null>(null);
  const [error, setError] = useState("");
  const [me, setMe] = useState(-1);
  const [names, setNames] = useState<string[]>([]);
  const [group, setGroup] = useState("");
  const [addSpending, setAddSpending] = useState(true);
  // Rows whose default (in, or out when it looks already logged) the user flipped.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(false);
  if (open !== seen) {
    setSeen(open);
    if (open) { setFile(null); setError(""); setMe(-1); setFlipped(new Set()); setAddSpending(true); }
  }

  const choose = async (f: File) => {
    const parsed = parseSplitwise(await f.text());
    if (!parsed) { setFile(null); setError(t("This doesn't look like a Splitwise export. In Splitwise, open the group, then Settings → Export as spreadsheet.")); return; }
    setError("");
    setFile(parsed);
    setNames(parsed.members);
    setGroup(groupFromFile(f.name));
    setMe(guessMe(parsed.members, [s.settings.payName, cloud.user?.name ?? ""]));
    setFlipped(new Set());
  };

  const rows = useMemo(() => {
    if (!file || me < 0) return [];
    const eIds = new Set(s.expenses.map((e) => e.id)), lIds = new Set(s.ledger.map((l) => l.id));
    return planSplitwise({
      file, me, names, home: s.settings.currency, rates: s.settings.fxRates, has: (id) => eIds.has(id) || lIds.has(id),
      existing: s.expenses.filter((e) => !e.id.startsWith("sw-")).map((e) => ({ amount: e.amount, at: e.occurredAt })),
    });
  }, [file, me, names, s.expenses, s.ledger, s.settings.currency, s.settings.fxRates]);
  const open_ = rows.filter((r) => !r.imported && !r.noRate);
  const included = (r: (typeof rows)[number]) => r.maybeLogged ? flipped.has(r.key) : !flipped.has(r.key);
  const chosen = open_.filter(included);
  const balances = [...planBalances(chosen).values()].filter((b) => b.amount !== 0);
  const spend = chosen.reduce((t, r) => t + r.share, 0);
  const imported = rows.filter((r) => r.imported).length;
  const noRate = rows.filter((r) => r.noRate && !r.imported).length;
  const total = file?.totals && me >= 0 ? file.totals[me] : null;
  const missing = file ? [...new Set(file.rows.map((r) => r.currency).filter((c) => c && c !== s.settings.currency && !s.settings.fxRates[c]))] : [];
  const toggle = (key: string) => setFlipped((f) => { const n = new Set(f); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const run = async () => {
    setBusy(true);
    const ids = await importSplitwise(chosen, { group, addSpending });
    setBusy(false);
    onClose();
    showToast(t("Imported from Splitwise · {n} rows", { n: chosen.length }), () => removeSplitwise(ids.expenseIds, ids.ledgerIds));
  };

  return (
    <Sheet open={open} onClose={onClose} title={t("Import from Splitwise")}>
      {!file && (
        <div className="col gap8">
          <p className="small" style={{ margin: 0 }}>{t("In Splitwise, open the group (your flat, a trip), then Settings → Export as spreadsheet. Choose that CSV here.")}</p>
          <p className="t-muted tiny" style={{ margin: 0 }}>{t("Your share of each expense goes into your spending, and what each person owes you shows in People. Import again next month: rows already in Tally are skipped.")}</p>
        </div>
      )}
      <button className="btn block" onClick={() => fileRef.current?.click()}><Icon name="upload" size={18} />{file ? t("Choose another file") : t("Choose Splitwise CSV")}</button>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void choose(f); }} />
      {error && <span className="small" style={{ color: "var(--danger)" }}>{error}</span>}

      {file && (
        <>
          <div className="row gap8">
            <Field label={t("Which one is you?")}>
              <select value={me} onChange={(e) => { setMe(Number(e.target.value)); setFlipped(new Set()); }}>
                <option value={-1}>{t("Choose")}</option>
                {file.members.map((m, i) => <option key={m + i} value={i}>{m}</option>)}
              </select>
            </Field>
            <Field label={t("Group")}><input type="text" value={group} onChange={(e) => setGroup(e.target.value)} placeholder={t("Flat 302")} /></Field>
          </div>

          {me >= 0 && (
            <>
              <div className="col gap8">
                <span className="t-strong small">{t("Names in Tally")}</span>
                {file.members.map((m, i) => i === me ? null : (
                  <div key={m + i} className="row gap8" style={{ alignItems: "center" }}>
                    <span className="small t-muted ellipsis" style={{ width: "38%" }}>{m}</span>
                    <input type="text" list="splitwise-names" aria-label={t("Name in Tally for {name}", { name: m })} value={names[i] ?? ""}
                      onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))} />
                  </div>
                ))}
                <datalist id="splitwise-names">{known.map((n) => <option key={n} value={n} />)}</datalist>
              </div>

              <div className="card" style={{ background: "var(--surface-2)", padding: "0 14px" }}>
                <Toggle label={t("Add my share to spending")} checked={addSpending} onChange={setAddSpending}
                  hint={t("Turn off if you already log these expenses in Tally yourself.")} />
              </div>

              <div className="card col gap8" style={{ background: "var(--surface-2)" }} aria-live="polite">
                <span className="small t-strong">
                  {chosen.length === 1 ? t("1 row to import") : t("{n} rows to import", { n: chosen.length })}
                  {addSpending && spend ? ` · ${t("{amount} of your spending", { amount: formatMoney(spend) })}` : ""}
                </span>
                {balances.map((b) => (
                  <div key={b.name} className="row between small">
                    <span>{b.amount > 0 ? t("{name} owes you", { name: b.name }) : t("You owe {name}", { name: b.name })}</span>
                    <span className={`num t-strong ${b.amount > 0 ? "in" : "owe"}`}>{formatMoney(Math.abs(b.amount))}</span>
                  </div>
                ))}
                {total !== null && (
                  <span className="tiny t-muted">{total > 0 ? t("Splitwise says you're owed {amount} in this group.", { amount: formatMoney(total) })
                    : total < 0 ? t("Splitwise says you owe {amount} in this group.", { amount: formatMoney(-total) }) : t("Splitwise says you're settled up in this group.")}</span>
                )}
                {imported > 0 && <span className="tiny t-muted">{imported === 1 ? t("1 row was imported before and is skipped.") : t("{n} rows were imported before and are skipped.", { n: imported })}</span>}
                {noRate > 0 && <span className="tiny" style={{ color: "var(--warn)" }}>{t("{n} rows are in another currency. Add its rate below to include them.", { n: noRate })}</span>}
              </div>
              {missing.map((c) => <RateField key={c} currency={c} />)}

              {open_.length > 0 && (
                <div className="card flush divided splitwise-rows" style={{ background: "var(--surface-2)" }}>
                  {open_.map((r) => (
                    <label key={r.key} className="list-row" style={{ cursor: "pointer" }}>
                      <input type="checkbox" checked={included(r)} onChange={() => toggle(r.key)} />
                      <span className="grow col" style={{ minWidth: 0 }}>
                        <span className="small ellipsis">{r.description}</span>
                        <span className="tiny t-muted ellipsis">
                          {day(r.date.getTime())}{r.payment ? ` · ${t("payment")}` : ""}{r.maybeLogged ? ` · ${t("maybe already in Tally")}` : ""}
                        </span>
                      </span>
                      {r.share > 0 && <span className="num small">{formatMoney(r.share)}</span>}
                    </label>
                  ))}
                </div>
              )}

              <button className="btn primary block" disabled={!chosen.length || busy} onClick={() => void run()}>
                {busy ? t("Importing…") : chosen.length ? t("Import {n} rows", { n: chosen.length }) : t("Nothing new to import")}
              </button>
            </>
          )}
        </>
      )}
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
