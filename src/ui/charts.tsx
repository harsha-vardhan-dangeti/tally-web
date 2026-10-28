import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { compactMoney, formatMoney } from "../core/money";
import { Icon } from "./icons";

/**
 * Charts for Reports, Accounts and Home. One method throughout: thin marks (≤24px columns, 2px lines),
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

// ---------- income vs spending ----------

export interface PairColumn { key: string; label: string; title: string; income: number; spending: number }

/**
 * Income and spending side by side for each month: two validated categorical hues, a legend, and
 * values on hover, focus and in the table. One axis, both in rupees.
 */
export function PairedColumns({ columns, height = 200, ariaLabel }: { columns: PairColumn[]; height?: number; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 14, right: 8, bottom: 24, left: 44 };
  const plotW = Math.max(width - m.left - m.right, 10), plotH = height - m.top - m.bottom;
  const { top, step } = niceScale(Math.max(...columns.flatMap((c) => [c.income, c.spending]), 1), 3);
  const band = plotW / Math.max(columns.length, 1);
  const barW = Math.max(3, Math.min(16, (band * 0.7 - 2) / 2));
  const y = (v: number) => m.top + plotH - (v / top) * plotH;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const bar = (x0: number, v: number) => {
    const h = Math.max((v / top) * plotH, v > 0 ? 2 : 0);
    const r = Math.min(4, h, barW / 2), x1 = x0 + barW, y0 = m.top + plotH, y1 = y0 - h;
    return `M${x0},${y0}V${y1 + r}Q${x0},${y1} ${x0 + r},${y1}H${x1 - r}Q${x1},${y1} ${x1},${y1 + r}V${y0}Z`;
  };
  const labelEvery = Math.ceil(columns.length / Math.max(Math.floor(plotW / 44), 1));

  return (
    <div className="viz-plot" ref={ref}>
      <div className="viz-legend" style={{ marginBottom: 8 }}>
        <span className="viz-legend-item"><span className="viz-swatch" style={{ background: "var(--viz-cat-3)" }} />Income</span>
        <span className="viz-legend-item"><span className="viz-swatch" style={{ background: "var(--viz-cat-1)" }} />Spending</span>
      </div>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} className="viz-grid" />
              <text x={m.left - 8} y={y(t)} className="viz-axis" textAnchor="end" dominantBaseline="middle">{compactMoney(t)}</text>
            </g>
          ))}
          {columns.map((c, i) => {
            const cx = m.left + band * i + band / 2;
            return (
              <g key={c.key} tabIndex={0} role="img" className="viz-col"
                aria-label={`${c.title}: income ${formatMoney(c.income)}, spending ${formatMoney(c.spending)}`}
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
                <rect x={m.left + band * i} y={m.top} width={band} height={plotH} fill="transparent" />
                <path d={bar(cx - barW - 1, c.income)} fill="var(--viz-cat-3)" opacity={hover === null || hover === i ? 1 : 0.55} />
                <path d={bar(cx + 1, c.spending)} fill="var(--viz-cat-1)" opacity={hover === null || hover === i ? 1 : 0.55} />
                {(i % labelEvery === 0 || i === columns.length - 1) && <text x={cx} y={height - 6} className="viz-axis" textAnchor="middle">{c.label}</text>}
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip width={width} tip={hover === null ? null : {
        x: m.left + band * hover + band / 2, y: m.top + 20, title: columns[hover].title,
        rows: [
          { value: formatMoney(columns[hover].income), label: "income" },
          { value: formatMoney(columns[hover].spending), label: "spending" },
          { value: `${columns[hover].income >= columns[hover].spending ? "" : "−"}${formatMoney(Math.abs(columns[hover].income - columns[hover].spending))}`, label: "left over" },
        ],
      }} />
    </div>
  );
}

// ---------- a value over time (net worth) ----------

export interface TrendPoint { key: string; label: string; title: string; value: number }

/** One emphasised line with a light area to zero; handles values below zero. */
export function TrendLine({ points, height = 200, ariaLabel, valueLabel }: { points: TrendPoint[]; height?: number; ariaLabel: string; valueLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 18, right: 56, bottom: 24, left: 48 };
  const plotW = Math.max(width - m.left - m.right, 10), plotH = height - m.top - m.bottom;
  const values = points.map((p) => p.value);
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values, 1);
  const { top, step } = niceScale(hi - lo, 3);
  const base = lo < 0 ? -Math.ceil(-lo / step) * step : 0;
  const span = Math.max(top, hi - base);
  const x = (i: number) => m.left + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => m.top + plotH - ((v - base) / span) * plotH;
  const path = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const ticks: number[] = [];
  for (let t = base; t <= base + span + 1; t += step) ticks.push(t);
  const last = points.length - 1;
  const labelEvery = Math.ceil(points.length / Math.max(Math.floor(plotW / 48), 1));
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(last, Math.round(((e.clientX - rect.left) / rect.width) * last))));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min((h ?? last - 1) + 1, last));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max((h ?? last + 1) - 1, 0));
    else return;
    e.preventDefault();
  };

  return (
    <div className="viz-plot" ref={ref}>
      {width > 0 && points.length > 0 && (
        <svg width={width} height={height} role="img" tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)}
          aria-label={`${ariaLabel}. Use the arrow keys to read each month.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={m.left + plotW} y1={y(t)} y2={y(t)} className={t === 0 && base < 0 ? "viz-ref" : "viz-grid"} />
              <text x={m.left - 8} y={y(t)} className="viz-axis" textAnchor="end" dominantBaseline="middle">{t < 0 ? `−${compactMoney(-t)}` : compactMoney(t)}</text>
            </g>
          ))}
          {points.map((p, i) => (i % labelEvery === 0 || i === last) && (
            <text key={p.key} x={x(i)} y={height - 6} className={i === last ? "viz-axis strong" : "viz-axis"} textAnchor="middle">{p.label}</text>
          ))}
          <path d={`${path}L${x(last)},${y(Math.max(base, 0))}L${x(0)},${y(Math.max(base, 0))}Z`} className="viz-area" />
          <path d={path} className="viz-line" />
          <circle cx={x(last)} cy={y(values[last])} r={5} className="viz-dot" />
          <text x={x(last) + 10} y={y(values[last])} className="viz-label" dominantBaseline="middle">
            {values[last] < 0 ? `−${compactMoney(-values[last])}` : compactMoney(values[last])}
          </text>
          {hover !== null && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={m.top} y2={m.top + plotH} className="viz-crosshair" />
              <circle cx={x(hover)} cy={y(values[hover])} r={4} className="viz-dot" />
            </>
          )}
          <rect x={m.left} y={m.top} width={plotW} height={plotH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      <Tooltip width={width} tip={hover === null ? null : {
        x: x(hover), y: m.top, title: points[hover].title,
        rows: [{ key: "line", value: `${points[hover].value < 0 ? "−" : ""}${formatMoney(Math.abs(points[hover].value))}`, label: valueLabel }],
      }} />
    </div>
  );
}

/** A tiny trend line for a summary card. Decorative: the number beside it carries the value. */
export function Sparkline({ values, width = 120, height = 36 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => (hi === lo ? height / 2 : height - 3 - ((v - lo) / (hi - lo)) * (height - 6));
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="sparkline">
      <path d={d} fill="none" stroke="var(--viz-emph)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={3} fill="var(--viz-emph)" />
    </svg>
  );
}

// ---------- where the money went (flow) ----------

export interface FlowNode { key: string; label: string; value: number; color: string }

/**
 * Money in on the left, through one "Money in" bar, out to where it went on the right (spending
 * groups and what was saved). Band widths are amounts, so the eye compares them; labels carry every
 * value, and the caller adds a table. Hover or focus a node to trace its bands.
 */
export function CashFlowSankey({ sources, targets, ariaLabel }: { sources: FlowNode[]; targets: FlowNode[]; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [focus, setFocus] = useState<string | null>(null);
  const total = Math.max(sources.reduce((t, n) => t + n.value, 0), 1);
  const narrow = width < 520;
  const labelL = narrow ? 88 : 140, labelR = narrow ? 104 : 170, nodeW = 10, gap = 10;
  const rows = Math.max(sources.length, targets.length);
  const H = Math.max(200, rows * 40);
  const k = (H - gap * (rows - 1)) / total;
  const xL = labelL, xM = width / 2 - nodeW / 2, xR = width - labelR - nodeW;

  const stack = (nodes: FlowNode[]) => {
    const used = nodes.reduce((t, n) => t + n.value * k, 0) + gap * (nodes.length - 1);
    let y = (H - used) / 2;
    return nodes.map((n) => {
      const h = Math.max(n.value * k, 2);
      const out = { ...n, y, h };
      y += h + gap;
      return out;
    });
  };
  // Labels are two lines (~30px): push them apart where small nodes sit close together.
  const spread = <T extends { y: number; h: number }>(nodes: T[]) => {
    const ys = nodes.map((n) => n.y + n.h / 2);
    for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + 30);
    const over = ys.length ? ys[ys.length - 1] - (H - 15) : 0;
    if (over > 0) for (let i = ys.length - 1; i >= 0; i--) ys[i] = Math.max(15, i === ys.length - 1 ? ys[i] - over : Math.min(ys[i], ys[i + 1] - 30));
    return nodes.map((n, i) => ({ ...n, ly: ys[i] }));
  };
  const left = spread(stack(sources)), right = spread(stack(targets));
  const midTop = (H - total * k) / 2;
  const band = (x0: number, y0: number, x1: number, y1: number, h: number) => {
    const xm = (x0 + x1) / 2;
    return `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}L${x1},${y1 + h}C${xm},${y1 + h} ${xm},${y0 + h} ${x0},${y0 + h}Z`;
  };
  let inAt = midTop, outAt = midTop;
  const inBands = left.map((n) => { const b = { n, d: band(xL + nodeW, n.y, xM, inAt, n.value * k) }; inAt += n.value * k; return b; });
  const outBands = right.map((n) => { const b = { n, d: band(xM + nodeW, outAt, xR, n.y, n.value * k) }; outAt += n.value * k; return b; });
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
  const dim = (key: string) => focus !== null && focus !== key && focus !== "__mid";

  const nodeProps = (n: FlowNode) => ({
    tabIndex: 0, role: "img", "aria-label": `${n.label}: ${formatMoney(n.value)}, ${pct(n.value)}`,
    onPointerEnter: () => setFocus(n.key), onPointerLeave: () => setFocus(null), onFocus: () => setFocus(n.key), onBlur: () => setFocus(null),
    className: "flow-node",
  });

  return (
    <div className="viz-plot" ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} role="group" aria-label={ariaLabel}>
          {inBands.map(({ n, d }) => <path key={`i${n.key}`} d={d} className="flow-band" style={{ fill: focus === n.key ? n.color : undefined, opacity: dim(n.key) ? 0.25 : undefined }} />)}
          {outBands.map(({ n, d }) => <path key={`o${n.key}`} d={d} className="flow-band" style={{ fill: focus === n.key ? n.color : undefined, opacity: dim(n.key) ? 0.25 : undefined }} />)}
          {left.map((n) => (
            <g key={n.key} {...nodeProps(n)}>
              <rect x={xL} y={n.y} width={nodeW} height={n.h} rx={3} fill={n.color} />
              {Math.abs(n.ly - (n.y + n.h / 2)) > 4 && <path d={`M${xL - 2},${n.y + n.h / 2}L${xL - 6},${n.ly}`} className="flow-leader" />}
              <text x={xL - 9} y={n.ly - 7} textAnchor="end" className="viz-label" dominantBaseline="middle">{trim(n.label, narrow ? 11 : 18)}</text>
              <text x={xL - 9} y={n.ly + 8} textAnchor="end" className="viz-axis" dominantBaseline="middle">{compactMoney(n.value)} · {pct(n.value)}</text>
            </g>
          ))}
          <g className="flow-node" tabIndex={0} role="img" aria-label={`Money in: ${formatMoney(total)}`}
            onPointerEnter={() => setFocus("__mid")} onPointerLeave={() => setFocus(null)} onFocus={() => setFocus("__mid")} onBlur={() => setFocus(null)}>
            <rect x={xM} y={midTop} width={nodeW} height={total * k} rx={3} fill="var(--ink-2)" />
          </g>
          {right.map((n) => (
            <g key={n.key} {...nodeProps(n)}>
              <rect x={xR} y={n.y} width={nodeW} height={n.h} rx={3} fill={n.color} />
              {Math.abs(n.ly - (n.y + n.h / 2)) > 4 && <path d={`M${xR + nodeW + 2},${n.y + n.h / 2}L${xR + nodeW + 6},${n.ly}`} className="flow-leader" />}
              <text x={xR + nodeW + 9} y={n.ly - 7} className="viz-label" dominantBaseline="middle">{trim(n.label, narrow ? 12 : 20)}</text>
              <text x={xR + nodeW + 9} y={n.ly + 8} className="viz-axis" dominantBaseline="middle">{compactMoney(n.value)} · {pct(n.value)}</text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
