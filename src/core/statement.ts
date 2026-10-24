import { guessCategory, type Category } from "./categories";
import { titleCase } from "./smartParser";

/**
 * Reads bank statements exported from net banking (CSV, or Excel turned into rows) into
 * transactions. Pure: no storage, no network. Indian statements put account details above the
 * table, write dates day-first, and split money into Withdrawal/Deposit columns (or one Amount
 * column with Dr/Cr), so all of that is handled here.
 */

export interface StatementTxn {
  /** Stable across re-imports of the same statement, so a row is never added twice. */
  id: string;
  date: Date;
  description: string;
  /** A readable name pulled from the description: "UPI/DR/…/SWIGGY/…" → "Swiggy". */
  name: string;
  amount: number; // paise, always positive
  direction: "debit" | "credit";
  category: Category;
  /** For credits: Salary, Refund, Interest, Cashback, or the name. */
  incomeSource: string;
}

export interface ColumnMap {
  date: number;
  description: number;
  debit: number | null;
  credit: number | null;
  /** One signed or Dr/Cr-marked amount column, when there's no Debit/Credit pair. */
  amount: number | null;
  /** A separate Dr/Cr column next to `amount`. */
  type: number | null;
  balance: number | null;
}

export interface StatementTable { headerRow: number; headers: string[]; columns: ColumnMap }

// ---------- CSV ----------

/** RFC 4180-style CSV: quoted fields, doubled quotes, CRLF. Detects comma, tab or semicolon. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLines = clean.split(/\r?\n/).slice(0, 30).join("\n");
  const delim = ([",", "\t", ";"] as const).reduce((best, d) => (count(firstLines, d) > count(firstLines, best) ? d : best), ",");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.trim() === "") { quoted = true; field = ""; }
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}
const count = (s: string, ch: string) => s.split(ch).length - 1;

// ---------- finding the table ----------

const norm = (h: string) => h.toLowerCase().replace(/[^a-z/ ]+/g, " ").replace(/\s+/g, " ").trim();
const DATE_HEAD = /^(txn |tran |transaction |posting |value )?date$|^date of transaction$|^txn date$|^tran date$/;
const DESC_HEAD = /narration|description|particulars|details|remarks|transaction remarks|transaction details/;
const DEBIT_HEAD = /withdrawal|debit|^dr$|^dr amount|paid out|money out/;
const CREDIT_HEAD = /deposit|credit|^cr$|^cr amount|paid in|money in/;
const AMOUNT_HEAD = /^(transaction )?amount( inr| rs)?$|^amt$/;
const TYPE_HEAD = /^(dr ?\/ ?cr|cr ?\/ ?dr|type|debit ?\/ ?credit|transaction type)$/;
const BALANCE_HEAD = /balance/;

/** Finds the header row and which column holds what. Null when it doesn't look like a statement. */
export function findTable(rows: string[][]): StatementTable | null {
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const heads = rows[r].map(norm);
    const find = (re: RegExp, skip: number[] = []) => {
      const i = heads.findIndex((h, j) => !skip.includes(j) && re.test(h));
      return i >= 0 ? i : null;
    };
    // Prefer the transaction date over the value date.
    const date = heads.findIndex((h) => /^(txn |tran |transaction )?date$|^date of transaction$/.test(h));
    const anyDate = date >= 0 ? date : heads.findIndex((h) => DATE_HEAD.test(h));
    const description = find(DESC_HEAD);
    if (anyDate < 0 || description === null) continue;
    const debit = find(DEBIT_HEAD, [anyDate, description]);
    const credit = find(CREDIT_HEAD, [anyDate, description, ...(debit !== null ? [debit] : [])]);
    const amount = debit === null || credit === null ? find(AMOUNT_HEAD) : null;
    if ((debit === null || credit === null) && amount === null) continue;
    return {
      headerRow: r,
      headers: rows[r],
      columns: { date: anyDate, description, debit, credit, amount, type: find(TYPE_HEAD), balance: find(BALANCE_HEAD) },
    };
  }
  return null;
}

