import { useCallback, useEffect, useState } from "react";
import { handleUrlActions, load, runDueBills, useTally, type Expense } from "./data/store";
import { Icon } from "./ui/icons";
import { ToastHost, UpdateBar, useLongPress } from "./ui/components";
import { Home } from "./screens/Home";
import { QuickAdd, SmartAdd } from "./screens/AddSheets";
import { Detail } from "./screens/Detail";
import { Finances } from "./screens/Finances";
import { Plan } from "./screens/Plan";
import { Inbox, Onboarding, Recap, Search, Settings } from "./screens/More";
import { unlock } from "./screens/lock";

type Tab = "home" | "finances" | "plan" | "inbox";

// Read once at startup, before the tab effect rewrites the URL.
const INITIAL_SEARCH = typeof location !== "undefined" ? location.search : "";
let urlHandled = false;
type SheetName = "quickAdd" | "smartAdd" | "search" | "recap" | "settings" | null;

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "finances", label: "Finances", icon: "chart" },
  { id: "plan", label: "Plan", icon: "target" },
  { id: "inbox", label: "Inbox", icon: "inbox" },
];

const tabFromHash = (): Tab => TABS.find((t) => `#${t.id}` === location.hash)?.id ?? "home";

export function App() {
  const s = useTally();
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addDate, setAddDate] = useState<Date | null>(null);
  const [dbBlocked, setDbBlocked] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => { void load(); }, []);

  // Tally may stay open for days: when it comes back into view, add any bills that fell due meanwhile.
  useEffect(() => {
    if (!s.ready) return;
    const onVisible = () => { if (document.visibilityState === "visible") runDueBills(); };
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
    if (!s.ready || !s.settings.onboarded || urlHandled) return;
    urlHandled = true; // StrictMode runs effects twice in dev; log only once.
    handleUrlActions(INITIAL_SEARCH, (name) => setSheet(name));
  }, [s.ready, s.settings.onboarded]);

  useEffect(() => { history.replaceState(null, "", tab === "home" ? location.pathname : `#${tab}`); }, [tab]);

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

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="cat-icon" style={{ width: 34, height: 34, background: "var(--accent)", color: "var(--accent-ink)", borderRadius: 10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 5v14M10 5v14M14 5v14M18 5v14M4 15L20 9" /></svg>
          </span>
          Tally
        </div>
        {TABS.map((t) => (
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
            onRecap={() => setSheet("recap")} onInbox={() => setTab("inbox")} onSettings={() => setSheet("settings")} />
        )}
        {tab === "finances" && <Finances />}
        {tab === "plan" && <Plan />}
        {tab === "inbox" && <Inbox onOpen={openDetail} />}
      </main>

      <nav className="tabbar" aria-label="Main">
        {TABS.slice(0, 2).map((t) => (
          <button key={t.id} className="tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} />{t.label}
          </button>
        ))}
        <AddFab onTap={() => setSheet("quickAdd")} onLong={() => setSheet("smartAdd")} />
        {TABS.slice(2).map((t) => (
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
            <button className="btn primary" onClick={async () => { if (await unlock(s.settings.lockCredentialId!)) setLocked(false); }}>Unlock</button>
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
