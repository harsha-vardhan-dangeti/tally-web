import { describe, expect, it } from "vitest";
import {
  findTable, guessBank, looksLikeTransfer, matchExisting, nameFromNarration, parseCsv, parseStatementAmount, parseStatementDate, readTransactions,
} from "./statement";

const read = (csv: string) => {
  const rows = parseCsv(csv);
  const table = findTable(rows);
  if (!table) throw new Error("no table");
  return { rows, table, txns: readTransactions(rows, table) };
};

// Layouts as each bank's net banking exports them (values made up).
const HDFC = `HDFC BANK Ltd.,,,,,,
Statement of account,,,,,,
Account No :,50100123456789,,,,,
,,,,,,
Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/10/26,UPI-SWIGGY-SWIGGY@YBL-YESB0YBLUPI-429812345678-PAYMENT FROM PHONE,0000429812345678,01/10/26,450.00,,"1,04,550.00"
01/10/26,SALARY OCT 2026 ACME TECH PVT LTD,NEFT12345,01/10/26,,"1,20,000.00","2,24,550.00"
03/10/26,POS 512345XXXXXX1234 AMAZON PAY IN,0000000001,03/10/26,"2,399.00",,"2,22,151.00"
,,,,,,
,,STATEMENT SUMMARY,,,,
Opening Balance,Dr Count,Cr Count,Debits,Credits,Closing Bal,
"1,05,000.00",2,1,"2,849.00","1,20,000.00","2,22,151.00",`;

const ICICI = `DETAILED STATEMENT,,,,,,,
Transactions List - ICICI Bank,,,,,,,
S No.,Value Date,Transaction Date,Cheque Number,Transaction Remarks,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )
1,02/10/2026,02/10/2026,-,UPI/DR/428911223344/UBER INDIA/HDFC/uber.rides@hdfcbank/Ride,312.50,0.00,"45,687.50"
2,04/10/2026,04/10/2026,-,UPI/CR/428955667788/ARJUN KUMAR/SBIN/arjun@oksbi/split,0.00,175.00,"45,862.50"`;

const SBI = `Account Name :,MR HARSHA,,,,,
Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance
5 Oct 2026,5 Oct 2026,TO TRANSFER-UPI/DR/412345678901/BLINKIT/YESB/blinkit@ybl/Grocery--,TRANSFER TO 4897691162091,"1,240.00",,"88,760.00"
9 Oct 2026,9 Oct 2026,BY TRANSFER-INB INTEREST CREDIT--,,,"312.00","89,072.00"`;

const AXIS = `Tran Date,CHQNO,PARTICULARS,DR,CR,BAL,SOL
12-10-2026,,ACH-DR-NETFLIX-ENTERTAINMENT,649.00,,48000.00,1234
12-10-2026,,ACH-DR-NETFLIX-ENTERTAINMENT,649.00,,47351.00,1234`;

const AMOUNT_DRCR = `Date\tDescription\tAmount\tDr / Cr\tBalance
15/10/2026\tATM WDL KORAMANGALA\t2000.00\tDR\t45351.00
16/10/2026\tREFUND FLIPKART ORDER\t899.00\tCR\t46250.00`;

