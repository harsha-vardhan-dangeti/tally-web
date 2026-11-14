import { afterEach, describe, expect, it } from "vitest";
import { compactMoney, formatMoney, parsePaise, setCurrency } from "./money";
import { dueDate, emiFor, loanStatus, outstandingAfter, outstandingAt, paidCount, type LoanTerms } from "./loans";
import { payLink, people, peopleTotals, readPayLink, splitNames, unpaidTitles, upiIntent, type SplitExpense } from "./people";
import { recapData } from "./recap";

afterEach(() => setCurrency("INR"));

describe("currencies", () => {
  it("formats in the home currency", () => {
    setCurrency("USD");
    expect(formatMoney(12_345_678)).toBe("$123,456");
    expect(formatMoney(1_250, { showPaise: true })).toBe("$12.50");
    expect(compactMoney(250_000_000)).toBe("$2.5M");
    setCurrency("AED");
    expect(formatMoney(4_000)).toBe("AED 40");
  });
  it("formats another currency on request", () => {
    expect(formatMoney(1_200, { currency: "EUR" })).toBe("€12");
    expect(formatMoney(1_200)).toBe("₹12");
  });
  it("falls back to rupees for an unknown code", () => {
    setCurrency("XYZ");
    expect(formatMoney(100)).toBe("₹1");
  });
  it("parses amounts written with any supported currency", () => {
    expect(parsePaise("$12.50")).toBe(1_250);
    expect(parsePaise("AED 40")).toBe(4_000);
    expect(parsePaise("40 usd")).toBe(4_000);
    expect(parsePaise("Rs. 99")).toBe(9_900);
    expect(parsePaise("€1,200")).toBe(120_000);
  });
});

describe("loans", () => {
  // ₹5,00,000 at 10% for 24 months, first EMI on 5 Jan 2026.
  const loan: LoanTerms = { principal: 50_000_000, ratePct: 10, months: 24, emi: 0, firstDueAt: new Date(2026, 0, 5, 12).getTime() };
  loan.emi = emiFor(loan.principal, loan.ratePct, loan.months);

  it("computes the EMI like a bank, rounded up to the rupee", () => {
    expect(loan.emi).toBe(2_307_300); // ₹23,072.46 → ₹23,073
    expect(emiFor(1_200_000, 0, 12)).toBe(100_000);
    expect(emiFor(0, 10, 12)).toBe(0);
  });
  it("puts EMIs on the same day each month, or the month's last day", () => {
    expect(dueDate(loan.firstDueAt, 2).toDateString()).toBe(new Date(2026, 2, 5).toDateString());
    const jan31 = new Date(2026, 0, 31, 12).getTime();
    expect(dueDate(jan31, 1).getDate()).toBe(28);
  });
  it("counts EMIs that have come due, including today's", () => {
    expect(paidCount(loan, new Date(2026, 0, 4).getTime())).toBe(0);
    expect(paidCount(loan, new Date(2026, 0, 5, 8).getTime())).toBe(1);
    expect(paidCount(loan, new Date(2026, 10, 14).getTime())).toBe(11);
    expect(paidCount(loan, new Date(2030, 0, 1).getTime())).toBe(24);
  });
  it("amortises the principal to zero", () => {
    expect(outstandingAfter(loan, 0)).toBe(loan.principal);
    const after12 = outstandingAfter(loan, 12);
    expect(after12).toBeGreaterThan(25_000_000);
    expect(after12).toBeLessThan(27_000_000);
    expect(outstandingAfter(loan, 24)).toBe(0);
  });
  it("summarises where the loan stands", () => {
    const st = loanStatus(loan, new Date(2026, 10, 14).getTime());
    expect(st.paid).toBe(11);
    expect(st.left).toBe(13);
    expect(st.nextDue?.toDateString()).toBe(new Date(2026, 11, 5).toDateString());
    expect(st.endsOn.toDateString()).toBe(new Date(2027, 11, 5).toDateString());
    expect(st.totalInterest).toBe(loan.emi * 24 - loan.principal);
    expect(st.repaid).toBeGreaterThan(0.4);
  });
  it("owes nothing before the loan was taken", () => {
    expect(outstandingAt(loan, new Date(2025, 10, 30).getTime())).toBe(0);
    expect(outstandingAt(loan, new Date(2025, 11, 20).getTime())).toBe(loan.principal);
  });
});

