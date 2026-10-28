import { describe, expect, it } from "vitest";
import { compactMoney, formatMoney, parsePaise } from "./money";
import { crossedThreshold, monthKey, snapshot } from "./budget";
import { parseExpense, parseLines } from "./smartParser";
import { parseReceipt } from "./receiptParser";
import { categoryMeta, guessCategory, pickableCategories, resolveCategories, setCategoryDefs, toCategory } from "./categories";
import { matchRule, sanitizeRules, setRules } from "./rules";

describe("money", () => {
  it("formats with Indian grouping", () => {
    expect(formatMoney(0)).toBe("₹0");
    expect(formatMoney(3_842_000)).toBe("₹38,420");
    expect(formatMoney(12_345_678_900)).toBe("₹12,34,56,789");
    expect(formatMoney(-15_000)).toBe("−₹150");
    expect(formatMoney(12_350, { showPaise: true })).toBe("₹123.50");
  });
  it("parses amounts", () => {
    expect(parsePaise("350")).toBe(35_000);
    expect(parsePaise("1,250.50")).toBe(125_050);
    expect(parsePaise("₹ 99")).toBe(9_900);
    expect(parsePaise("1.5k")).toBe(150_000);
    expect(parsePaise("abc")).toBeNull();
    expect(parsePaise("0")).toBeNull();
  });
  it("compacts for charts", () => {
    expect(compactMoney(95_000)).toBe("₹950");
    expect(compactMoney(196_500)).toBe("₹2k");
    expect(compactMoney(5_200_000)).toBe("₹52k");
    expect(compactMoney(12_000_000)).toBe("₹1.2L");
  });
});

describe("budget", () => {
  it("computes safe-to-spend", () => {
    const s = snapshot(5_500_000, 3_842_000, 124_000, new Date(2026, 9, 23, 12));
    expect(s.daysLeft).toBe(9);
    expect(s.left).toBe(1_658_000);
    expect(s.safePerDay).toBe(198_000);
    expect(s.leftToday).toBe(74_000);
    expect(s.projected).toBe(5_178_347);
  });
  it("never goes negative when over budget", () => {
    const s = snapshot(100_000, 150_000, 0, new Date(2026, 9, 10));
    expect(s.isOver).toBe(true);
    expect(s.safePerDay).toBe(0);
  });
  it("detects thresholds", () => {
    expect(crossedThreshold(70_000, 85_000, 100_000)).toBe(80);
    expect(crossedThreshold(70_000, 120_000, 100_000)).toBe(100);
    expect(crossedThreshold(85_000, 90_000, 100_000)).toBeNull();
    expect(monthKey(new Date(2026, 2, 5))).toBe("2026-03");
  });
});

describe("categories", () => {
  it("keeps known categories and replaces anything else", () => {
    expect(toCategory("food")).toBe("food");
    expect(toCategory("pwn")).toBe("other");
    expect(toCategory(null, "transport")).toBe("transport");
    expect(toCategory("__proto__")).toBe("other");
  });

  it("adds the user's own categories, renames and hides built-ins", () => {
    setCategoryDefs([
      { id: "c-gym", title: "Gym", icon: "dumbbell", tint: "#0E7C86", keywords: ["cult", "protein"], hidden: false },
      { id: "fun", title: "Going out", icon: "sparkle", tint: "#BF2E73", keywords: [], hidden: true },
    ]);
    expect(toCategory("c-gym")).toBe("c-gym");
    expect(categoryMeta("fun").title).toBe("Going out");
    expect(pickableCategories()).not.toContain("fun");
    expect(pickableCategories("fun")).toContain("fun");
    // Their own words and name win over the built-in "gym" → Health.
    expect(guessCategory("gym 1500")).toBe("c-gym");
    expect(guessCategory("cult fit")).toBe("c-gym");
    // A hidden category isn't guessed.
    expect(guessCategory("netflix")).toBe("other");
    setCategoryDefs([]);
    expect(guessCategory("gym")).toBe("health");
    expect(toCategory("c-gym")).toBe("other");
  });

  it("puts the user's rules before every other guess", () => {
    setRules([{ id: "r1", match: "swiggy", category: "groceries", rename: "Swiggy Instamart" }, { id: "r2", match: "x", category: "fun", rename: "" }]);
    expect(guessCategory("UPI/DR/SWIGGY123/food")).toBe("groceries");
    expect(matchRule("upi swiggy")?.rename).toBe("Swiggy Instamart");
    expect(matchRule("myswiggy")).toBeNull(); // whole words only, from the start
    expect(sanitizeRules([{ id: "r2", match: "x", category: "fun" }, "junk", { id: "r3", match: "  UBER ", category: "transport", rename: 5 }]))
      .toEqual([{ id: "r3", match: "uber", category: "transport", rename: "" }]);
    setRules([]);
    expect(guessCategory("swiggy")).toBe("food");
  });

  it("checks categories that arrive from sync or a backup", () => {
    const defs = resolveCategories([
      { id: "c-a", title: "  ", icon: "x" },                 // no name: dropped
      { id: "c-b", title: "Pets", icon: "nope", tint: "red; background: url(x)" },
      { id: "other", hidden: true },                          // Other can't be hidden
      { id: "__proto__", title: "x" },
      "junk",
    ]);
    const pets = defs.find((d) => d.id === "c-b")!;
    expect(pets).toMatchObject({ title: "Pets", icon: "grid", tint: "#565C69" });
    expect(defs.find((d) => d.id === "c-a")).toBeUndefined();
    expect(defs.find((d) => d.id === "other")?.hidden).toBe(false);
    expect(defs).toHaveLength(9);
  });
});

describe("smart parser", () => {
  const now = new Date(2026, 9, 23, 13, 30);
  it("parses a full sentence", () => {
    const p = parseExpense("lunch 350 at chutneys, split with arjun", now)!;
    expect(p.amount).toBe(35_000);
    expect(p.merchant).toBe("Chutneys");
    expect(p.category).toBe("food");
    expect(p.splitWith).toEqual(["Arjun"]);
    expect(p.splitWays).toBe(2);
    expect(p.note).toBe("Lunch");
  });
  it("handles short forms", () => {
    expect(parseExpense("auto 120", now)!.category).toBe("transport");
    const card = parseExpense("groceries 850 card", now)!;
    expect(card.account).toBe("Credit card");
    expect(card.category).toBe("groceries");
    expect(parseExpense("₹1.2k amazon", now)!.amount).toBe(120_000);
  });
  it("handles split N ways and yesterday", () => {
    const p = parseExpense("dinner 1,800 split 3 ways yesterday", now)!;
    expect(p.amount).toBe(180_000);
    expect(p.splitWays).toBe(3);
    expect(p.date.getDate()).toBe(22);
  });
  it("parses lines and rejects text without amounts", () => {
    expect(parseLines("auto 120\ncoffee 180\n\nhello", now)).toHaveLength(2);
    expect(parseExpense("coffee with friends", now)).toBeNull();
  });
});

describe("receipt parser", () => {
  it("prefers the total line", () => {
    const r = parseReceipt(["CHUTNEYS RESTAURANT", "GSTIN 36AABCC1234D1Z5", "Date 23/10/2026", "Masala Dosa 180.00",
      "Sub Total 270.00", "CGST 6.75", "Grand Total 283.50"]);
    expect(r.total).toBe(28_350);
    expect(r.merchant).toBe("Chutneys Restaurant");
  });
  it("falls back to the largest amount", () => {
    expect(parseReceipt(["Blue Tokai", "Latte 220.00", "Cookie 120.00", "Paid 340.00"]).total).toBe(34_000);
  });
});
