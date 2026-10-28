import { useCallback, useEffect, useState } from "react";
import { handleUrlActions, load, runDueBills, runDueIncome, useTally, type Expense } from "./data/store";
import { Icon } from "./ui/icons";
import { ToastHost, UpdateBar, useLongPress } from "./ui/components";
import { Home } from "./screens/Dashboard";
import { Activity } from "./screens/Activity";
import { Reports } from "./screens/Reports";
import { Accounts } from "./screens/Accounts";
import { QuickAdd, SmartAdd } from "./screens/AddSheets";
import { Detail } from "./screens/Detail";
import { Plan } from "./screens/Plan";
import { Inbox, Onboarding, Recap, Search, Settings } from "./screens/More";
import { unlock } from "./screens/lock";
import { startCloud } from "./data/cloud";

type Tab = "home" | "activity" | "reports" | "plan" | "accounts" | "inbox";

// Read once at startup, before the tab effect rewrites the URL.
const INITIAL_SEARCH = typeof location !== "undefined" ? location.search : "";
let urlHandled = false;
type SheetName = "quickAdd" | "smartAdd" | "search" | "recap" | "settings" | null;

/** `phone`: shown in the phone's tab bar too. Accounts is reached from Home's net worth card there. */
const TABS: { id: Tab; label: string; icon: string; phone: boolean }[] = [
  { id: "home", label: "Home", icon: "home", phone: true },
  { id: "activity", label: "Activity", icon: "inbox", phone: true },
  { id: "reports", label: "Reports", icon: "chart", phone: true },
  { id: "plan", label: "Plan", icon: "target", phone: true },
  { id: "accounts", label: "Accounts", icon: "card", phone: false },
  { id: "inbox", label: "Inbox", icon: "check", phone: true },
];

// Links and bookmarks from before the redesign used #finances.
const tabFromHash = (): Tab => (location.hash === "#finances" ? "reports" : TABS.find((t) => `#${t.id}` === location.hash)?.id ?? "home");