describe("reading statement layouts", () => {
  it("HDFC: skips the header block and summary, reads withdrawals and deposits", () => {
    const { rows, table, txns } = read(HDFC);
    expect(table.headers[0]).toBe("Date");
    expect(guessBank(rows, table.headerRow)).toBe("HDFC Bank");
    expect(txns.map((t) => [t.direction, t.amount, t.name])).toEqual([
      ["debit", 45_000, "Swiggy"],
      ["credit", 12_000_000, "Salary Oct Acme Tech Pvt Ltd"],
      ["debit", 239_900, "Amazon Pay In"],
    ]);
    expect(txns[0].category).toBe("food");
    expect(txns[1].incomeSource).toBe("Salary");
    expect(txns[2].date.getDate()).toBe(3);
  });

  it("ICICI: prefers the transaction date and reads UPI names", () => {
    const { table, txns } = read(ICICI);
    expect(table.columns.date).toBe(2);
    expect(txns.map((t) => [t.direction, t.amount, t.name, t.category])).toEqual([
      ["debit", 31_250, "Uber India", "transport"],
      ["credit", 17_500, "Arjun Kumar", "other"],
    ]);
  });

  it("SBI: reads 5 Oct 2026 style dates and spots interest", () => {
    const { txns } = read(SBI);
    expect(txns.map((t) => [t.date.getMonth(), t.date.getDate(), t.direction, t.amount])).toEqual([[9, 5, "debit", 124_000], [9, 9, "credit", 31_200]]);
    expect(txns[0].name).toBe("Blinkit");
    expect(txns[0].category).toBe("groceries");
    expect(txns[1].incomeSource).toBe("Interest");
  });

  it("Axis: keeps two identical rows as two transactions with different IDs", () => {
    const { txns } = read(AXIS);
    expect(txns).toHaveLength(2);
    expect(txns[0].id).not.toBe(txns[1].id);
    expect(txns[0].name).toBe("Netflix");
    expect(txns[0].category).toBe("fun");
  });

  it("one Amount column with a Dr/Cr column, tab-separated", () => {
    const { txns } = read(AMOUNT_DRCR);
    expect(txns.map((t) => [t.direction, t.amount])).toEqual([["debit", 200_000], ["credit", 89_900]]);
    expect(txns[1].incomeSource).toBe("Refund");
  });

  it("gives the same IDs when the same statement is read again", () => {
    expect(read(HDFC).txns.map((t) => t.id)).toEqual(read(HDFC).txns.map((t) => t.id));
  });

  it("returns null for files that aren't statements", () => {
    expect(findTable(parseCsv("name,age\nasha,30"))).toBeNull();
  });
});

describe("values", () => {
  it("parses Indian amounts and markers", () => {
    expect(parseStatementAmount("1,23,456.78")).toEqual({ paise: 12_345_678, marker: null });
    expect(parseStatementAmount("₹ 450.00 Dr")).toEqual({ paise: 45_000, marker: "dr" });
    expect(parseStatementAmount("(450.00)")?.paise).toBe(-45_000);
    expect(parseStatementAmount("-")).toBeNull();
    expect(parseStatementAmount("")).toBeNull();
  });

  it("parses day-first dates and rejects impossible ones", () => {
    expect(parseStatementDate("05/10/26")?.toDateString()).toBe(new Date(2026, 9, 5).toDateString());
    expect(parseStatementDate("05-Oct-2026")?.getMonth()).toBe(9);
    expect(parseStatementDate("2026-10-05")?.getDate()).toBe(5);
    expect(parseStatementDate("31/02/2026")).toBeNull();
    expect(parseStatementDate("Opening Balance")).toBeNull();
  });

  it("pulls readable names out of narrations", () => {
    expect(nameFromNarration("UPI/DR/123456789012/ZOMATO LTD/ICIC/zomato@icici/Food")).toBe("Zomato Ltd");
    expect(nameFromNarration("NEFT/N123456789/RAHUL SHARMA")).toBe("Rahul Sharma");
    expect(nameFromNarration("swiggy@ybl")).toBe("Swiggy");
    expect(nameFromNarration("BIL/ONL/000123/HDFC CREDIT CARD/PAYMENT")).toBe("Hdfc Credit Card");
  });
});

describe("matchExisting", () => {
  it("skips rows imported before and unticks likely hand-logged ones", () => {
    const { txns } = read(HDFC);
    const swiggy = txns[0], amazon = txns[2];
    const result = matchExisting(
      txns,
      [
        { id: "manual-1", amount: 45_000, at: swiggy.date.getTime() + 3600_000 }, // logged by hand the same day
        { id: amazon.id, amount: amazon.amount, at: amazon.date.getTime() },        // imported last time
      ],
      [],
    );
    expect(result.get(swiggy.id)).toBe("maybe-logged");
    expect(result.get(amazon.id)).toBe("imported");
    expect(result.has(txns[1].id)).toBe(false);
  });
});

describe("looksLikeTransfer", () => {
  const t = (description: string) => ({ id: "x", date: new Date(), description, name: "", amount: 1, direction: "debit" as const, category: "other" as const, incomeSource: "" });
  it("flags card bills, own-account moves and investments, not ordinary spends", () => {
    expect(looksLikeTransfer(t("BIL/ONL/000123/HDFC CREDIT CARD/PAYMENT"))).toBe(true);
    expect(looksLikeTransfer(t("IMPS/SELF/TRANSFER TO OWN A/C"))).toBe(true);
    expect(looksLikeTransfer(t("ACH-DR-ICICI PRU MUTUAL FUND SIP"))).toBe(true);
    expect(looksLikeTransfer(t("UPI-SWIGGY-SWIGGY@YBL-PAYMENT"))).toBe(false);
  });
});
