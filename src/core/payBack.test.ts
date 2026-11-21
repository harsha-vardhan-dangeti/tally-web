import { describe, expect, it } from "vitest";
import { payBackProgress, people, type LedgerLine } from "./people";

const day = (d: number) => new Date(2026, 10, d, 12).getTime();
const line = (id: string, amount: number, kind: LedgerLine["kind"], d: number, person = "Ravi"): LedgerLine =>
  ({ id, person, amount, kind, note: "", occurredAt: day(d) });
const item = (ledger: LedgerLine[], id: string, person = "Ravi") =>
  people([], ledger).find((p) => p.name === person)!.items.find((i) => i.entryId === id)!;

describe("paying back part of a loan", () => {
  it("takes a partial pay-back off the oldest loan first", () => {
    const ledger = [line("l1", 5_000_00, "lent", 1), line("l2", 1_000_00, "lent", 3), line("p1", -2_000_00, "settled", 5)];
    expect(people([], ledger)[0].balance).toBe(4_000_00);
    expect(payBackProgress(item(ledger, "l1"))).toEqual({ owed: 5_000_00, paid: 2_000_00, left: 3_000_00 });
    expect(payBackProgress(item(ledger, "l2"))).toEqual({ owed: 1_000_00, paid: 0, left: 1_000_00 });
    // The pay-back itself only cleared older loans.
    expect(payBackProgress(item(ledger, "p1"))).toBeNull();

    // A second pay-back clears the first loan and part of the second.
    ledger.push(line("p2", -3_500_00, "settled", 8));
    expect(payBackProgress(item(ledger, "l1"))?.left).toBe(0);
    expect(payBackProgress(item(ledger, "l2"))).toEqual({ owed: 1_000_00, paid: 500_00, left: 500_00 });
  });

  it("works the other way for money you borrowed and pay back", () => {
    const ledger = [line("b1", -4_000_00, "borrowed", 2, "Meera"), line("r1", 1_500_00, "settled", 6, "Meera")];
    const meera = people([], ledger)[0];
    expect(meera.balance).toBe(-2_500_00);
    expect(payBackProgress(item(ledger, "b1", "Meera"))).toEqual({ owed: 4_000_00, paid: 1_500_00, left: 2_500_00 });
  });

  it("turns a pay-back that's more than what was owed into money owed the other way", () => {
    const ledger = [line("l1", 1_000_00, "lent", 1), line("p1", -1_500_00, "settled", 2)];
    expect(people([], ledger)[0].balance).toBe(-500_00);
    expect(payBackProgress(item(ledger, "l1"))?.left).toBe(0);
    expect(payBackProgress(item(ledger, "p1"))).toEqual({ owed: 500_00, paid: 0, left: 500_00 });
  });
});
