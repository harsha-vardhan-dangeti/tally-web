import { afterEach, describe, expect, it } from "vitest";
import { addMonths, dayOfMonth, daysInMonth, monthLabel, monthRange, periodBounds, setMonthStartDay, snapshot, weekRange } from "./budget";
import { evaluate, parsePaise } from "./money";
import { cardBill, cardCycle } from "./cards";
import { dueInPeriod, monthlyEquivalent, nextDueDate, periodKey } from "./schedule";
import { parseExpense, tagsIn } from "./smartParser";
import { groupSpending, periodRange } from "./reports";
import type { Expense } from "../data/store";

afterEach(() => setMonthStartDay(1));
const d = (y: number, m: number, day: number, h = 12) => new Date(y, m - 1, day, h);
const ymd = (x: Date) => x.toLocaleDateString("en-CA");

describe("month start day", () => {
  it("keeps calendar months by default", () => {
    expect(monthRange(d(2026, 11, 14)).map(ymd)).toEqual(["2026-11-01", "2026-12-01"]);
    expect(ymd(addMonths(d(2026, 11, 14), -1))).toBe("2026-10-01");
    expect(daysInMonth(d(2026, 2, 10))).toBe(28);
    expect(dayOfMonth(d(2026, 11, 14))).toBe(14);
  });
  it("runs from the chosen day to the day before it next month", () => {
    setMonthStartDay(25);
    expect(monthRange(d(2026, 11, 14)).map(ymd)).toEqual(["2026-10-25", "2026-11-25"]);
    expect(monthRange(d(2026, 11, 26)).map(ymd)).toEqual(["2026-11-25", "2026-12-25"]);
    expect(dayOfMonth(d(2026, 11, 14))).toBe(21);
    expect(daysInMonth(d(2026, 11, 14))).toBe(31);
    // Stepping back from late in a month lands in the previous budget month, not two back.
    expect(ymd(addMonths(d(2026, 11, 26), -1))).toBe("2026-10-25");
    expect(monthLabel(d(2026, 11, 14), "en-GB")).toBe("25 Oct – 24 Nov");
  });
  it("works out safe to spend over the budget month", () => {
    setMonthStartDay(25);
    const s = snapshot(31_000_00, 0, 0, d(2026, 11, 24));
    expect(s.daysLeft).toBe(1);
    expect(s.safePerDay).toBe(31_000_00);
  });
  it("has weeks from Monday and calendar years", () => {
    expect(weekRange(d(2026, 11, 14)).map(ymd)).toEqual(["2026-11-09", "2026-11-16"]);
    expect(periodBounds("year", d(2026, 11, 14)).map(ymd)).toEqual(["2026-01-01", "2027-01-01"]);
    expect(periodRange("last-week", d(2026, 11, 14)).map(ymd)).toEqual(["2026-11-02", "2026-11-09"]);
  });
});

describe("calculator", () => {
  it("works out sums typed into amount fields", () => {
    expect(evaluate("250+120")).toBe(370);
    expect(evaluate("1800/4")).toBe(450);
    expect(evaluate("(450 + 60) × 2")).toBe(1020);
    expect(evaluate("3x120-10")).toBe(350);
    expect(evaluate("2*(3")).toBeNull();
    expect(evaluate("5/0")).toBeNull();
    expect(evaluate("alert(1)")).toBeNull();
    expect(parsePaise("250+120")).toBe(37_000);
    expect(parsePaise("₹1,200 + 300")).toBe(150_000);
    expect(parsePaise("100-200")).toBeNull();
    expect(parsePaise("350")).toBe(35_000);
  });
});

describe("credit card statements", () => {
  it("finds the last statement and its due date", () => {
    const c = cardCycle(15, 5, d(2026, 11, 20));
    expect(ymd(c.lastStatement)).toBe("2026-11-15");
    expect(ymd(c.dueDate)).toBe("2026-12-05");
    expect(ymd(c.nextStatement)).toBe("2026-12-15");
    expect(ymd(cardCycle(15, 5, d(2026, 11, 10)).lastStatement)).toBe("2026-10-15");
    expect(ymd(cardCycle(1, 20, d(2026, 11, 10)).dueDate)).toBe("2026-11-20");
    expect(ymd(cardCycle(31, 20, d(2026, 3, 1)).lastStatement)).toBe("2026-02-28");
  });
  it("splits what's owed into the bill and what's spent since", () => {
    const b = cardBill(30_000_00, 4_000_00, 15, 5, d(2026, 11, 20));
    expect(b.due?.amount).toBe(26_000_00);
    expect(ymd(b.due!.date)).toBe("2026-12-05");
    expect(b.unbilled).toBe(4_000_00);
    // Past the due date the bill is taken as paid.
    expect(cardBill(30_000_00, 0, 15, 5, d(2026, 12, 8)).due).toBeNull();
  });
});

describe("repeating bills", () => {
  it("falls due monthly, weekly or yearly", () => {
    expect(ymd(nextDueDate({ day: 5 }, d(2026, 11, 14)))).toBe("2026-12-05");
    expect(ymd(nextDueDate({ every: "week", day: 1, weekday: 5 }, d(2026, 11, 14)))).toBe("2026-11-20");
    expect(ymd(nextDueDate({ every: "year", day: 1, month: 2 }, d(2026, 11, 14)))).toBe("2027-03-01");
    expect(ymd(dueInPeriod({ every: "week", day: 1, weekday: 0 }, d(2026, 11, 14)))).toBe("2026-11-15");
    expect(periodKey({ every: "week", day: 1 }, d(2026, 11, 14))).toBe("w2026-11-09");
    expect(periodKey({ every: "year", day: 1 }, d(2026, 11, 14))).toBe("2026");
    expect(periodKey({ day: 1 }, d(2026, 11, 14))).toBe("2026-11");
    expect(monthlyEquivalent(1_200_00, "year")).toBe(100_00);
  });
});

describe("tags", () => {
  it("reads #tags and keeps them out of the note", () => {
    expect(tagsIn("dinner #Goa #trip #goa")).toEqual(["goa", "trip"]);
    const p = parseExpense("dinner 1800 at toit #goa #work-trip")!;
    expect(p.tags).toEqual(["goa", "work-trip"]);
    expect(p.amount).toBe(180_000);
    expect(p.merchant).toBe("Toit");
  });
  it("groups spending by tag and subcategory", () => {
    const e = (amount: number, tags: string[], sub?: string) =>
      ({ id: String(amount), amount, splitWays: 1, category: "food", tags, sub, merchant: "", note: "", account: "", occurredAt: 1 }) as unknown as Expense;
    const byTag = groupSpending([e(100, ["goa"]), e(200, ["goa", "work"]), e(50, [])], "tag");
    expect(byTag.map((r) => [r.label, r.total])).toEqual([["#goa", 300], ["#work", 200], ["No tag", 50]]);
    const bySub = groupSpending([e(100, [], "Coffee"), e(40, [])], "sub");
    expect(bySub.map((r) => r.label)).toEqual(["Food · Coffee", "Food"]);
  });
});
