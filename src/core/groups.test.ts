import { describe, expect, it } from "vitest";
import { groupStanding, memberNames, planGroupBill } from "./groups";
import { readGroups } from "../data/backup";

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
});
