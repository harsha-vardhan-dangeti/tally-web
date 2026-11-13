import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Icon } from "./icons";

const MIN = 200, MAX = 360, DEFAULT = 240, COLLAPSED = 76;
/** Dragging the edge narrower than this folds the side bar to icons. */
const FOLD_AT = 150;

const read = <T,>(key: string, fallback: T, parse: (v: string) => T | null): T => {
  try { const v = localStorage.getItem(key); return v === null ? fallback : parse(v) ?? fallback; } catch { return fallback; }
};
const write = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* storage blocked: lasts this visit */ } };

export interface NavItem { id: string; label: string; icon: string; badge?: number }

/**
 * The desktop side bar. Drag its edge to make it wider or narrower (or press ← → on the edge), and
 * fold it down to icons with the button at the bottom or ⌘/Ctrl + \. Both are remembered per browser.
 */
export function Sidebar({ items, current, onSelect, onAdd, onSmart }: {
  items: NavItem[]; current: string; onSelect: (id: string) => void; onAdd: () => void; onSmart: () => void;
}) {
  const [collapsed, setCollapsed] = useState(() => read("tally:navCollapsed", false, (v) => v === "1"));
  const savedWidth = () => read("tally:navWidth", DEFAULT, (v) => { const n = Number(v); return n >= MIN && n <= MAX ? n : null; });
  const [width, setWidth] = useState(savedWidth);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  const fold = (v: boolean) => { setCollapsed(v); write("tally:navCollapsed", v ? "1" : "0"); };
  const resize = (w: number) => { const n = Math.round(Math.min(MAX, Math.max(MIN, w))); setWidth(n); write("tally:navWidth", String(n)); };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); fold(!collapsed); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startW: collapsed ? COLLAPSED : width };
    setDragging(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const w = drag.current.startW + e.clientX - drag.current.startX;
    // Folding keeps the last width you chose, so unfolding brings it back.
    if (w < FOLD_AT) { if (!collapsed) { fold(true); setWidth(savedWidth()); } return; }
    if (collapsed) fold(false);
    setWidth(Math.round(Math.min(MAX, Math.max(MIN, w))));
  };
  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (!collapsed) resize(width);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") { if (collapsed) return; if (width - 16 < MIN) fold(true); else resize(width - 16); }
    else if (e.key === "ArrowRight") { if (collapsed) fold(false); else resize(width + 16); }
    else if (e.key === "Enter" || e.key === " ") fold(!collapsed);
    else if (e.key === "Home") { fold(false); resize(DEFAULT); }
    else return;
    e.preventDefault();
  };

  return (
    <nav className={`sidebar${collapsed ? " collapsed" : ""}${dragging ? " dragging" : ""}`} aria-label="Main"
      style={{ width: collapsed ? COLLAPSED : width }}>
      <div className="brand">
        <span className="brand-mark">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 5v14M10 5v14M14 5v14M18 5v14M4 15L20 9" /></svg>
        </span>
        <span className="nav-label">Tally</span>
      </div>
      {items.map((t) => (
        <button key={t.id} className="nav" aria-current={current === t.id ? "page" : undefined} onClick={() => onSelect(t.id)}
          title={collapsed ? t.label : undefined} aria-label={collapsed ? `${t.label}${t.badge ? `, ${t.badge} to review` : ""}` : undefined}>
          <Icon name={t.icon} /><span className="nav-label">{t.label}</span>
          {!!t.badge && <span className="badge">{t.badge}</span>}
        </button>
      ))}
      <button className="btn primary add" onClick={onAdd} title={collapsed ? "Add expense (N)" : undefined} aria-label={collapsed ? "Add expense" : undefined}>
        <Icon name="plus" size={18} /><span className="nav-label">Add expense</span>
      </button>
      <button className="btn smart" onClick={onSmart} title={collapsed ? "Smart add (S)" : undefined} aria-label={collapsed ? "Smart add" : undefined}>
        <Icon name="sparkle" size={18} /><span className="nav-label">Smart add</span>
      </button>
      <div className="foot">
        <p className="hint nav-label"><span className="kbd">N</span> add · <span className="kbd">S</span> smart · <span className="kbd">/</span> search</p>
        <p className="hint nav-label"><a href="/">About Tally</a> · <a href="/privacy">Privacy</a></p>
        <button className="nav fold" onClick={() => fold(!collapsed)} aria-expanded={!collapsed}
          title={collapsed ? "Expand side bar (⌘ \\)" : "Collapse side bar (⌘ \\)"} aria-label={collapsed ? "Expand side bar" : "Collapse side bar"}>
          <Icon name={collapsed ? "expand" : "collapse"} size={20} /><span className="nav-label">Collapse</span>
        </button>
      </div>
      <div className="sidebar-edge" role="separator" aria-orientation="vertical" tabIndex={0}
        aria-label="Resize side bar. Left and right arrows change its width, Enter folds it."
        aria-valuemin={COLLAPSED} aria-valuemax={MAX} aria-valuenow={collapsed ? COLLAPSED : width}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
        onDoubleClick={() => { fold(false); resize(DEFAULT); }} />
    </nav>
  );
}
