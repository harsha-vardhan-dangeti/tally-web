import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  budgetSnapshot, counts, deleteExpense, eraseAll, exportCSV, exportJSON, expenseTitle, getState, inMonth, restoreBackup,
  setSettings, share, showToast, SOURCE_LABEL, undoRestore, updateExpense, useTally, type Expense,
} from "../data/store";
import { BackupError, parseBackup, type Backup } from "../data/backup";
import { backupFileName, download } from "../ui/download";
import { addMonths, snapshot, startOfDay } from "../core/budget";
import { allCategories, categoryMeta, pickableCategories, type Category } from "../core/categories";
import { formatMoney, parsePaise } from "../core/money";
import { Icon } from "../ui/icons";
import { Empty, Field, Sheet, SwipeRow, Toggle } from "../ui/components";
import { ExpenseRowView, SwipeExpense } from "./Activity";
import { enableLock, lockSupported } from "./lock";
import { AccountSection, GoogleButton } from "./Account";
import { ImportSheet } from "./Import";
import { CategoriesSheet } from "./Categories";
import { RulesSheet } from "./Rules";
import { cloudAvailable, useCloud } from "../data/cloud";

// ---------------- Inbox ----------------

export function Inbox({ onOpen }: { onOpen: (e: Expense) => void }) {
  const s = useTally();
  const pending = s.expenses.filter((e) => e.pending);
  const origin = typeof location !== "undefined" ? location.origin : "";

  const confirm = (e: Expense) => {
    updateExpense(e.id, { pending: false });
    showToast(`Confirmed ${expenseTitle(e)}`, () => updateExpense(e.id, { pending: true }));
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="col"><h1 className="display">Inbox</h1><span className="t-muted small">Captured payments wait here until you confirm them.</span></div>
        {pending.length > 1 && (
          <button className="btn" onClick={() => {
            pending.forEach((e) => updateExpense(e.id, { pending: false }));
            showToast(`Confirmed ${pending.length} expenses`, () => pending.forEach((e) => updateExpense(e.id, { pending: true })));
          }}>Confirm all</button>
        )}
      </header>

      {pending.length === 0 ? (
        <div className="card"><Empty title="All caught up" body="Payments captured from an iPhone Shortcut or Apple Pay automation land here for a one-tap confirm." /></div>
      ) : (
        <div className="card flush">
          {pending.map((e) => (
            <SwipeRow key={e.id} onOpen={() => onOpen(e)} onFullLeft={() => deleteExpense(e.id)}
              left={[{ label: "Discard", icon: "close", color: "#C2321F", run: () => deleteExpense(e.id) }]}
              right={[{ label: "Confirm", icon: "check", color: "#0B7A47", run: () => confirm(e) }]}>
              <div className="col">
                <div style={{ padding: "8px 14px 0" }} className="tiny t-muted">{SOURCE_LABEL[e.source]} · {new Date(e.occurredAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</div>
                <ExpenseRowView e={e} />
                <div className="row gap8" style={{ padding: "0 14px 12px" }} onPointerDown={(ev) => ev.stopPropagation()} onPointerUp={(ev) => ev.stopPropagation()}>
                  <select aria-label="Category" value={e.category} onChange={(ev) => updateExpense(e.id, { category: ev.target.value as Category })} style={{ flex: 1 }}>
                    {pickableCategories(e.category).map((c) => <option key={c} value={c}>{categoryMeta(c).title}</option>)}
                  </select>
                  <button className="icon-btn" aria-label="Discard" onClick={() => deleteExpense(e.id)}><Icon name="close" size={18} /></button>
                  <button className="btn primary" onClick={() => confirm(e)}>Confirm</button>
                </div>
              </div>
            </SwipeRow>
          ))}
        </div>
      )}
      {pending.length > 0 && <p className="t-muted tiny" style={{ textAlign: "center", margin: 0 }}>Swipe right to confirm, left to discard</p>}

      <section className="col gap8">
        <div className="section-title"><span>Log from anywhere on your iPhone</span></div>
        <div className="card col gap12 small">
          <Tip title="One-tap Shortcut (Action Button, Back Tap, Siri)">
            Shortcuts app → <b>+</b> → add action <b>Open URLs</b> with<br />
            <code className="inline">{origin}/app?log=180&amp;note=Coffee&amp;cat=food</code><br />
            Name it “Log coffee”. Then assign it in Settings → Action Button, or Accessibility → Touch → Back Tap, or just say “Hey Siri, log coffee”.
          </Tip>
          <Tip title="Apple Pay automation → Inbox">
            Shortcuts → Automation → <b>+</b> → <b>Transaction</b> → your cards → Run Immediately → action <b>Open URLs</b>:<br />
            <code className="inline">{origin}/app?capture=[Amount]&amp;merchant=[Merchant]</code><br />
            (insert the Amount and Merchant variables). Each tap-to-pay lands here as pending.
          </Tip>
          <Tip title="Important on iPhone">
            Shortcuts open links in <b>Safari</b>. If you use Tally from a Home Screen icon, turn off <b>Open as Web App</b> when adding it, so it shares Safari's data. Otherwise the two keep separate data.
          </Tip>
        </div>
      </section>
    </div>
  );
}

function Tip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="col gap4">
      <span className="t-strong">{title}</span>
      <span className="t-muted" style={{ lineHeight: 1.6 }}>{children}</span>
    </div>
  );
}

