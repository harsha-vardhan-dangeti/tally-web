import type { Category } from "./categories";

/**
 * The user's rules: "when a payment mentions swiggy, it's Food". Checked before Tally's own guesses
 * wherever an expense is categorised from text (Smart add, receipts, captures, bank imports).
 */

export interface Rule {
  id: string;
  /** Lowercase text to look for in the merchant or description. */
  match: string;
  category: Category;
  /** Shown as the merchant name instead of the bank's description, when set. */
  rename: string;
}

const MAX_RULES = 100;

/** Rules arrive from sync and backups, so each field is checked. */
export function sanitizeRules(saved: unknown): Rule[] {
  if (!Array.isArray(saved)) return [];
  const out: Rule[] = [];
  for (const r of saved) {
    if (!r || typeof r !== "object") continue;
    const v = r as Record<string, unknown>;
    const match = typeof v.match === "string" ? v.match.trim().toLowerCase().slice(0, 40) : "";
    if (match.length < 2 || typeof v.id !== "string" || !v.id || typeof v.category !== "string" || !v.category) continue;
    if (out.some((x) => x.id === v.id || x.match === match)) continue;
    out.push({ id: v.id, match, category: v.category, rename: typeof v.rename === "string" ? v.rename.trim().slice(0, 40) : "" });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

let rules: Rule[] = [];

/** Called by the store whenever settings change. */
export function setRules(saved: unknown) { rules = sanitizeRules(saved); }

/** The first rule whose text appears in `text`, ignoring case and punctuation. */
export function matchRule(text: string): Rule | null {
  const hay = ` ${text.toLowerCase().replace(/[^0-9a-z]+/g, " ")} `;
  return rules.find((r) => hay.includes(` ${r.match.replace(/[^0-9a-z]+/g, " ").trim()}`)) ?? null;
}