export function App() {
  const s = useTally();
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addDate, setAddDate] = useState<Date | null>(null);
  const [dbBlocked, setDbBlocked] = useState(false);
  const [locked, setLocked] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => { void load(); }, []);

  // Signed in with Google: pick up the session and keep this device in step with the others.
  useEffect(() => { if (s.ready) void startCloud(); }, [s.ready]);

  // Tally may stay open for days: when it comes back into view, add bills and income that fell due meanwhile.
  useEffect(() => {
    if (!s.ready) return;
    const onVisible = () => { if (document.visibilityState === "visible") { runDueBills(); runDueIncome(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [s.ready]);

  // Another tab on the previous version can hold the database while this one upgrades it.
  useEffect(() => {
    const onBlocked = () => setDbBlocked(true);
    window.addEventListener("tally:db-blocked", onBlocked);
    return () => window.removeEventListener("tally:db-blocked", onBlocked);
  }, []);

  // Widgets open a tab by setting the hash (e.g. #plan) without reloading the page.
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Lets the website greet returning users with "Open your Tally". Holds no expense data.
  useEffect(() => {
    if (!s.settings.onboarded) return;
    try { localStorage.setItem("tally:onboarded", "1"); } catch { /* storage blocked */ }
  }, [s.settings.onboarded]);

  // Lock on start and when returning to the app.
  useEffect(() => {
    if (!s.ready || !s.settings.lockCredentialId) return;
    setLocked(true);
    const onVis = () => { if (document.visibilityState === "hidden") setLocked(true); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [s.ready, s.settings.lockCredentialId]);

  useEffect(() => {
    // With the lock on, a link only logs once the owner has unlocked.
    if (!s.ready || !s.settings.onboarded || urlHandled || (s.settings.lockCredentialId && !unlocked)) return;
    urlHandled = true; // StrictMode runs effects twice in dev; log only once.
    handleUrlActions(INITIAL_SEARCH, (name) => setSheet(name));
  }, [s.ready, s.settings.onboarded, s.settings.lockCredentialId, unlocked]);

  useEffect(() => {
    history.replaceState(null, "", tab === "home" ? location.pathname : `#${tab}`);
    window.scrollTo(0, 0);
  }, [tab]);

  const openDetail = useCallback((e: Expense) => setDetailId(e.id), []);
  const close = useCallback(() => setSheet(null), []);

  // Keyboard shortcuts for desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (sheet || detailId || e.metaKey || e.ctrlKey || e.altKey || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); setSheet("quickAdd"); }
      if (e.key === "s" || e.key === "S") { e.preventDefault(); setSheet("smartAdd"); }
      if (e.key === "/") { e.preventDefault(); setSheet("search"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, detailId]);

  if (!s.ready) {
    return (
      <div className="lock">
        <span className="t-muted" style={{ maxWidth: 320 }}>
          {dbBlocked ? "Tally is open in another tab or window. Close it to finish updating; this page continues on its own." : "Loading…"}
        </span>
      </div>
    );
  }
  if (!s.settings.onboarded) return <Onboarding />;

  const pending = s.expenses.filter((e) => e.pending).length;
  // Inbox only matters when an iPhone Shortcut has captured something to review.
  const tabs = TABS.filter((t) => t.id !== "inbox" || pending > 0 || tab === "inbox");
  const phoneTabs = tabs.filter((t) => t.phone);

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="brand-mark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 5v14M10 5v14M14 5v14M18 5v14M4 15L20 9" /></svg>
          </span>
          Tally
        </div>
        {tabs.map((t) => (
          <button key={t.id} className="nav" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} />{t.label}
            {t.id === "inbox" && pending > 0 && <span className="badge">{pending}</span>}
          </button>
        ))}
        <button className="btn primary add" onClick={() => setSheet("quickAdd")}><Icon name="plus" size={18} />Add expense</button>
        <button className="btn" onClick={() => setSheet("smartAdd")}>Smart add</button>
        <div className="foot">
          <p className="hint"><span className="kbd">N</span> add · <span className="kbd">S</span> smart · <span className="kbd">/</span> search</p>
          <p className="hint"><a href="/">About Tally</a> · <a href="/privacy">Privacy</a></p>
        </div>
      </nav>

      <main className="main">
        <UpdateBar />
        {tab === "home" && (
          <Home onOpen={openDetail} onAdd={(day) => { setAddDate(day ?? null); setSheet("quickAdd"); }} onSearch={() => setSheet("search")}
            onRecap={() => setSheet("recap")} onInbox={() => setTab("inbox")} onSettings={() => setSheet("settings")} go={setTab} />
        )}
        {tab === "activity" && (
          <Activity onOpen={openDetail} onAdd={(day) => { setAddDate(day ?? null); setSheet("quickAdd"); }} onSearch={() => setSheet("search")} />
        )}
        {tab === "reports" && <Reports />}
        {tab === "plan" && <Plan />}
        {tab === "accounts" && <Accounts />}
        {tab === "inbox" && <Inbox onOpen={openDetail} />}
      </main>

      <nav className="tabbar" aria-label="Main" style={{ gridTemplateColumns: `repeat(${phoneTabs.length + 1}, minmax(0, 1fr))` }}>
        {phoneTabs.slice(0, 2).map((t) => (
          <button key={t.id} className="tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} />{t.label}
          </button>
        ))}
        <AddFab onTap={() => setSheet("quickAdd")} onLong={() => setSheet("smartAdd")} />
        {phoneTabs.slice(2).map((t) => (
          <button key={t.id} className="tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}
            aria-label={t.id === "inbox" && pending ? `Inbox, ${pending} to review` : undefined}>
            <Icon name={t.icon} />{t.label}
            {t.id === "inbox" && pending > 0 && <span className="badge">{pending}</span>}
          </button>
        ))}
      </nav>

      <QuickAdd open={sheet === "quickAdd"} initialDate={addDate} onClose={() => { setAddDate(null); close(); }} onSmart={() => setSheet("smartAdd")} />
      <SmartAdd open={sheet === "smartAdd"} onClose={close} />
      <Search open={sheet === "search"} onClose={close} onOpen={(e) => { setSheet(null); setDetailId(e.id); }} />
      <Recap open={sheet === "recap"} onClose={close} />
      <Settings open={sheet === "settings"} onClose={close} />
      <Detail id={detailId} onClose={() => setDetailId(null)} />
      <ToastHost />

      {locked && (
        <div className="lock">
          <div className="col gap16" style={{ alignItems: "center" }}>
            <Icon name="lock" size={40} />
            <h2>Tally is locked</h2>
            <button className="btn primary" onClick={async () => { if (await unlock(s.settings.lockCredentialId!)) { setLocked(false); setUnlocked(true); } }}>Unlock</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddFab({ onTap, onLong }: { onTap: () => void; onLong: () => void }) {
  const press = useLongPress(onTap, onLong);
  return (
    <button className="fab" aria-label="Add expense (long press for Smart add)" {...press}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } }}>
      <Icon name="plus" size={28} stroke={2.4} />
    </button>
  );
}