// ---------- values ----------

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** Day-first dates as Indian banks write them: 05/10/2026, 05-10-26, 05-Oct-2026, 05 Oct 26, 2026-10-05. */
export function parseStatementDate(raw: string): Date | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/.exec(s);
  if (m) return valid(year(m[3]), +m[2] - 1, +m[1]);
  m = /^(\d{1,2})[\s\-/]([A-Za-z]{3,4})[a-z]*[\s\-/,]+(\d{2,4})\b/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) return valid(year(m[3]), MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
function valid(y: number, mo: number, d: number): Date | null {
  const date = new Date(y, mo, d, 12);
  return date.getFullYear() === y && date.getMonth() === mo && date.getDate() === d && y > 1990 && y < 2100 ? date : null;
}

/** "1,23,456.78", "₹ 450.00", "450.00 Dr", "(450.00)", "-450" → signed paise, or null when empty. */
export function parseStatementAmount(raw: string): { paise: number; marker: "dr" | "cr" | null } | null {
  const s = raw.trim();
  if (!s || s === "-" || s === "--") return null;
  const marker = /\bdr\.?$/i.test(s) ? "dr" : /\bcr\.?$/i.test(s) ? "cr" : null;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
  const digits = s.replace(/[^0-9.]/g, "");
  if (!/\d/.test(digits)) return null;
  const value = Math.round(parseFloat(digits) * 100);
  if (!Number.isFinite(value)) return null;
  return { paise: negative ? -value : value, marker };
}

// ---------- names, categories and income sources ----------

const NOISE = new Set([
  "upi", "dr", "cr", "neft", "imps", "rtgs", "pos", "ach", "atm", "nach", "ecs", "mb", "ib", "inb", "bil", "onl", "payment", "paid", "to", "from",
  "transfer", "trf", "txn", "ref", "vpa", "na", "null", "the", "debit", "credit", "card", "purchase", "ecom", "int", "inr", "rs", "by", "via",
  "yesb", "hdfc", "icic", "sbin", "utib", "kkbk", "pytm", "barb", "punb", "idib", "ubin", "cnrb", "indb", "ibkl", "fdrl", "yblupi", "ybl",
  "okaxis", "oksbi", "okhdfcbank", "okicici", "paytm", "axl", "apl", "ibl", "upi lite", "collect", "request", "mandate", "autopay",
]);

/** A readable name from a bank's narration, or the narration itself, tidied. */
export function nameFromNarration(narration: string): string {
  const parts = narration.split(/[/|\-:*]+|\s{2,}/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    // Masked card numbers (512345XXXXXX1234) aren't part of a name.
    const handle = (part.includes("@") ? part.split("@")[0] : part).replace(/\b[\dX]*X{3,}[\dX]*\b/gi, " ").trim();
    if (!handle) continue;
    const words = handle.toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !NOISE.has(w));
    const letters = handle.replace(/[^A-Za-z]/g, "").length;
    // A name has mostly letters (not an account or reference number) and isn't a bank code.
    if (words.length && letters >= 3 && letters >= handle.replace(/\s/g, "").length * 0.6 && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(part)) {
      return titleCase(words.join(" ")).slice(0, 40);
    }
  }
  // Only bank words (e.g. "BIL/ONL/000123/HDFC CREDIT CARD/PAYMENT"): use the most wordy part as written.
  const wordiest = parts.reduce((best, p) => (p.replace(/[^A-Za-z]/g, "").length > best.replace(/[^A-Za-z]/g, "").length ? p : best), "");
  return titleCase((wordiest || narration).toLowerCase().replace(/\s+/g, " ").trim()).slice(0, 40);
}

export function incomeSourceFor(narration: string, name: string): string {
  const n = narration.toUpperCase();
  if (/\bSAL(ARY)?\b|SALARY|PAYROLL/.test(n)) return "Salary";
  if (/REFUND|REVERSAL|REVERSED|\bRFND\b/.test(n)) return "Refund";
  if (/\bINT\.?\s?(PD|CR|PAID)\b|INTEREST/.test(n)) return "Interest";
  if (/CASHBACK|CASH BACK/.test(n)) return "Cashback";
  if (/DIVIDEND|\bDIV\b/.test(n)) return "Dividend";
  return name;
}

// ---------- rows → transactions ----------

/** FNV-1a: a short, stable fingerprint for a statement row. */
function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

