import { parsePaise } from "./money";
import { titleCase } from "./smartParser";

export function amountsIn(line: string): number[] {
  const re = /(?<![\d.])(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d{1,6})(?!\d)/g;
  const out: number[] = [];
  for (const m of line.matchAll(re)) {
    const p = parsePaise(m[1]);
    if (p) out.push(p);
  }
  return out;
}

/** Total and merchant from OCR'd receipt lines. */
export function parseReceipt(lines: string[]): { total: number | null; merchant: string | null } {
  const cleaned = lines.map((l) => l.trim()).filter(Boolean);
  let total: number | null = null;
  for (const line of [...cleaned].reverse()) {
    const lower = line.toLowerCase();
    const isTotal =
      lower.includes("grand total") || lower.includes("net amount") || lower.includes("amount paid") ||
      (lower.includes("total") && !lower.includes("subtotal") && !lower.includes("sub total"));
    const amounts = amountsIn(line);
    if (isTotal && amounts.length) {
      total = amounts[amounts.length - 1];
      break;
    }
  }
  if (total === null) {
    const all = cleaned.flatMap(amountsIn);
    total = all.length ? Math.max(...all) : null;
  }
  const merchantLine = cleaned.find((l) => {
    const letters = (l.match(/\p{L}/gu) ?? []).length;
    return letters >= 3 && letters / Math.max(l.length, 1) > 0.6;
  });
  return { total, merchant: merchantLine ? titleCase(merchantLine.toLowerCase()) : null };
}
