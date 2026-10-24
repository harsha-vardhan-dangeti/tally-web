/** All money is whole paise (integers). Never floats for stored amounts. */

export function groupIndian(value: number): string {
  const digits = String(Math.trunc(Math.abs(value)));
  if (digits.length <= 3) return digits;
  const lastThree = digits.slice(-3);
  let head = digits.slice(0, -3);
  const groups: string[] = [];
  while (head.length > 2) {
    groups.unshift(head.slice(-2));
    head = head.slice(0, -2);
  }
  if (head) groups.unshift(head);
  return [...groups, lastThree].join(",");
}

/** "₹1,23,456" — paise shown only when non-zero and showPaise is set. */
export function formatMoney(paise: number, opts: { showPaise?: boolean; signed?: boolean } = {}): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  let text = "₹" + groupIndian(rupees);
  if (opts.showPaise && rem !== 0) text += "." + String(rem).padStart(2, "0");
  if (negative) return "−" + text;
  if (opts.signed && paise > 0) return "+" + text;
  return text;
}

/** Parses "350", "1,250.50", "₹ 99", "1.5k" into paise; null if invalid or not positive. */
export function parsePaise(input: string): number | null {
  let cleaned = input
    .toLowerCase()
    .replace(/₹/g, "")
    .replace(/,/g, "")
    .replace(/rs\.?/g, "")
    .trim();
  let multiplier = 1;
  if (cleaned.endsWith("k")) {
    multiplier = 1000;
    cleaned = cleaned.slice(0, -1).trim();
  }
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Math.round(parseFloat(cleaned) * multiplier * 100);
  return value > 0 ? value : null;
}

export const rupees = (paise: number) => paise / 100;

/** Short labels for charts: ₹950, ₹1.9k, ₹52k, ₹1.2L. */
export function compactMoney(paise: number): string {
  const r = Math.round(paise / 100);
  if (r < 1000) return "₹" + r;
  if (r < 100000) return "₹" + (r < 10000 ? (r / 1000).toFixed(1).replace(/\.0$/, "") : Math.round(r / 1000)) + "k";
  return "₹" + (r / 100000).toFixed(1).replace(/\.0$/, "") + "L";
}