export function readTransactions(rows: string[][], table: StatementTable): StatementTxn[] {
  const c = table.columns;
  const out: StatementTxn[] = [];
  const seen = new Map<string, number>();
  for (const row of rows.slice(table.headerRow + 1)) {
    const date = parseStatementDate(row[c.date] ?? "");
    if (!date) continue; // opening balance, totals, page footers
    const description = (row[c.description] ?? "").replace(/\s+/g, " ").trim();
    let amount = 0, direction: "debit" | "credit" | null = null;
    if (c.debit !== null && c.credit !== null) {
      const d = parseStatementAmount(row[c.debit] ?? ""), cr = parseStatementAmount(row[c.credit] ?? "");
      if (d && d.paise !== 0) { amount = Math.abs(d.paise); direction = "debit"; }
      else if (cr && cr.paise !== 0) { amount = Math.abs(cr.paise); direction = "credit"; }
    } else if (c.amount !== null) {
      const a = parseStatementAmount(row[c.amount] ?? "");
      if (a && a.paise !== 0) {
        const typeCell = c.type !== null ? (row[c.type] ?? "").trim().toLowerCase() : "";
        const marker = typeCell.startsWith("d") ? "dr" : typeCell.startsWith("c") ? "cr" : a.marker;
        amount = Math.abs(a.paise);
        direction = marker === "dr" ? "debit" : marker === "cr" ? "credit" : a.paise < 0 ? "debit" : "credit";
      }
    }
    if (!direction || !amount) continue;
    const balance = c.balance !== null ? (row[c.balance] ?? "").replace(/[^0-9.\-]/g, "") : "";
    const key = [date.toDateString(), direction, amount, description.toLowerCase(), balance].join("|");
    // Two identical rows on one statement (same day, amount, text, no balance) are still two transactions.
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const name = nameFromNarration(description);
    out.push({
      id: `stmt-${fingerprint(`${key}|${n}`)}`, date, description, name, amount, direction,
      category: guessCategory(`${name} ${description}`), incomeSource: direction === "credit" ? incomeSourceFor(description, name) : "",
    });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ---------- matching what's already in Tally ----------

export interface Existing { id: string; amount: number; at: number }

/**
 * For each transaction: "imported" when this exact row was imported before (it's skipped), or
 * "maybe-logged" when something with the same amount within two days is already in Tally — likely
 * the same spend logged by hand, so it starts unticked.
 */
export function matchExisting(txns: StatementTxn[], expenses: Existing[], incomes: Existing[]): Map<string, "imported" | "maybe-logged"> {
  const result = new Map<string, "imported" | "maybe-logged">();
  const ids = new Set([...expenses, ...incomes].map((x) => x.id));
  const used = new Set<string>();
  const twoDays = 2 * 86_400_000;
  for (const t of txns) {
    if (ids.has(t.id)) { result.set(t.id, "imported"); continue; }
    const pool = t.direction === "debit" ? expenses : incomes;
    const match = pool.find((x) => !x.id.startsWith("stmt-") && !used.has(x.id) && x.amount === t.amount && Math.abs(x.at - t.date.getTime()) <= twoDays);
    if (match) { used.add(match.id); result.set(t.id, "maybe-logged"); }
  }
  return result;
}

/**
 * Money moved rather than spent or earned: credit card bill payments (the card's spends are
 * counted separately), transfers to your own accounts, deposits and investments.
 */
export function looksLikeTransfer(t: StatementTxn): boolean {
  const n = t.description.toUpperCase();
  return /CREDIT CARD|\bCC\s?(PAYMENT|BILL|PMT)\b|CARD (BILL|PAYMENT|DUES)|\bSELF\b|OWN A\/?C|OWN ACCOUNT|SWEEP|\bFD\b|FIXED DEPOSIT|\bRD\b|RECURRING DEPOSIT|MUTUAL FUND|\bSIP\b|\bPPF\b|ZERODHA|GROWW|\bNPS\b/.test(n);
}

/** Bank name from the text above the table, for the account field. */
export function guessBank(rows: string[][], headerRow: number): string | null {
  const top = rows.slice(0, Math.max(headerRow, 1)).flat().join(" ").toUpperCase();
  const banks: [RegExp, string][] = [
    [/HDFC/, "HDFC Bank"], [/ICICI/, "ICICI Bank"], [/STATE BANK|\bSBI\b/, "SBI"], [/AXIS/, "Axis Bank"], [/KOTAK/, "Kotak Bank"],
    [/YES BANK/, "Yes Bank"], [/IDFC/, "IDFC First Bank"], [/BANK OF BARODA/, "Bank of Baroda"], [/PUNJAB NATIONAL|\bPNB\b/, "PNB"],
  ];
  return banks.find(([re]) => re.test(top))?.[1] ?? null;
}
