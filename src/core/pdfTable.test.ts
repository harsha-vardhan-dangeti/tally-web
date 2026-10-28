import { describe, expect, it } from "vitest";
import { pdfRows, type TextItem } from "./pdfTable";
import { findTable, readTransactions } from "./statement";

/** Words laid out like an HDFC-style PDF statement page. */
const word = (str: string, x: number, y: number, page = 1): TextItem => ({ str, x, y, w: str.length * 4.5, page });
const header = (y: number, page = 1) => [
  word("Date", 20, y, page), word("Narration", 70, y, page), word("Chq./Ref.No.", 260, y, page),
  word("Withdrawal Amt.", 360, y, page), word("Deposit Amt.", 440, y, page), word("Closing Balance", 510, y, page),
];

describe("PDF statements", () => {
  it("rebuilds the table from word positions, joining wrapped narrations and skipping repeated headers", () => {
    const items = [
      word("HDFC BANK Ltd.", 20, 30), word("Statement of account", 20, 45),
      ...header(100),
      word("05/10/26", 20, 120), word("UPI-SWIGGY-swiggy@ybl-", 70, 120), word("0000123", 262, 120), word("350.00", 395, 120), word("9,650.00", 530, 120),
      word("FOOD ORDER", 70, 131),
      word("06/10/26", 20, 150), word("NEFT CR-ACME CORP SALARY", 70, 150), word("N12345", 262, 150), word("50,000.00", 455, 150), word("59,650.00", 525, 150),
      word("Page 1 of 2", 260, 780),
      ...header(40, 2),
      word("07/10/26", 20, 60, 2), word("POS 512345XXXXXX1234 DMART", 70, 60, 2), word("1,240.50", 390, 60, 2), word("58,409.50", 525, 60, 2),
    ];
    const rows = pdfRows(items);
    const table = findTable(rows)!;
    expect(table).not.toBeNull();
    const txns = readTransactions(rows, table);
    expect(txns.map((t) => [t.date.getDate(), t.direction, t.amount])).toEqual([[5, "debit", 35_000], [6, "credit", 5_000_000], [7, "debit", 124_050]]);
    expect(txns[0].description).toBe("UPI-SWIGGY-swiggy@ybl- FOOD ORDER");
    expect(txns[2].name).toBe("Dmart");
    expect(rows.slice(0, 2).flat().join(" ")).toContain("HDFC BANK");
  });

  it("returns plain lines when there's no transaction table", () => {
    expect(pdfRows([word("Hello", 10, 10), word("world", 40, 10)])).toEqual([["Hello world"]]);
  });
});