// ---------------- Search ----------------

export function Search({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (e: Expense) => void }) {
  const s = useTally();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | null>(null);
  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    return s.expenses.filter((e) => !e.pending && (!cat || e.category === cat) &&
      (!query || [e.merchant, e.note, e.account, categoryMeta(e.category).title, (e.amount / 100).toString()].some((f) => f.toLowerCase().includes(query))));
  }, [q, cat, s.expenses]);
  const total = results.reduce((t, e) => t + share(e), 0);

  return (
    <Sheet open={open} onClose={onClose} title="Search">
      <input type="search" autoFocus placeholder="Merchant, note, amount…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search expenses" />
      <div className="chips" style={{ margin: "0 -20px", padding: "2px 20px" }}>
        {pickableCategories().map((c) => (
          <button key={c} className={`chip${cat === c ? " on" : ""}`} aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>{categoryMeta(c).title}</button>
        ))}
      </div>
      <div className="row between small"><span className="t-strong">{results.length} results</span><span className="t-strong num">{formatMoney(total)}</span></div>
      <div className="card flush" style={{ background: "var(--surface-2)" }}>
        {results.slice(0, 200).map((e) => <SwipeExpense key={e.id} e={e} onOpen={() => onOpen(e)} />)}
        {results.length === 0 && <Empty title="No matches" body="Try a merchant name, a note or an amount." />}
      </div>
    </Sheet>
  );
}

// ---------------- Recap ----------------

