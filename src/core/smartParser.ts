import { parsePaise } from "./money";
import { guessCategory, type Category } from "./categories";
import { addDays } from "./budget";

export interface ParsedExpense {
  amount: number; // paise
  merchant: string | null;
  note: string;
  category: Category;
  splitWith: string[];
  splitWays: number;
  account: string | null;
  date: Date;
}

export const yourShare = (amount: number, ways: number) => Math.floor(amount / Math.max(ways, 1));

export const titleCase = (s: string) =>
  s.split(" ").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

function cut(text: string, m: RegExpExecArray): string {
  return text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
}

/** "lunch 350 at chutneys, split with arjun" → structured expense. Runs entirely in the browser. */
export function parseExpense(line: string, now = new Date()): ParsedExpense | null {
  let text = " " + line.toLowerCase().replace(/₹/g, " ").replace(/\t/g, " ") + " ";
  text = text.replace(/\b(rs\.?|inr|rupees?)\s*/gi, " ");

  let splitWays = 1;
  let splitWith: string[] = [];
  let m = /split\s+(?:in\s+|into\s+)?(\d+)\s*ways?/i.exec(text);
  if (m && Number(m[1]) > 1) {
    splitWays = Number(m[1]);
    text = cut(text, m);
  }

  m = /(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?\b/i.exec(text);
  if (!m) return null;
  const amount = parsePaise(m[1] + (m[2] ? "k" : ""));
  if (!amount) return null;
  text = cut(text, m);

  if (splitWays === 1) {
    m = /split\s+(?:with|between)\s+(.+?)(?=,|\.|$|\s+at\s|\s+on\s|\s+using\s|\s+via\s|\s+yesterday|\s+today)/i.exec(text);
    if (m) {
      splitWith = m[1]
        .split(/[,&]/)
        .flatMap((p) => p.split(" and "))
        .map((n) => n.trim())
        .filter((n) => n && n !== "me")
        .map(titleCase);
      splitWays = splitWith.length + 1;
      text = cut(text, m);
    }
  }

  let date = now;
  if (text.includes(" yesterday")) {
    date = addDays(now, -1);
    text = text.replace(" yesterday", " ");
  }
  text = text.replace(" today", " ");

  let account: string | null = null;
  const accounts: [string, string][] = [
    ["credit card", "Credit card"], ["card", "Credit card"], ["cash", "Cash"],
    ["upi", "UPI"], ["gpay", "UPI"], ["phonepe", "UPI"], ["paytm", "UPI"],
  ];
  for (const [word, name] of accounts) {
    const am = new RegExp(`\\b(?:(?:by|via|using|on|with)\\s+)?${word}\\b`, "i").exec(text);
    if (am) {
      account = name;
      text = cut(text, am);
      break;
    }
  }

  let merchant: string | null = null;
  m = /\b(?:at|from)\s+([a-z0-9'&.\- ]+?)(?=,|$|\s+for\s|\s+on\s)/i.exec(text);
  if (m) {
    const name = m[1].trim();
    if (name) merchant = titleCase(name);
    text = cut(text, m);
  }

  const note = text
    .replace(/\b(for|on|spent|paid)\b/g, " ")
    .split(/[ ,.;:-]/)
    .filter(Boolean)
    .join(" ");

  return {
    amount,
    merchant,
    note: note ? note[0].toUpperCase() + note.slice(1) : "",
    category: guessCategory(`${note} ${merchant ?? ""}`),
    splitWith,
    splitWays,
    account,
    date,
  };
}

export function parseLines(text: string, now = new Date()): ParsedExpense[] {
  return text.split(/\r?\n/).map((l) => parseExpense(l, now)).filter((p): p is ParsedExpense => p !== null);
}
