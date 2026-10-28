import { findTable } from "./statement";

/**
 * Turns the text of a PDF bank statement into rows of cells, like a CSV. PDFs have no table, only
 * words at positions, so the header row ("Date Narration … Balance") sets where each column is, and
 * every word below it goes to the column it sits under. Pure: the PDF reading happens in Import.
 */

export interface TextItem {
  str: string;
  /** Left edge and width, in PDF points. */
  x: number;
  w: number;
  /** Distance from the top of the page, in points. */
  y: number;
  page: number;
}

interface Line { page: number; y: number; items: TextItem[] }
interface Cell { text: string; x0: number; x1: number }

/** Words on the same baseline (within 2.5 points) form a line. */
function lines(items: TextItem[]): Line[] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const out: Line[] = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= 2.5) last.items.push(it);
    else out.push({ page: it.page, y: it.y, items: [it] });
  }
  for (const l of out) l.items.sort((a, b) => a.x - b.x);
  return out;
}

/** Joins words closer than `gap` points into one cell. */
function cells(line: Line, gap = 4): Cell[] {
  const out: Cell[] = [];
  for (const it of line.items) {
    const last = out[out.length - 1];
    if (last && it.x - last.x1 < gap) { last.text = `${last.text} ${it.str.trim()}`.trim(); last.x1 = Math.max(last.x1, it.x + it.w); }
    else out.push({ text: it.str.trim(), x0: it.x, x1: it.x + it.w });
  }
  return out;
}

/** The header column a word belongs to: the one it overlaps most, or else the nearest. */
function columnOf(it: TextItem, heads: Cell[]): number {
  let best = 0, bestScore = -Infinity;
  heads.forEach((h, i) => {
    // Positive: how much they overlap. Negative: the gap between them, so nearer scores higher.
    const score = Math.min(it.x + it.w, h.x1) - Math.max(it.x, h.x0);
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

export function pdfRows(items: TextItem[]): string[][] {
  const all = lines(items);
  const headerAt = all.findIndex((l, i) => i < 120 && findTable([cells(l).map((c) => c.text)]) !== null);
  if (headerAt < 0) return all.map((l) => [cells(l).map((c) => c.text).join(" ")]);

  const heads = cells(all[headerAt]);
  const headerText = heads.map((h) => h.text).join("|");
  const table = findTable([heads.map((h) => h.text)])!;
  const dateCol = table.columns.date, descCol = table.columns.description;
  // Text above the table (bank name, account details) stays as one cell per line, for guessing the bank.
  const rows: string[][] = all.slice(0, headerAt).map((l) => [cells(l).map((c) => c.text).join(" ")]);
  rows.push(heads.map((h) => h.text));

  let prev: { row: string[]; line: Line } | null = null;
  for (const line of all.slice(headerAt + 1)) {
    const lineCells = cells(line);
    // Each page repeats the header; skip it.
    if (lineCells.map((c) => c.text).join("|") === headerText) { prev = null; continue; }
    const row = heads.map(() => "");
    for (const it of line.items) {
      const col = columnOf(it, heads);
      row[col] = `${row[col]} ${it.str.trim()}`.trim();
    }
    const onlyDescription = row.every((c, i) => !c || i === descCol);
    const close = prev && prev.line.page === line.page && line.y - prev.line.y < 30;
    // A long narration wraps onto the next line: those lines carry only more description.
    if (!row[dateCol] && onlyDescription && close && prev) {
      prev.row[descCol] = `${prev.row[descCol]} ${row[descCol]}`.trim();
      prev.line = line;
      continue;
    }
    rows.push(row);
    prev = { row, line };
  }
  return rows;
}
