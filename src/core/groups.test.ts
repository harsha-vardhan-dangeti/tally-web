import { describe, expect, it } from "vitest";
import { groupStanding, memberNames, planGroupBill, unequalShares } from "./groups";
import { people } from "./people";
import { myShareOf } from "./smartParser";
import { readGroups, readShares } from "../data/backup";
import { keepShares, type Expense } from "../data/store";

const exp = (o: Partial<{ id: string; amount: number; splitWays: number; splitWith: string; paidBy: string; group: string }>) => ({
  id: "e", amount: 0, merchant: "Bill", note: "", occurredAt: 1, pending: false, splitWays: 1, splitWith: "", ...o,
});

describe("group bills", () => {
  it("you paid and you're in it: one split expense", () => {
    expect(planGroupBill(900_00, "", ["", "Ravi", "Priya"])).toEqual({ kind: "expense", splitWays: 3, splitWith: "Ravi, Priya", yourShare: 300_00, each: 300_00 });
  });
  it("someone else paid and you're in it: you owe them your share", () => {
    expect(planGroupBill(1200_00, "Ravi", ["", "Ravi", "Priya", "Arjun"])).toMatchObject({ kind: "expense", splitWays: 4, paidBy: "Ravi", yourShare: 300_00 });
  });
  it("someone else paid all of it for you: your expense, and you owe them all of it", () => {
    const plan = planGroupBill(500_00, "Ravi", [""]);
    expect(plan).toEqual({ kind: "expense", splitWays: 1, splitWith: "", paidBy: "Ravi", yourShare: 500_00, each: 500_00 });
    // The same when typed as amounts: you 500, nobody else.
    expect(planGroupBill(500_00, "Ravi", [], [{ person: "", amount: 500_00 }])).toMatchObject({ kind: "expense", splitWays: 1, paidBy: "Ravi" });
    const bill = exp({ id: "all", amount: 500_00, splitWays: 1, paidBy: "Ravi", group: "g1" });
    expect(myShareOf(bill)).toBe(500_00);
    expect(people([bill], []).find((p) => p.name === "Ravi")?.balance).toBe(-500_00);
    expect(groupStanding({ id: "g1", members: ["Ravi"] }, [bill], []).youOwe).toBe(500_00);
  });
  it("you paid for others only: lent to each, adding up exactly", () => {
    const plan = planGroupBill(100_01, "", ["Ravi", "Priya"]);
    expect(plan).toEqual({ kind: "lent", each: 50_00, entries: [{ person: "Ravi", amount: 50_01 }, { person: "Priya", amount: 50_00 }] });
  });
  it("a bill between others, or nobody chosen, changes nothing for you", () => {
    expect(planGroupBill(500_00, "Ravi", ["Ravi", "Priya"]).kind).toBe("none");
    expect(planGroupBill(500_00, "", []).kind).toBe("none");
    expect(planGroupBill(0, "", ["", "Ravi"]).kind).toBe("none");
  });

  it("each member's balance in the group, separate from other groups", () => {
    const g = { id: "g1", members: ["Ravi", "Priya"] };
    const expenses = [
      exp({ id: "a", amount: 900_00, splitWays: 3, splitWith: "Ravi, Priya", group: "g1" }), // each owes you 300
      exp({ id: "b", amount: 600_00, splitWays: 3, splitWith: "Priya", paidBy: "Ravi", group: "g1" }), // you owe Ravi 200
      exp({ id: "c", amount: 1000_00, splitWays: 2, splitWith: "Ravi", group: "other" }), // another group
    ];
    const ledger = [{ id: "l", person: "Priya", amount: -100_00, kind: "settled" as const, note: "", occurredAt: 2, group: "g1" }];
    const st = groupStanding(g, expenses, ledger);
    expect(st.members.map((m) => [m.name, m.balance])).toEqual([["Ravi", 100_00], ["Priya", 200_00]]);
    expect(st.net).toBe(300_00);
  });

  it("reads member lists and backed-up groups safely", () => {
    expect(memberNames("Ravi, priya and Arjun\nravi")).toEqual(["Ravi", "priya", "Arjun"]);
    expect(readGroups([{ id: "g", name: " Flat ", members: ["Ravi", "ravi", 3, " Priya "], createdAt: 5 }, { id: "", name: "x" }, "junk"]))
      .toEqual([{ id: "g", name: "Flat", members: ["Ravi", "Priya"], createdAt: 5 }]);
  });

  describe("unequal splits", () => {
    it("exact amounts: what's left to assign, and over", () => {
      expect(unequalShares(1000_00, "exact", [{ person: "", value: 600_00 }, { person: "Ravi", value: 300_00 }]).left).toBe(100_00);
      expect(unequalShares(1000_00, "exact", [{ person: "", value: 600_00 }, { person: "Ravi", value: 500_00 }]).left).toBe(-100_00);
    });
    it("percentages add up to the paisa", () => {
      const r = unequalShares(100_00, "percent", [{ person: "", value: 33.33 }, { person: "Ravi", value: 33.33 }, { person: "Priya", value: 33.34 }]);
      expect(r.left).toBe(0);
      expect(r.shares.reduce((t, x) => t + x.amount, 0)).toBe(100_00);
      expect(unequalShares(100_00, "percent", [{ person: "", value: 50 }]).left).toBe(50);
    });

    it("you paid: each person owes their own amount, and only yours is spending", () => {
      const plan = planGroupBill(1000_00, "", [], [{ person: "", amount: 500_00 }, { person: "Ravi", amount: 300_00 }, { person: "Priya", amount: 200_00 }]);
      expect(plan).toMatchObject({ kind: "expense", splitWays: 3, splitWith: "Ravi, Priya", myShare: 500_00, shares: { Ravi: 300_00, Priya: 200_00 } });
      if (plan.kind !== "expense") throw new Error();
      const e = exp({ id: "u", amount: 1000_00, splitWays: plan.splitWays, splitWith: plan.splitWith, group: "g1" });
      const bill = { ...e, myShare: plan.myShare, shares: plan.shares };
      expect(myShareOf(bill)).toBe(500_00);
      expect(people([bill], []).map((p) => [p.name, p.balance])).toEqual([["Ravi", 300_00], ["Priya", 200_00]]);
    });
    it("someone else paid: you owe them your amount", () => {
      const plan = planGroupBill(900_00, "Ravi", [], [{ person: "", amount: 100_00 }, { person: "Ravi", amount: 800_00 }]);
      if (plan.kind !== "expense") throw new Error();
      const bill = { ...exp({ id: "v", amount: 900_00, splitWays: plan.splitWays, splitWith: plan.splitWith, paidBy: "Ravi" }), myShare: plan.myShare, shares: plan.shares };
      expect(people([bill], [])[0].balance).toBe(-100_00);
    });
    it("you paid for others only, or a bill without you", () => {
      expect(planGroupBill(500_00, "", [], [{ person: "Ravi", amount: 400_00 }, { person: "Priya", amount: 100_00 }]))
        .toEqual({ kind: "lent", each: 0, entries: [{ person: "Ravi", amount: 400_00 }, { person: "Priya", amount: 100_00 }] });
      expect(planGroupBill(500_00, "Ravi", [], [{ person: "Priya", amount: 500_00 }]).kind).toBe("none");
    });

    it("stays consistent when the bill is edited", () => {
      const e = { id: "w", amount: 1000_00, splitWays: 3, splitWith: "Ravi, Priya", myShare: 500_00, shares: { Ravi: 300_00, Priya: 200_00 } } as unknown as Expense;
      expect(keepShares(e, { ...e, amount: 2000_00 })).toMatchObject({ myShare: 1000_00, shares: { Ravi: 600_00, Priya: 400_00 } });
      expect(keepShares(e, { ...e, splitWays: 4 }).shares).toBeUndefined();
      expect(keepShares(e, { ...e, splitWays: 1 }).myShare).toBeUndefined();
      expect(keepShares(e, { ...e, note: "x" })).toMatchObject({ myShare: 500_00 });
    });
    it("reads backed-up shares only when they fit the amount", () => {
      expect(readShares(500, { Ravi: 300, " ": 5, Priya: -1 }, 1000)).toEqual({ myShare: 500, shares: { Ravi: 300 } });
      expect(readShares(900, { Ravi: 300 }, 1000)).toEqual({});
      expect(readShares(undefined, { Ravi: 300 }, 1000)).toEqual({});
    });
  });
});
