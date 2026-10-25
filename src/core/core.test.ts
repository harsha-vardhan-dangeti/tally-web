import { describe, expect, it } from "vitest";
import { compactMoney, formatMoney, parsePaise } from "./money";
import { crossedThreshold, monthKey, snapshot } from "./budget";
import { parseExpense, parseLines } from "./smartParser";
import { parseReceipt } from "./receiptParser";
import { toCategory } from "./categories";

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
