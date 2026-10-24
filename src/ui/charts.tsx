import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { compactMoney, formatMoney } from "../core/money";
import { Icon } from "./icons";

/**
 * Charts for the Finances screen. One method throughout: thin marks (≤24px columns, 2px lines),
 * hairline grid, one emphasis colour against grey, values on hover and keyboard focus, and a
 * "View as table" twin under every chart so no value depends on hovering or on colour.
 */

/** Tracks an element's width so SVG charts draw at real pixels and text never scales. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Clean axis steps: 1, 2, 2.5 or 5 × 10ⁿ, so ticks read ₹0 / ₹10k / ₹20k. */
function niceScale(max: number, ticks = 4): { top: number; step: number } {
  if (max <= 0) return { top: 100_00, step: 25_00 };
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  return { top: Math.ceil(max / step) * step, step };
}

// ---------- tooltip ----------

export interface TipRow { key?: "line" | "dash" | "muted" | "ref" | "bar"; value: string; label: string }
interface Tip { x: number; y: number; title: string; rows: TipRow[] }

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const flip = tip.x > width - 190;
  return (
    <div className="viz-tip" role="status" style={{ left: flip ? undefined : tip.x + 14, right: flip ? width - tip.x + 14 : undefined, top: tip.y }}>
      <div className="viz-tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.label} className="viz-tip-row">
          {r.key && <span className={`viz-key ${r.key}`} aria-hidden="true" />}
          <strong className="num">{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- shared pieces ----------

export function ChartCard({ title, subtitle, legend, table, children, className = "" }: {
  title: string; subtitle?: string; legend?: ReactNode; table?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card viz ${className}`}>
      <header className="viz-head">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </header>
      {legend && <div className="viz-legend">{legend}</div>}
      {children}
      {table && (
        <details className="viz-table">
          <summary>View as table</summary>
          {table}
        </details>
      )}
    </section>
  );
}

export function LegendItem({ kind, label }: { kind: "line" | "dash" | "muted" | "ref" | "bar" | "tick"; label: string }) {
  return <span className="viz-legend-item"><span className={`viz-key ${kind}`} aria-hidden="true" />{label}</span>;
}

export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="viz-table-scroll">
      <table>
        <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j} className="num">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function StatTile({ label, value, delta, tone, note }: {
  label: string; value: string; delta?: string; tone?: "good" | "bad" | "neutral"; note?: string;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {delta && (
        <span className={`stat-delta ${tone ?? "neutral"}`}>
          {tone !== "neutral" && <Icon name={tone === "bad" ? "alert" : "check"} size={13} stroke={2.4} />}
          {delta}
        </span>
      )}
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

// ---------- cumulative pace (line) ----------

/**
 * Running total for the month against last month and an even budget pace. "This month" is the
 * emphasis series; last month is grey context; the projection is dashed because it's an estimate.
 */
export function PaceChart({ days, elapsed, current, previous, budget, projected, monthName, prevName }: {
  days: number; elapsed: number; current: number[]; previous: number[]; budget: number; projected: number | null;
  monthName: string; prevName: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 220, m = { top: 14, right: 64, bottom: 26, left: 48 };
  const plotW = Math.max(width - m.left - m.right, 10), plotH = H - m.top - m.bottom;
  const shown = current.slice(0, elapsed);
  const prevShown = previous.slice(0, days);
  const { top, step } = niceScale(Math.max(...shown, ...prevShown, budget, projected ?? 0, 1));
  const x = (day: number) => m.left + ((day - 1) / Math.max(days - 1, 1)) * plotW;
  const y = (v: number) => m.top + plotH - (v / top) * plotH;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const budgetAt = (day: number) => Math.round((budget * day) / days);
  const end = shown.length ? shown[shown.length - 1] : 0;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const dayTicks = [1, 8, 15, 22, days];

  const tipFor = (i: number): Tip => {
    const day = i + 1;
    const rows: TipRow[] = [];
    if (i < shown.length) rows.push({ key: "line", value: formatMoney(shown[i]), label: monthName });
    else if (projected !== null) rows.push({ key: "dash", value: formatMoney(Math.round(end + ((projected - end) * (day - elapsed)) / Math.max(days - elapsed, 1))), label: "Projected" });
    if (i < prevShown.length) rows.push({ key: "muted", value: formatMoney(prevShown[i]), label: prevName });
    if (budget > 0) rows.push({ key: "ref", value: formatMoney(budgetAt(day)), label: "Even budget pace" });
    return { x: x(day), y: m.top, title: `Day ${day}`, rows };
  };

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left) / rect.width) * (days - 1));
    setHover(Math.max(0, Math.min(days - 1, i)));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min((h ?? elapsed - 1) + 1, days - 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max((h ?? elapsed - 1) - 1, 0));
    else return;
    e.preventDefault();
  };

  return (
    <div className="viz-plot" ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} role="img" tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)}
          aria-label={`${monthName}: ${formatMoney(end)} spent by day ${elapsed}${budget > 0 ? ` of a ${formatMoney(budget)} budget` : ""}. Use the arrow keys to read each day.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} className="viz-grid" />
              <text x={m.left - 8} y={y(t)} className="viz-axis" textAnchor="end" dominantBaseline="middle">{compactMoney(t)}</text>
            </g>
          ))}
          {dayTicks.map((d) => <text key={d} x={x(d)} y={H - 6} className="viz-axis" textAnchor="middle">{d}</text>)}

          {budget > 0 && (
            <>
              <line x1={x(1)} y1={y(budgetAt(1))} x2={x(days)} y2={y(budget)} className="viz-ref" />
              <text x={x(days) + 8} y={y(budget)} className="viz-label" dominantBaseline="middle">Budget</text>
              <text x={x(days) + 8} y={y(budget) + 14} className="viz-axis" dominantBaseline="middle">{compactMoney(budget)}</text>
            </>
          )}
          {prevShown.length > 0 && <path d={path(prevShown)} className="viz-line muted" />}
          {shown.length > 0 && (
            <>
              <path d={`${path(shown)}L${x(shown.length)},${y(0)}L${x(1)},${y(0)}Z`} className="viz-area" />
              <path d={path(shown)} className="viz-line" />
            </>
          )}
          {projected !== null && elapsed < days && shown.length > 0 && (
            <line x1={x(elapsed)} y1={y(end)} x2={x(days)} y2={y(projected)} className="viz-line dash" />
          )}
          {shown.length > 0 && (
            <>
              <circle cx={x(shown.length)} cy={y(end)} r={5} className="viz-dot" />
              {(projected === null || elapsed >= days) && (
                <text x={x(shown.length) + 10} y={y(end)} className="viz-label" dominantBaseline="middle">{compactMoney(end)}</text>
              )}
            </>
          )}
          {projected !== null && elapsed < days && (
            <text x={x(days) + 8} y={y(projected) + (Math.abs(y(projected) - y(budget)) < 30 && budget > 0 ? (projected > budget ? -16 : 30) : 0)}
              className="viz-label" dominantBaseline="middle">{compactMoney(projected)}</text>
          )}

          {hover !== null && (
            <>
              <line x1={x(hover + 1)} x2={x(hover + 1)} y1={m.top} y2={m.top + plotH} className="viz-crosshair" />
              {hover < shown.length && <circle cx={x(hover + 1)} cy={y(shown[hover])} r={4} className="viz-dot" />}
            </>
          )}
          <rect x={m.left} y={m.top} width={plotW} height={plotH} fill="transparent"
            onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      <Tooltip tip={hover !== null ? tipFor(hover) : null} width={width} />
    </div>
  );
}

