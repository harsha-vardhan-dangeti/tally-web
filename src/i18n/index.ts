import { hi } from "./hi";
import { te } from "./te";
import { ta } from "./ta";

/**
 * Translations. The English text is the key, so a string missing from a dictionary simply shows in
 * English. `{name}` placeholders are filled from `vars`.
 */

export type Lang = "en" | "hi" | "te" | "ta";
export const LANGUAGES: { id: Lang; name: string; native: string }[] = [
  { id: "en", name: "English", native: "English" },
  { id: "hi", name: "Hindi", native: "हिन्दी" },
  { id: "te", name: "Telugu", native: "తెలుగు" },
  { id: "ta", name: "Tamil", native: "தமிழ்" },
];
const DICTS: Record<Lang, Record<string, string>> = { en: {}, hi, te, ta };

let lang: Lang = "en";

export const isLang = (v: unknown): v is Lang => typeof v === "string" && v in DICTS;

export function setLanguage(l: Lang) {
  lang = isLang(l) ? l : "en";
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}
export const language = () => lang;

export function t(text: string, vars?: Record<string, string | number>): string {
  const s = DICTS[lang][text] ?? text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Locale for dates in the chosen language, e.g. "hi-IN"; undefined keeps the browser's. */
export const dateLocale = (): string | undefined => (lang === "en" ? undefined : `${lang}-IN`);
