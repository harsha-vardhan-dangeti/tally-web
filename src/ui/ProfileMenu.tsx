import { createContext, useContext, useEffect, useRef, useState } from "react";
import { signOut, syncNow, useCloud } from "../data/cloud";
import { Avatar, syncStatus } from "../screens/Account";
import { Icon } from "./icons";
import { t } from "../i18n";

/** What any screen's header can ask of the app shell. */
export const ShellContext = createContext<{
  openSettings: () => void; openFeedback: () => void; openRecapShare: (month: "this" | "last") => void;
}>({ openSettings: () => {}, openFeedback: () => {}, openRecapShare: () => {} });

/**
 * Top right of every screen. Signed in: your Google photo, which opens a menu with who you're signed
 * in as, how sync is going, Settings and Sign out. Signed out: the Settings button.
 */
export function ProfileButton() {
  const c = useCloud();
  const { openSettings, openFeedback } = useContext(ShellContext);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "ask" | { pending: number }>(null);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [open]);
  useEffect(() => { if (!open) setConfirm(null); }, [open]);

  if (!c.user) {
    return <button className="icon-btn" onClick={openSettings} aria-label={t("Settings")}><Icon name="gear" size={20} /></button>;
  }
  const status = syncStatus(c);
  const out = async (discard: boolean) => {
    setBusy(true);
    const result = await signOut(discard);
    setBusy(false);
    if (result.ok) setOpen(false);
    else setConfirm({ pending: result.pending });
  };

  return (
    <div className="profile" ref={wrap}>
      <button className={`profile-btn ${status.tone}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={`Account: ${c.user.name || c.user.email}. ${status.text}`}>
        <Avatar user={c.user} size={40} />
        <span className="profile-dot" aria-hidden="true" />
      </button>
      {open && (
        <div className="profile-menu" role="dialog" aria-label="Account">
          <div className="row gap12">
            <Avatar user={c.user} size={44} />
            <div className="col grow" style={{ minWidth: 0 }}>
              <span className="t-strong ellipsis">{c.user.name}</span>
              <span className="t-muted small ellipsis">{c.user.email}</span>
            </div>
          </div>
          <p className={`sync-status ${status.tone}`} role="status"><Icon name={status.icon} size={14} stroke={2.4} />{status.text}</p>
          {confirm === null ? (
            <div className="profile-actions">
              <button onClick={() => void syncNow()} disabled={c.status === "syncing"}><Icon name="repeat" size={18} />{t("Sync now")}</button>
              <button onClick={() => { setOpen(false); openSettings(); }}><Icon name="gear" size={18} />{t("Settings")}</button>
              <button onClick={() => { setOpen(false); openFeedback(); }}><Icon name="chat" size={18} />{t("Send feedback")}</button>
              <button onClick={() => setConfirm("ask")}><Icon name="logout" size={18} />{t("Sign out")}</button>
            </div>
          ) : confirm === "ask" ? (
            <div className="col gap8">
              <span className="small">Sign out? Tally's data is removed from this browser. It stays in your account and comes back when you sign in again.</span>
              <div className="row gap8">
                <button className="btn" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
                <button className="btn primary" onClick={() => void out(false)} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>
              </div>
            </div>
          ) : (
            <div className="col gap8">
              <span className="small" style={{ color: "var(--danger)" }}>
                {confirm.pending} change{confirm.pending === 1 ? " hasn't" : "s haven't"} uploaded yet. Signing out now loses {confirm.pending === 1 ? "it" : "them"}.
              </span>
              <div className="row gap8">
                <button className="btn" onClick={() => setConfirm(null)} disabled={busy}>Stay signed in</button>
                <button className="btn danger" onClick={() => void out(true)} disabled={busy}>Sign out anyway</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
