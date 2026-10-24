import { useEffect, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from "react";
import { Icon } from "./icons";
import { dismissToast, useToast } from "../data/store";
import { applyUpdate, useUpdateReady } from "../data/updates";

/** Bottom sheet on phones, centred dialog on desktop. Drag the handle down (or press Esc) to close. */
export function Sheet({ open, onClose, title, children, actions }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; actions?: ReactNode;
}) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Callers often pass a new onClose on every render (typing in a field re-renders); reading it
  // through a ref keeps the effect below from re-running and pulling focus out of the field.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // With sheets stacked (a day's list, then an expense on top), Escape closes only the top one.
      const sheets = document.querySelectorAll(".sheet");
      if (sheets[sheets.length - 1] === panel.current) onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => { window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open]);

  if (!open) return null;
  const down = (e: RPointerEvent) => { start.current = e.clientY; (e.target as Element).setPointerCapture?.(e.pointerId); };
  const move = (e: RPointerEvent) => { if (start.current !== null) setDrag(Math.max(0, e.clientY - start.current)); };
  const up = () => { if (drag > 110) onClose(); setDrag(0); start.current = null; };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}
        style={{ transform: drag ? `translateY(${drag}px)` : undefined }} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <span />
        </div>
        <header className="sheet-head">
          <h2>{title}</h2>
          <div className="row gap8">
            {actions}
            <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
          </div>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** Row with swipe actions: drag left for Edit/Delete (full swipe deletes), right for Split/Repeat. */
export function SwipeRow({ children, onOpen, left, right, onFullLeft }: {
  children: ReactNode; onOpen: () => void;
  left: { label: string; icon: string; color: string; run: () => void }[];
  right: { label: string; icon: string; color: string; run: () => void }[];
  onFullLeft?: () => void;
}) {
  const [dx, setDx] = useState(0);
  const [settled, setSettled] = useState(0);
  const s = useRef<{ x: number; y: number; locked: "h" | "v" | null; moved: boolean } | null>(null);
  const width = 76;

  const down = (e: RPointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    s.current = { x: e.clientX, y: e.clientY, locked: null, moved: false };
  };
  const move = (e: RPointerEvent) => {
    const st = s.current;
    if (!st) return;
    const mx = e.clientX - st.x, my = e.clientY - st.y;
    if (!st.locked && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
      st.locked = Math.abs(mx) > Math.abs(my) ? "h" : "v";
      if (st.locked === "h") (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
    if (st.locked === "h") {
      st.moved = true;
      setDx(Math.max(Math.min(settled + mx, width * right.length + 20), -(width * left.length) - 140));
    }
  };
  const up = () => {
    const st = s.current;
    s.current = null;
    if (!st) return;
    if (!st.moved) {
      if (settled !== 0) { setSettled(0); setDx(0); } else onOpen();
      return;
    }
    if (dx < -(width * left.length) - 90 && onFullLeft) { setDx(0); setSettled(0); onFullLeft(); return; }
    const snap = dx < -40 ? -(width * left.length) : dx > 40 ? width * right.length : 0;
    setDx(snap); setSettled(snap);
  };
  const run = (fn: () => void) => { setDx(0); setSettled(0); fn(); };

  return (
    <div className="swipe">
      {/* Actions exist only while the row is pulled aside, so their colours can't show at the row's edges. */}
      {dx > 0 && <div className="swipe-actions right-side" aria-hidden={settled <= 0}>
        {right.map((a) => (
          <button key={a.label} style={{ background: a.color }} onClick={() => run(a.run)} tabIndex={settled > 0 ? 0 : -1}>
            <Icon name={a.icon} size={18} />{a.label}
          </button>
        ))}
      </div>}
      {dx < 0 && <div className="swipe-actions left-side" aria-hidden={settled >= 0}>
        {left.map((a) => (
          <button key={a.label} style={{ background: a.color }} onClick={() => run(a.run)} tabIndex={settled < 0 ? 0 : -1}>
            <Icon name={a.icon} size={18} />{a.label}
          </button>
        ))}
      </div>}
      <div className="swipe-front" style={{ transform: `translateX(${dx}px)`, transition: s.current ? "none" : undefined }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { s.current = null; setDx(settled); }}
        role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); if (e.key === "Delete" || e.key === "Backspace") onFullLeft?.(); }}>
        {children}
      </div>
    </div>
  );
}

/** Long press (450 ms) → onLong; normal tap → onTap. Works with touch and mouse. */
export function useLongPress(onTap: () => void, onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fired = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  return {
    onPointerDown: (e: RPointerEvent) => {
      fired.current = false;
      startPos.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => { fired.current = true; navigator.vibrate?.(15); onLong(); }, 450);
    },
    onPointerMove: (e: RPointerEvent) => {
      if (Math.abs(e.clientX - startPos.current.x) > 10 || Math.abs(e.clientY - startPos.current.y) > 10) clearTimeout(timer.current);
    },
    onPointerUp: () => { clearTimeout(timer.current); if (!fired.current) onTap(); },
    onPointerLeave: () => clearTimeout(timer.current),
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); clearTimeout(timer.current); fired.current = true; onLong(); },
  };
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle-row">
      <span className="col">
        <span className="t-strong">{label}</span>
        {hint && <span className="t-muted small">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

export function Progress({ value, tone }: { value: number; tone?: "ok" | "warn" | "over" | "good" }) {
  const v = Math.max(0, Math.min(value, 1));
  const color = tone === "over" ? "var(--danger)" : tone === "warn" ? "var(--warn)" : tone === "good" ? "var(--good)" : "var(--accent)";
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <div style={{ width: `${v * 100}%`, background: color }} />
    </div>
  );
}

export function ToastHost() {
  const toast = useToast();
  if (!toast) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{toast.message}</span>
      {toast.undo && (
        <button onClick={() => { toast.undo?.(); dismissToast(); }}>Undo</button>
      )}
    </div>
  );
}

/** Shown when a new release of Tally has downloaded. Reloading swaps the app files; data stays put. */
export function UpdateBar() {
  const ready = useUpdateReady();
  if (!ready) return null;
  return (
    <div className="update-bar" role="status">
      <Icon name="download" size={18} />
      <span className="grow">A new version of Tally is ready. Your data stays on this device.</span>
      <button className="btn primary" onClick={applyUpdate}>Reload</button>
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
