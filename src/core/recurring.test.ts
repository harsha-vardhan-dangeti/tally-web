import { describe, expect, it } from "vitest";
import { detectRecurring, merchantKey, type ChargeLike } from "./recurring";

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10).getTime();
let n = 0;
const charge = (name: string, amount: number, at: number): ChargeLike => ({ id: `e${n++}`, name, amount, occurredAt: at, category: "fun", account: "Card" });

describe("subscription detection", () => {
  const now = day(2026, 10, 20);

  it("finds a monthly charge and when it's due next", () => {
    const found = detectRecurring([
      charge("NETFLIX.COM", 64_900, day(2026, 7, 5)), charge("Netflix", 64_900, day(2026, 8, 5)),
      charge("netflix 4412", 64_900, day(2026, 9, 6)), charge("Netflix", 64_900, day(2026, 10, 5)),
    ], { now });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: "netflix", cadence: "monthly", amount: 64_900, count: 4, day: 5, maybeStopped: false, previousAmount: null });
    expect(new Date(found[0].nextAt).getMonth()).toBe(10); // November
  });

  it("notices a price rise and normalises weekly and yearly costs to a month", () => {
    const found = detectRecurring([
      charge("Spotify", 11_900, day(2026, 7, 1)), charge("Spotify", 11_900, day(2026, 8, 1)), charge("Spotify", 13_900, day(2026, 9, 1)),
      charge("Milk man", 50_000, day(2026, 9, 1)), charge("Milk man", 50_000, day(2026, 9, 8)), charge("Milk man", 50_000, day(2026, 9, 15)),
      charge("Milk man", 50_000, day(2026, 9, 22)),
      charge("Amazon Prime", 149_900, day(2024, 10, 10)), charge("Amazon Prime", 149_900, day(2025, 10, 10)), charge("Amazon Prime", 149_900, day(2026, 10, 9)),
    ], { now });
    const by = Object.fromEntries(found.map((f) => [f.key, f]));
    expect(by.spotify).toMatchObject({ amount: 13_900, previousAmount: 11_900 });
    expect(by["milk man"]).toMatchObject({ cadence: "weekly", monthlyCost: Math.round(50_000 * 52 / 12), maybeStopped: true });
    expect(by["amazon prime"]).toMatchObject({ cadence: "yearly", monthlyCost: Math.round(149_900 / 12) });
  });

  it("ignores one-offs, irregular spending, dismissed merchants and same-day repeats", () => {
    const found = detectRecurring([
      charge("Swiggy", 35_000, day(2026, 9, 1)), charge("Swiggy", 12_000, day(2026, 9, 3)), charge("Swiggy", 80_000, day(2026, 9, 20)),
      charge("Gym", 150_000, day(2026, 8, 1)), charge("Gym", 150_000, day(2026, 9, 1)), charge("Gym", 150_000, day(2026, 10, 1)),
      charge("Chai", 2_000, day(2026, 10, 1)), charge("Chai", 2_000, day(2026, 10, 1)),
      charge("Laptop", 7_000_000, day(2026, 3, 1)),
      // A weekly grocery run is steady but the bill changes every time: not a subscription.
      charge("DMart", 210_000, day(2026, 9, 3)), charge("DMart", 230_000, day(2026, 9, 10)), charge("DMart", 220_000, day(2026, 9, 17)),
      charge("DMart", 240_000, day(2026, 9, 24)), charge("DMart", 200_000, day(2026, 10, 1)),
    ], { now, ignore: ["gym"] });
    expect(found).toEqual([]);
  });

  it("needs only two charges when they're identical and a month apart", () => {
    expect(detectRecurring([charge("Jio", 29_900, day(2026, 8, 12)), charge("Jio", 29_900, day(2026, 9, 12))], { now })).toHaveLength(1);
    expect(detectRecurring([charge("Jio", 29_900, day(2026, 8, 12)), charge("Jio", 31_900, day(2026, 9, 12))], { now })).toHaveLength(0);
  });

  it("treats spellings of one merchant as the same", () => {
    expect(merchantKey("NETFLIX.COM")).toBe(merchantKey("Netflix 4412"));
    expect(merchantKey("Swiggy Pvt Ltd")).toBe("swiggy");
  });
});
