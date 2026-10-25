import { describe, expect, it } from "vitest";
import { addTransfer, deleteTransfer, getState, moneyIn, saveAccount, type Account } from "./store";

const account = (over: Partial<Account>): Account => ({ id: "a", name: "HDFC", kind: "bank", balance: 0, order: 0, updatedAt: 0, ...over });
const balance = (id: string) => getState().accounts.find((a) => a.id === id)!.balance;

describe("transfers", () => {
  it("moves money in and out of each kind of account", () => {
    expect(moneyIn(account({ balance: 10_000 }), 2_500).balance).toBe(12_500);
    expect(moneyIn(account({ balance: 10_000 }), -2_500).balance).toBe(7_500);
    // A card's balance is what's owed: paying it lowers the debt, a cash withdrawal raises it.
    expect(moneyIn(account({ kind: "card", balance: 10_000 }), 2_500).balance).toBe(7_500);
    expect(moneyIn(account({ kind: "card", balance: 10_000 }), -2_500).balance).toBe(12_500);
  });

  it("pays a card from the bank, and removing it puts both back", () => {
    saveAccount(account({ id: "bank", balance: 5_000_000 }));
    saveAccount(account({ id: "card", name: "Card", kind: "card", balance: 800_000 }));
    const t = addTransfer({ fromId: "bank", toId: "card", amount: 500_000, note: "Card bill", occurredAt: Date.now() })!;
    expect(balance("bank")).toBe(4_500_000);
    expect(balance("card")).toBe(300_000);
    expect(getState().transfers[0]).toMatchObject({ fromName: "HDFC", toName: "Card", amount: 500_000 });

    deleteTransfer(t.id, false);
    expect(balance("bank")).toBe(5_000_000);
    expect(balance("card")).toBe(800_000);
    expect(getState().transfers.find((x) => x.id === t.id)).toBeUndefined();
  });

  it("refuses a transfer to the same account or of nothing", () => {
    saveAccount(account({ id: "cash", name: "Cash", kind: "cash", balance: 100 }));
    expect(addTransfer({ fromId: "cash", toId: "cash", amount: 50, note: "", occurredAt: 1 })).toBeNull();
    expect(addTransfer({ fromId: "cash", toId: "bank", amount: 0, note: "", occurredAt: 1 })).toBeNull();
    expect(balance("cash")).toBe(100);
  });
});