// ---------- columns ----------

export interface Column { key: string; label: string; value: number; title: string; emphasis?: boolean }

/** Columns ≤24px with rounded caps. Emphasised columns use the accent, the rest grey; values sit on the
 *  emphasised and tallest caps only, the rest are on hover, focus and in the table. */
export function ColumnChart({ columns, height = 180, refLine, ariaLabel }: {
  columns: Column[]; height?: number; refLine?: { value: number; label: string }; ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 22, right: 8, bottom: 24, left: 44 };
  const plotW = Math.max(width - m.left - m.right, 10), plotH = height - m.top - m.bottom;
  const maxVal = Math.max(...columns.map((c) => c.value), refLine?.value ?? 0, 1);
  const { top, step } = niceScale(maxVal, 3);
  const band = plotW / columns.length;
  const barW = Math.min(24, band * 0.6);
  const y = (v: number) => m.top + plotH - (v / top) * plotH;
  const tallest = columns.reduce((best, c, i) => (c.value > columns[best].value ? i : best), 0);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const cap = (cx: number, v: number) => {
    const h = Math.max((v / top) * plotH, v > 0 ? 3 : 0);
    const r = Math.min(4, h, barW / 2);
    const x0 = cx - barW / 2, x1 = cx + barW / 2, y0 = m.top + plotH, y1 = y0 - h;
    return `M${x0},${y0}V${y1 + r}Q${x0},${y1} ${x0 + r},${y1}H${x1 - r}Q${x1},${y1} ${x1},${y1 + r}V${y0}Z`;
  };

  return (
    <div className="viz-plot" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} className="viz-grid" />
              <text x={m.left - 8} y={y(t)} className="viz-axis" textAnchor="end" dominantBaseline="middle">{compactMoney(t)}</text>
            </g>
          ))}
          {refLine && refLine.value > 0 && (
            <>
              <line x1={m.left} x2={m.left + plotW} y1={y(refLine.value)} y2={y(refLine.value)} className="viz-ref good" />
              <text x={m.left + plotW} y={y(refLine.value) - 6} className="viz-axis" textAnchor="end">{refLine.label}</text>
            </>
          )}
          {columns.map((c, i) => {
            const cx = m.left + band * i + band / 2;
            const showValue = c.value > 0 && (c.emphasis || i === tallest);
            return (
              <g key={c.key} tabIndex={0} role="img" aria-label={`${c.title}: ${formatMoney(c.value)}`} className="viz-col"
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
                <rect x={m.left + band * i} y={m.top} width={band} height={plotH} fill="transparent" />
                <path d={cap(cx, c.value)} className={c.emphasis ? "viz-bar" : "viz-bar muted"} opacity={hover === i ? 0.8 : 1} />
                {showValue && <text x={cx} y={y(c.value) - 6} className="viz-label" textAnchor="middle">{compactMoney(c.value)}</text>}
                <text x={cx} y={height - 6} className={c.emphasis ? "viz-axis strong" : "viz-axis"} textAnchor="middle">{c.label}</text>
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip width={width} tip={hover === null ? null : {
        x: m.left + band * hover + band / 2, y: m.top, title: columns[hover].title,
        rows: [{ key: "bar", value: formatMoney(columns[hover].value), label: "spent" }],
      }} />
    </div>
  );
}

// ---------- calendar heatmap ----------

/**
 * Each day of the month as a cell, darker for more spending (one hue, light → dark). With a budget,
 * the steps are halves of a day's budget, so "darker than step 2" means over budget that day.
 */
export function SpendCalendar({ month, daily, counts, elapsed, budget }: {
  month: Date; daily: number[]; counts: number[]; elapsed: number; budget: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const perDay = budget > 0 ? budget / daily.length : 0;
  const max = Math.max(...daily, 1);
  const edges = perDay > 0 ? [0.5, 1, 1.5, 2].map((k) => k * perDay) : [0.2, 0.4, 0.6, 0.8].map((k) => k * max);
  const bin = (v: number) => (v <= 0 ? 0 : 1 + edges.filter((e) => v > e).length);
  const lead = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const cells = [...Array.from({ length: lead }, () => null), ...daily.map((_, i) => i)];
  const dayName = (i: number) => new Date(month.getFullYear(), month.getMonth(), i + 1).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const cellRef = useRef<(HTMLDivElement | null)[]>([]);

  const pos = (i: number) => {
    const el = cellRef.current[i];
    return el ? { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight + 4 } : { x: 0, y: 0 };
  };

  return (
    <div className="viz-plot">
      <div className="cal" ref={ref}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="cal-dow" aria-hidden="true">{d}</span>)}
        {cells.map((i, k) => {
          if (i === null) return <span key={`b${k}`} />;
          const future = i >= elapsed;
          const b = future ? -1 : bin(daily[i]);
          return (
            <div key={i} ref={(el) => { cellRef.current[i] = el; }} tabIndex={future ? -1 : 0}
              className={`cal-cell ${future ? "future" : b === 0 ? "zero" : `b${b}`}`}
              aria-label={future ? `${dayName(i)}: still to come` : `${dayName(i)}: ${daily[i] ? formatMoney(daily[i]) : "no spend"}`}
              onPointerEnter={() => !future && setHover(i)} onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              {i + 1}
            </div>
          );
        })}
      </div>
      <div className="cal-scale" aria-hidden="true">
        <span className="cal-swatch zero" /><span>No spend</span>
        <span className="cal-gap" />
        <span>{perDay > 0 ? "Under ½ day's budget" : "Less"}</span>
        {[1, 2, 3, 4, 5].map((b) => <span key={b} className={`cal-swatch b${b}`} />)}
        <span>{perDay > 0 ? "Over 2×" : "More"}</span>
      </div>
      <Tooltip width={width} tip={hover === null ? null : {
        ...pos(hover), title: dayName(hover),
        rows: [{ value: daily[hover] ? formatMoney(daily[hover]) : "No spend", label: counts[hover] ? `${counts[hover]} expense${counts[hover] === 1 ? "" : "s"}` : "" }],
      }} />
    </div>
  );
}

// ---------- horizontal bars ----------

export interface BarRow { key: string; lead: ReactNode; label: string; value: number; marker?: number | null; detail?: ReactNode; flag?: ReactNode }

/** One hue for every bar: the categories are named by icon and label, so colour isn't spent on identity. */
export function BarList({ rows, markerLabel }: { rows: BarRow[]; markerLabel?: string }) {
  const max = Math.max(...rows.map((r) => Math.max(r.value, r.marker ?? 0)), 1);
  return (
    <ul className="barlist">
      {rows.map((r) => (
        <li key={r.key}>
          {r.lead}
          <div className="barlist-body">
            <div className="barlist-top">
              <span className="barlist-label">{r.label}</span>
              {r.flag}
              <span className="barlist-value num">{formatMoney(r.value)}</span>
            </div>
            <div className="barlist-track" role="img"
              aria-label={`${r.label}: ${formatMoney(r.value)}${r.marker ? `, ${markerLabel ?? "marker"} ${formatMoney(r.marker)}` : ""}`}>
              <div className="barlist-bar" style={{ width: `${(r.value / max) * 100}%` }} />
              {r.marker ? <div className="barlist-marker" style={{ left: `${(r.marker / max) * 100}%` }} title={`${markerLabel}: ${formatMoney(r.marker)}`} /> : null}
            </div>
            {r.detail && <div className="barlist-detail">{r.detail}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------- part-to-whole ----------

/** A single stacked bar with 2px surface gaps. Colour follows the entity (passed in), never its rank. */
export function ShareBar({ parts }: { parts: { key: string; label: string; value: number; color: string }[] }) {
  const total = parts.reduce((t, p) => t + p.value, 0) || 1;
  return (
    <div className="sharebar-wrap">
      <div className="sharebar" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(", ")}>
        {parts.map((p) => <span key={p.key} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${formatMoney(p.value)}`} />)}
      </div>
      <ul className="sharebar-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span className="viz-swatch" style={{ background: p.color }} aria-hidden="true" />
            <span className="grow">{p.label}</span>
            <span className="num t-strong">{formatMoney(p.value)}</span>
            <span className="num t-muted share">{Math.round((p.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
