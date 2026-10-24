import { useState } from "react";
import { cloudAvailable, deleteAccount, signInWithGoogle, signOut, syncNow, useCloud } from "../data/cloud";
import { exportJSON, showToast } from "../data/store";
import { backupFileName, download } from "../ui/download";
import { Icon } from "../ui/icons";

/** Google's "G" mark, as Google's sign-in branding asks for on the button. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function GoogleButton({ label = "Continue with Google" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn google-btn" disabled={busy} onClick={async () => { setBusy(true); await signInWithGoogle(); setBusy(false); }}>
      <GoogleMark />{busy ? "Opening Google…" : label}
    </button>
  );
}

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

/** Settings → Account: sign in to sync, see sync status, sign out. Hidden when the build has no Supabase. */
export function AccountSection() {
  const c = useCloud();
  const [confirm, setConfirm] = useState<null | "ask" | "delete" | { pending: number }>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!cloudAvailable) return null;

  if (!c.user) {
    return (
      <div className="col gap8">
        <span className="t-strong small">Sync across devices</span>
        <p className="t-muted small" style={{ margin: 0 }}>
          Sign in with Google to keep Tally the same on your phone and laptop. Until you do, your data stays only in this browser.
        </p>
        <GoogleButton />
        {c.message && <p className="small" style={{ margin: 0, color: "var(--danger)" }}>{c.message}</p>}
      </div>
    );
  }

  const status = c.status === "syncing" ? { icon: "repeat", text: "Syncing…", tone: "" }
    : c.status === "offline" ? { icon: "alert", text: c.pending ? `Offline. ${c.pending} change${c.pending === 1 ? "" : "s"} will upload when you're back online.` : "Offline. Changes will sync when you're back online.", tone: "warn" }
    : c.status === "error" ? { icon: "alert", text: c.message ?? "Sync failed.", tone: "danger" }
    : { icon: "check", text: c.lastSyncedAt ? `Synced ${ago(c.lastSyncedAt)}` : "Synced", tone: "good" };

  const doSignOut = async (discard: boolean) => {
    setBusy(true);
    const result = await signOut(discard);
    setBusy(false);
    setConfirm(result.ok ? null : { pending: result.pending });
  };

  return (
    <div className="col gap8">
      <span className="t-strong small">Account</span>
      <div className="card account-card">
        <div className="row gap12">
          {c.user.avatar
            ? <img src={c.user.avatar} alt="" width={40} height={40} className="avatar" referrerPolicy="no-referrer" />
            : <span className="avatar avatar-letter" aria-hidden="true">{(c.user.name || c.user.email).slice(0, 1).toUpperCase()}</span>}
          <div className="col grow" style={{ minWidth: 0 }}>
            <span className="t-strong ellipsis">{c.user.name}</span>
            <span className="t-muted small ellipsis">{c.user.email}</span>
          </div>
        </div>
        <p className={`sync-status ${status.tone}`} role="status"><Icon name={status.icon} size={14} stroke={2.4} />{status.text}</p>
        {confirm === null && (
          <div className="row gap8 wrap">
            <button className="btn" onClick={() => void syncNow()} disabled={c.status === "syncing"}>Sync now</button>
            <button className="btn" onClick={() => setConfirm("ask")}>Sign out</button>
            <button className="btn ghost danger-text" onClick={() => { setDeleteError(null); setConfirm("delete"); }}>Delete account</button>
          </div>
        )}
        {confirm === "delete" && (
          <div className="col gap8">
            <span className="small" style={{ color: "var(--danger)" }}>
              Delete your Tally account? Everything synced to it is permanently deleted from the server, your other
              devices are signed out, and Tally's data is removed from this browser. This can't be undone.
            </span>
            <button className="btn" onClick={() => download(backupFileName(), exportJSON(), "application/json")}>
              <Icon name="download" size={18} />Download a backup first
            </button>
            {deleteError && <span className="small" style={{ color: "var(--danger)" }}>{deleteError}</span>}
            <div className="row gap8">
              <button className="btn" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
              <button className="btn danger" disabled={busy} onClick={async () => {
                setBusy(true);
                const result = await deleteAccount();
                setBusy(false);
                if (result.ok) { setConfirm(null); showToast("Your account and synced data are deleted"); }
                else setDeleteError(result.message);
              }}>{busy ? "Deleting…" : "Delete account"}</button>
            </div>
          </div>
        )}
        {confirm === "ask" && (
          <div className="col gap8">
            <span className="small">Sign out? Tally's data is removed from this browser. It stays in your account and comes back when you sign in again.</span>
            <div className="row gap8">
              <button className="btn" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
              <button className="btn primary" onClick={() => doSignOut(false)} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>
            </div>
          </div>
        )}
        {confirm !== null && typeof confirm === "object" && (
          <div className="col gap8">
            <span className="small" style={{ color: "var(--danger)" }}>
              {confirm.pending} change{confirm.pending === 1 ? " hasn't" : "s haven't"} uploaded yet. Signing out now loses {confirm.pending === 1 ? "it" : "them"}. Connect to the internet and try again to keep {confirm.pending === 1 ? "it" : "them"}.
            </span>
            <div className="row gap8">
              <button className="btn" onClick={() => setConfirm(null)} disabled={busy}>Stay signed in</button>
              <button className="btn danger" onClick={() => doSignOut(true)} disabled={busy}>Sign out anyway</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
