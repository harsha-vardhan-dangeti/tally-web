/** All money is whole minor units (paise, cents). Never floats for stored amounts. */

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  /** Lakh/crore grouping (1,23,456) instead of thousands (123,456). */
  indian: boolean;
}

/** Currencies with two decimal places. The symbol is written before the amount. */
export const CURRENCIES: CurrencyInfo[] = [
  { code: "INR", symbol: "₹", name: "Indian rupee", indian: true },
  { code: "USD", symbol: "$", name: "US dollar", indian: false },
  { code: "EUR", symbol: "€", name: "Euro", indian: false },
  { code: "GBP", symbol: "£", name: "British pound", indian: false },
  { code: "AED", symbol: "AED ", name: "UAE dirham", indian: false },
  { code: "SAR", symbol: "SAR ", name: "Saudi riyal", indian: false },
  { code: "QAR", symbol: "QAR ", name: "Qatari riyal", indian: false },
  { code: "SGD", symbol: "S$", name: "Singapore dollar", indian: false },
  { code: "AUD", symbol: "A$", name: "Australian dollar", indian: false },
  { code: "CAD", symbol: "C$", name: "Canadian dollar", indian: false },
  { code: "NZD", symbol: "NZ$", name: "New Zealand dollar", indian: false },
  { code: "MYR", symbol: "RM ", name: "Malaysian ringgit", indian: false },
  { code: "CHF", symbol: "CHF ", name: "Swiss franc", indian: false },
  { code: "ZAR", symbol: "R ", name: "South African rand", indian: false },
  { code: "LKR", symbol: "Rs ", name: "Sri Lankan rupee", indian: false },
  { code: "NPR", symbol: "Rs ", name: "Nepalese rupee", indian: false },
  { code: "BDT", symbol: "৳", name: "Bangladeshi taka", indian: true },
];

let current: CurrencyInfo = CURRENCIES[0];

export const currencyInfo = (code: string): CurrencyInfo | undefined => CURRENCIES.find((c) => c.code === code);
export const isCurrency = (code: unknown): code is string => typeof code === "string" && !!currencyInfo(code);

/** The currency every amount in the app is in (Settings → Currency). */
export function setCurrency(code: string) { current = currencyInfo(code) ?? CURRENCIES[0]; }
export const homeCurrency = () => current;
/** "₹", "$", "AED" — for labels like "Amount (₹)". */
export const currencySymbol = (code?: string) => ((code ? currencyInfo(code) : current) ?? current).symbol.trim();

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

export const groupThousands = (value: number) => String(Math.trunc(Math.abs(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * "₹1,23,456", "$123,456" — cents shown only when non-zero and showPaise is set.
 * `currency` formats in another currency than the home one (an amount paid abroad).
 */
export function formatMoney(paise: number, opts: { showPaise?: boolean; signed?: boolean; currency?: string } = {}): string {
  const c = (opts.currency ? currencyInfo(opts.currency) : current) ?? current;
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const whole = Math.floor(abs / 100);
  const rem = abs % 100;
  let text = c.symbol + (c.indian ? groupIndian(whole) : groupThousands(whole));
  if (opts.showPaise && rem !== 0) text += "." + String(rem).padStart(2, "0");
  if (negative) return "−" + text;
  if (opts.signed && paise > 0) return "+" + text;
  return text;
}

const SYMBOLS = /[₹$€£৳]/g;
const CODES = new RegExp(`\\b(${[...CURRENCIES.map((c) => c.code), "rs", "rm", "dhs?"].join("|")})\\b\\.?`, "gi");

/** Parses "350", "1,250.50", "₹ 99", "$12", "AED 40", "1.5k" into minor units; null if invalid or not positive. */
export function parsePaise(input: string): number | null {
  let cleaned = input
    .toLowerCase()
    .replace(SYMBOLS, "")
    .replace(CODES, "")
    .replace(/,/g, "")
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

/** Short labels for charts: ₹950, ₹1.9k, ₹52k, ₹1.2L; $950, $1.9k, $52k, $1.2M. */
export function compactMoney(paise: number): string {
  const sym = current.symbol.trim();
  const r = Math.round(paise / 100);
  if (r < 1000) return sym + r;
  if (r < 100000) return sym + (r < 10000 ? (r / 1000).toFixed(1).replace(/\.0$/, "") : Math.round(r / 1000)) + "k";
  if (current.indian) return sym + (r / 100000).toFixed(1).replace(/\.0$/, "") + "L";
  if (r < 1_000_000) return sym + Math.round(r / 1000) + "k";
  return sym + (r / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}