describe("people", () => {
  const base = { merchant: "", note: "", pending: false, paidBy: "" };
  const dinner: SplitExpense = { ...base, id: "e1", amount: 180_000, merchant: "Toit", occurredAt: 3, splitWays: 4, splitWith: "Ravi, priya and Arjun" };
  const cab: SplitExpense = { ...base, id: "e2", amount: 60_000, merchant: "Cab", occurredAt: 5, splitWays: 2, splitWith: "Ravi" };
  const movie: SplitExpense = { ...base, id: "e3", amount: 80_000, merchant: "Movie", occurredAt: 6, splitWays: 2, splitWith: "Priya", paidBy: "Priya" };

  it("splits a names list", () => {
    expect(splitNames("Ravi, priya and Arjun & me")).toEqual(["Ravi", "priya", "Arjun"]);
    expect(splitNames("ravi, Ravi")).toEqual(["ravi"]);
  });
  it("adds up who owes whom from splits and the ledger", () => {
    const list = people([dinner, cab, movie], [
      { id: "l1", person: "Arjun", amount: 200_000, kind: "lent", note: "Rent help", occurredAt: 7 },
      { id: "l2", person: "ravi", amount: -45_000, kind: "settled", note: "", occurredAt: 8 },
    ]);
    const by = Object.fromEntries(list.map((p) => [p.key, p.balance]));
    expect(by.ravi).toBe(45_000 + 30_000 - 45_000);
    expect(by.priya).toBe(45_000 - 40_000);
    expect(by.arjun).toBe(45_000 + 200_000);
    expect(peopleTotals(list)).toEqual({ owedToYou: 30_000 + 5_000 + 245_000, youOwe: 0 });
    expect(unpaidTitles(list.find((p) => p.key === "arjun")!)).toEqual(["Rent help", "Toit"]);
  });
  it("ignores pending and unsplit expenses", () => {
    expect(people([{ ...dinner, pending: true }, { ...cab, splitWays: 1 }], [])).toEqual([]);
  });
  it("records what you owe when someone else paid", () => {
    const [priya] = people([movie], []);
    expect(priya.balance).toBe(-40_000);
    expect(peopleTotals([priya]).youOwe).toBe(40_000);
  });
});

describe("pay links", () => {
  const known = (c: string) => ["INR", "USD"].includes(c);
  it("round-trips a request through the URL fragment", () => {
    const link = payLink("https://tally.example", { to: "Harsha", amount: 45_000, currency: "INR", note: "Dinner at Toit", upi: "harsha@okhdfc" });
    expect(link.startsWith("https://tally.example/pay#")).toBe(true);
    const r = readPayLink(new URL(link).hash, known)!;
    expect(r).toEqual({ to: "Harsha", amount: 45_000, currency: "INR", note: "Dinner at Toit", upi: "harsha@okhdfc" });
    expect(upiIntent(r)).toBe("upi://pay?pa=harsha%40okhdfc&am=450.00&cu=INR&pn=Harsha&tn=Dinner+at+Toit");
  });
  it("rejects bad amounts and drops invalid UPI IDs", () => {
    expect(readPayLink("#amt=-5&cur=INR", known)).toBeNull();
    expect(readPayLink("#amt=500&cur=XYZ", known)).toBeNull();
    expect(readPayLink("#amt=500&cur=INR&upi=javascript:alert(1)", known)?.upi).toBe("");
  });
  it("offers UPI only for rupees", () => {
    expect(upiIntent({ to: "", amount: 100, currency: "USD", note: "", upi: "a@b" })).toBeNull();
  });
});

describe("recap", () => {
  it("adds up a month, folding small categories into Other", () => {
    const at = (d: number) => new Date(2026, 9, d, 12).getTime();
    const e = (amount: number, category: string, d: number, extra = {}) =>
      ({ amount, category, occurredAt: at(d), splitWays: 1, pending: false, exclude: false, ...extra });
    const r = recapData([
      e(50_000, "food", 1), e(30_000, "transport", 2), e(10_000, "fun", 2), e(5_000, "health", 3), e(3_000, "shopping", 4), e(2_000, "bills", 4),
      e(99_999, "food", 5, { pending: true }), e(10_000, "food", 6, { splitWays: 2 }),
    ], new Date(2026, 9, 15), 200_000, new Date(2026, 10, 2));
    expect(r.complete).toBe(true);
    expect(r.days).toBe(31);
    expect(r.spent).toBe(105_000);
    expect(r.count).toBe(7);
    expect(r.top.map((c) => c.id)).toEqual(["food", "transport", "fun", "health", "other"]);
    expect(r.top[4].amount).toBe(5_000);
    expect(r.noSpendDays).toBe(31 - 5);
  });
  it("counts only the days so far in the current month", () => {
    const r = recapData([], new Date(2026, 10, 1), 0, new Date(2026, 10, 14, 9));
    expect(r.complete).toBe(false);
    expect(r.days).toBe(14);
    expect(r.noSpendDays).toBe(14);
  });
});