export function Recap({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useTally();
  const now = new Date();
  const snap = budgetSnapshot(s, now);
  const thisMonth = inMonth(s.expenses, now).filter(counts);
  const last = addMonths(now, -1);
  const lastSoFar = inMonth(s.expenses, last).filter((e) => counts(e) && new Date(e.occurredAt).getDate() <= now.getDate());
  const sum = (l: Expense[], c: Category) => l.filter((e) => e.category === c).reduce((t, e) => t + share(e), 0);
  const changes = allCategories().map(({ id: c }) => ({ c, now: sum(thisMonth, c), before: sum(lastSoFar, c) }))
    .filter((x) => x.now || x.before).sort((a, b) => Math.abs(b.now - b.before) - Math.abs(a.now - a.before)).slice(0, 5);
  const biggest = [...thisMonth].sort((a, b) => share(b) - share(a))[0];
  const spendDays = new Set(thisMonth.map((e) => new Date(e.occurredAt).getDate()));
  const noSpend = Array.from({ length: now.getDate() - 1 }, (_, i) => i + 1).filter((d) => !spendDays.has(d)).length;
  const logged = new Set(s.expenses.filter((e) => !e.pending).map((e) => startOfDay(new Date(e.occurredAt)).getTime()));
  let streak = 0;
  let d = startOfDay(now);
  if (!logged.has(d.getTime())) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  while (logged.has(d.getTime())) { streak++; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1); }
  const diff = snap.budget - snap.projected;
  const projSnap = snapshot(snap.budget, snap.projected, 0, now);

  return (
    <Sheet open={open} onClose={onClose} title={`${now.toLocaleDateString([], { month: "long" })} so far`}>
      <div className="card col gap8" style={{ background: "var(--surface-2)" }}>
        <span className="t-muted small">Forecast for month end</span>
        <span className="display num" style={{ fontSize: 26 }}>You'll spend about {formatMoney(snap.projected)}</span>
        {snap.hasBudget && (
          <>
            <span className="t-strong small" style={{ color: diff >= 0 ? "var(--good)" : "var(--danger)" }}>
              {formatMoney(Math.abs(diff))} {diff >= 0 ? "under" : "over"} budget at this pace
            </span>
            <div className="progress" style={{ display: "flex" }}>
              <div style={{ width: `${Math.min(snap.fractionUsed, 1) * 100}%`, background: "var(--accent)", borderRadius: 0 }} />
              <div style={{ width: `${Math.max(Math.min(projSnap.fractionUsed, 1) - Math.min(snap.fractionUsed, 1), 0) * 100}%`,
                background: "repeating-linear-gradient(135deg, var(--accent) 0 5px, transparent 5px 10px)", opacity: 0.6, borderRadius: 0 }} />
            </div>
            <div className="row between tiny t-muted num"><span>Spent {formatMoney(snap.spent)}</span><span>Budget {formatMoney(snap.budget)}</span></div>
          </>
        )}
        <span className="tiny t-muted">Based on your daily average so far. Bills due later this month aren't included.</span>
      </div>

      {changes.length > 0 && (
        <div className="col gap8">
          <span className="t-strong small">Compared with this point last month</span>
          <div className="card flush divided" style={{ background: "var(--surface-2)" }}>
            {changes.map(({ c, now: n, before }) => {
              const pct = before ? Math.round(((n - before) / before) * 100) : null;
              return (
                <div key={c} className="list-row">
                  <span className="grow col"><span className="t-strong">{categoryMeta(c).title}</span>
                    <span className="tiny t-muted num">{formatMoney(n)} vs {formatMoney(before)}</span></span>
                  <span className={`tag ${pct === null ? "" : pct > 0 ? "warn" : "good"}`}>{pct === null ? "new" : `${pct > 0 ? "+" : ""}${pct}%`}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card flush divided" style={{ background: "var(--surface-2)" }}>
        {biggest && <div className="list-row"><span className="grow t-muted">Biggest spend</span><span className="t-strong">{expenseTitle(biggest)} · {formatMoney(share(biggest))}</span></div>}
        <div className="list-row"><span className="grow t-muted">No-spend days</span><span className="t-strong">{noSpend}</span></div>
        <div className="list-row"><span className="grow t-muted">Logging streak</span><span className="t-strong">{streak} day{streak === 1 ? "" : "s"}</span></div>
        {s.settings.monthlyIncome > 0 && (
          <div className="list-row"><span className="grow t-muted">Saved of income so far</span>
            <span className="t-strong">{Math.round(((s.settings.monthlyIncome - snap.spent) / s.settings.monthlyIncome) * 100)}%</span></div>
        )}
      </div>
    </Sheet>
  );
}

// ---------------- Settings ----------------

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useTally();
  const signedIn = useCloud().user !== null;
  const [budget, setBudget] = useState("");
  const [income, setIncome] = useState("");
  const [seen, setSeen] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const [importing, setImporting] = useState(false);
  const [categories, setCategories] = useState(false);
  const [rules, setRules] = useState(false);
  const [incoming, setIncoming] = useState<Backup | null>(null);
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  if (open !== seen) {
    setSeen(open);
    if (open) {
      setBudget(s.settings.monthlyBudget ? String(s.settings.monthlyBudget / 100) : "");
      setIncome(s.settings.monthlyIncome ? String(s.settings.monthlyIncome / 100) : "");
      setConfirmErase(false);
      setIncoming(null);
    }
  }
  // After a restore the form must show the new budget, or closing Settings would write the old one back.
  const syncForm = () => {
    const { monthlyBudget, monthlyIncome } = getState().settings;
    setBudget(monthlyBudget ? String(monthlyBudget / 100) : "");
    setIncome(monthlyIncome ? String(monthlyIncome / 100) : "");
  };
  const restore = async (backup: Backup) => {
    setRestoring(true);
    try {
      await restoreBackup(backup);
      syncForm();
      setIncoming(null);
      showToast(`Restored ${backup.expenses.length} expenses`, () => { void undoRestore().then(() => { syncForm(); showToast("Swapped in your earlier data"); }); });
    } catch {
      showToast("Couldn't restore. Nothing on this device was changed.");
    } finally {
      setRestoring(false);
    }
  };
  const close = () => {
    setSettings({ monthlyBudget: parsePaise(budget) ?? 0, monthlyIncome: parsePaise(income) ?? 0 });
    onClose();
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const count = (n: number, noun: string, plural = `${noun}s`) => `${n} ${n === 1 ? noun : plural}`;
  const date = (t: number) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

  return (
    <>
      <Sheet open={open} onClose={close} title="Settings">
        <div className="row gap8">
          <Field label="Monthly budget (₹)"><input type="text" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="55000" /></Field>
          <Field label="Monthly income (₹)"><input type="text" inputMode="numeric" value={income} onChange={(e) => setIncome(e.target.value)} placeholder="optional" /></Field>
        </div>
        <p className="t-muted tiny" style={{ margin: 0 }}>Safe to spend today = what's left ÷ days left. Leave rent out of the budget if you track it as a bill.</p>

        <AccountSection />

        <div className="card flush divided" style={{ background: "var(--surface-2)", boxShadow: "none" }}>
          <button className="list-row row-btn" onClick={() => setCategories(true)}>
            <Icon name="grid" size={20} />
            <span className="grow col"><span className="t-strong">Categories</span>
              <span className="t-muted tiny">Add your own, rename or hide them</span></span>
            <Icon name="next" size={16} />
          </button>
          <button className="list-row row-btn" onClick={() => setRules(true)}>
            <Icon name="split" size={20} />
            <span className="grow col"><span className="t-strong">Rules</span>
              <span className="t-muted tiny">{s.settings.rules.length ? `${s.settings.rules.length} rule${s.settings.rules.length === 1 ? "" : "s"} · ` : ""}“Swiggy is always Food”</span></span>
            <Icon name="next" size={16} />
          </button>
        </div>

        <div className="card" style={{ background: "var(--surface-2)", padding: "0 14px" }}>
          <Toggle label="Lock with Face ID / Touch ID" hint={lockSupported() ? "A privacy screen using your device's passkey sign-in. It does not encrypt data." : "Not supported in this browser"}
            checked={!!s.settings.lockCredentialId}
            onChange={async (v) => {
              if (!v) return setSettings({ lockCredentialId: null });
              const id = await enableLock();
              if (id) { setSettings({ lockCredentialId: id }); showToast("App lock on"); }
              else showToast("Couldn't turn on the lock in this browser");
            }} />
        </div>

        <div className="col gap8">
          <span className="t-strong small">Your data</span>
          <p className="t-muted small" style={{ margin: 0 }}>
            {signedIn
              ? "Stored in this browser and synced to your account. Other Tally users can't see it."
              : "Everything is stored only in this browser on this device. No account, no server, no tracking."}
            {s.settings.lastBackupAt ? ` Last backup ${new Date(s.settings.lastBackupAt).toLocaleDateString()}.` : " Back up regularly — clearing website data deletes it."}
          </p>
          <div className="row gap8 wrap">
            <button className="btn" onClick={() => { download(backupFileName(), exportJSON(), "application/json"); setSettings({ lastBackupAt: Date.now() }); }}>
              <Icon name="download" size={18} />Back up (JSON)
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload" size={18} />Restore</button>
            <button className="btn" onClick={() => download(`tally-${stamp}.csv`, exportCSV(), "text/csv")}>Export CSV</button>
            <button className="btn" onClick={() => setImporting(true)}><Icon name="upload" size={18} />Import bank statement</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try { setIncoming(parseBackup(await f.text())); }
              catch (err) { showToast(err instanceof BackupError ? err.message : "Couldn't read that file. Nothing on this device was changed."); }
            }} />
          </div>
          {incoming && (
            <div className="card col gap8" style={{ background: "var(--warn-soft)" }} role="alertdialog" aria-label="Confirm restore">
              <span className="small t-strong" style={{ color: "var(--warn)" }}>Replace the data on this device?</span>
              <span className="small">
                The backup{incoming.exportedAt ? ` from ${date(Date.parse(incoming.exportedAt))}` : ""} has {count(incoming.expenses.length, "expense")},
                {" "}{count(incoming.incomes.length, "income entry", "income entries")}, {count(incoming.bills.length, "bill")},
                {" "}{count(incoming.accounts.length, "account")} and {count(incoming.goals.length, "goal")}.
                It replaces the {count(s.expenses.length, "expense")} here. You can put the current data back afterwards.
                {incoming.skipped > 0 && ` ${count(incoming.skipped, "unreadable row")} will be left out.`}
              </span>
              <div className="row gap8">
                <button className="btn" onClick={() => setIncoming(null)} disabled={restoring}>Cancel</button>
                <button className="btn primary" onClick={() => restore(incoming)} disabled={restoring}>{restoring ? "Restoring…" : "Replace and restore"}</button>
              </div>
            </div>
          )}
          {s.restorePointAt && !incoming && (
            <div className="row gap8 between small" style={{ flexWrap: "wrap" }}>
              <span className="t-muted">Tally kept a copy of the data it replaced on {date(s.restorePointAt)}. Swapping keeps a copy of what's here now.</span>
              <button className="btn ghost" onClick={async () => {
                try { await undoRestore(); syncForm(); showToast("Swapped in your earlier data"); }
                catch (err) { showToast((err as Error).message); }
              }}>Swap it back</button>
            </div>
          )}
        </div>

        {!confirmErase ? (
          <button className="btn danger block" onClick={() => setConfirmErase(true)}>Delete all data</button>
        ) : (
          <div className="card col gap8" style={{ background: "var(--danger-soft)" }}>
            <span className="small" style={{ color: "var(--danger)" }}>{signedIn ? "Delete every expense, bill, goal and account from this browser and from your account on all your devices? This can't be undone." : "Delete every expense, bill, goal and account? This can't be undone."}</span>
            <div className="row gap8">
              <button className="btn" onClick={() => setConfirmErase(false)}>Cancel</button>
              <button className="btn primary" style={{ background: "var(--danger)" }} onClick={async () => { await eraseAll(); showToast("All data deleted"); setConfirmErase(false); }}>Delete everything</button>
            </div>
          </div>
        )}
        <p className="t-muted tiny" style={{ margin: 0 }}>Keyboard: <span className="kbd">N</span> new expense · <span className="kbd">S</span> smart add · <span className="kbd">/</span> search · <span className="kbd">Esc</span> close</p>
      </Sheet>
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
      <CategoriesSheet open={categories} onClose={() => setCategories(false)} />
      <RulesSheet open={rules} onClose={() => setRules(false)} />
    </>
  );
}

// ---------------- Onboarding ----------------

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [budget, setBudget] = useState("");
  const [income, setIncome] = useState("");
  const b = parsePaise(budget) ?? 0;
  const preview = b ? snapshot(b, 0, 0, new Date()) : null;

  const finish = () => {
    setSettings({ onboarded: true, monthlyBudget: b, monthlyIncome: parsePaise(income) ?? 0 });
  };

  return (
    <div className="page" style={{ minHeight: "100dvh", maxWidth: 520, paddingBottom: 32 }}>
      <div className="steps" aria-label={`Step ${step + 1} of 3`}>{[0, 1, 2].map((i) => <span key={i} className={i <= step ? "on" : ""} />)}</div>
      {step === 0 && (
        <div className="col gap16" style={{ paddingTop: 24 }}>
          <span className="cat-icon" style={{ width: 64, height: 64, background: "var(--accent)", color: "var(--accent-ink)", borderRadius: 18 }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 5v14M10 5v14M14 5v14M18 5v14M4 15L20 9" /></svg>
          </span>
          <h1 className="display" style={{ fontSize: 34, lineHeight: 1.1 }}>Log a spend in 3 seconds.</h1>
          <p className="t-muted" style={{ margin: 0 }}>Tap a repeat, type a sentence, or fire a Shortcut from your Action Button. Tally turns it into one number: what's safe to spend today.</p>
          <div className="col gap8 small">
            <span>• Private — stays in your browser unless you turn on sync</span>
            <span>• No sign-up, no bank login</span>
            <span>• Works offline once loaded</span>
          </div>
          {cloudAvailable && (
            <div className="col gap8" style={{ paddingTop: 8 }}>
              <span className="t-muted small">Already use Tally on another device?</span>
              <GoogleButton label="Sign in with Google to sync" />
            </div>
          )}
        </div>
      )}
      {step === 1 && (
        <div className="col gap16" style={{ paddingTop: 24 }}>
          <h1 className="display" style={{ fontSize: 30, lineHeight: 1.15 }}>How much do you want to spend each month?</h1>
          <p className="t-muted" style={{ margin: 0 }}>Leave out rent and investments if you'll add them as bills.</p>
          <input type="text" inputMode="numeric" autoFocus aria-label="Monthly budget in rupees" placeholder="₹ 55,000" value={budget}
            onChange={(e) => setBudget(e.target.value)} className="display" style={{ fontSize: 30, minHeight: 72 }} />
          <input type="text" inputMode="numeric" aria-label="Monthly income (optional)" placeholder="Monthly income (optional)" value={income} onChange={(e) => setIncome(e.target.value)} />
          {preview && <div className="card"><span className="t-muted small">Today you could spend</span><div className="display num" style={{ fontSize: 24 }}>{formatMoney(preview.safePerDay)}</div></div>}
        </div>
      )}
      {step === 2 && (
        <div className="col gap16" style={{ paddingTop: 24 }}>
          <h1 className="display" style={{ fontSize: 30 }}>Put Tally one tap away</h1>
          <div className="card col gap8 small">
            <span className="t-strong">iPhone</span>
            <span className="t-muted">Safari → Share → <b>Add to Home Screen</b>. Want iPhone Shortcuts (Action Button, Siri, Apple Pay) to log for you? Turn off <b>Open as Web App</b> so it shares Safari's data.</span>
          </div>
          <div className="card col gap8 small">
            <span className="t-strong">Android</span>
            <span className="t-muted">Chrome menu → <b>Install app</b>. Long-press the icon for Quick add and Smart add shortcuts.</span>
          </div>
          <div className="card col gap8 small">
            <span className="t-strong">Computer</span>
            <span className="t-muted">Press <span className="kbd">N</span> anywhere to log, <span className="kbd">/</span> to search.</span>
          </div>
        </div>
      )}
      <div className="col gap8" style={{ marginTop: "auto" }}>
        <button className="btn primary block" onClick={() => (step < 2 ? setStep(step + 1) : finish())}>{step < 2 ? "Continue" : "Start using Tally"}</button>
        {step === 1 && <button className="btn ghost" onClick={() => setStep(2)}>Skip for now</button>}
      </div>
    </div>
  );
}
