import { describe, expect, it } from "vitest";
import { hi } from "./hi";
import { te } from "./te";
import { ta } from "./ta";
import { setLanguage, t } from "./index";

// Every source file's text, through Vite (no Node APIs needed).
const sources = import.meta.glob<string>(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts"], { query: "?raw", import: "default", eager: true });

describe("translations", () => {
  const used = new Set<string>();
  for (const text of Object.values(sources)) for (const m of text.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) used.add(JSON.parse(`"${m[1]}"`));

  for (const [name, dict] of Object.entries({ hi, te, ta })) {
    it(`${name} has every string the app uses, with the same placeholders`, () => {
      const missing = [...used].filter((k) => !(k in dict));
      expect(missing).toEqual([]);
      for (const [k, v] of Object.entries(dict)) {
        expect((v.match(/\{\w+\}/g) ?? []).sort(), k).toEqual((k.match(/\{\w+\}/g) ?? []).sort());
      }
    });
  }

  it("fills placeholders and falls back to English", () => {
    setLanguage("hi");
    expect(t("{n} loans", { n: 2 })).toBe("2 लोन");
    expect(t("Not a translated string")).toBe("Not a translated string");
    setLanguage("en");
    expect(t("{n} loans", { n: 2 })).toBe("2 loans");
  });
});
