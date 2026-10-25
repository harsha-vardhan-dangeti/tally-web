import { useMemo, useRef, useState } from "react";
import {
  findTable, guessBank, looksLikeTransfer, matchExisting, parseCsv, readTransactions,
  type ColumnMap, type StatementTable, type StatementTxn,
} from "../core/statement";
import { categoryMeta, pickableCategories, type Category } from "../core/categories";
import { formatMoney } from "../core/money";
import { importTransactions, removeImported, showToast, useTally, type Expense, type Income } from "../data/store";
import { Icon } from "../ui/icons";
import { Empty, Field, Sheet } from "../ui/components";

/** Reads a CSV or Excel statement into rows of text. Excel support loads only when it's needed. */
async function readRows(file: File): Promise<string[][]> {
  if (!/\.(xlsx|xls|xlsm|ods)$/i.test(file.name)) return parseCsv(await file.text());
  const XLSX = await import("xlsx");
  const book = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const cell = (v: unknown) => {
    if (v instanceof Date) {
      // Written day-first, as the statement parser expects, whatever the spreadsheet's display format.
      return `${v.getDate()}/${v.getMonth() + 1}/${v.getFullYear()}`;
    }
    return String(v ?? "").trim();
  };
  let best: string[][] = [];
  for (const name of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: true, defval: "", blankrows: false })
      .map((r) => r.map(cell)).filter((r) => r.some((c) => c !== ""));
    if (rows.length > best.length) best = rows;
  }
  return best;
}

type Filter = "all" | "debit" | "credit";
const COLUMN_LABELS: [keyof ColumnMap, string][] = [
  ["date", "Date"], ["description", "Description"], ["debit", "Withdrawal"], ["credit", "Deposit"], ["amount", "Amount"], ["type", "Dr / Cr"],
];

/** Settings → Import bank statement: pick a file, review what was found, add the ticked rows. */
export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useTally();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [table, setTable] = useState<StatementTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState("Bank");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Record<string, Category>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [seen, setSeen] = useState(false);
  if (open !== seen) {
    setSeen(open);
    if (open) { setFileName(""); setRows([]); setTable(null); setError(null); setFilter("all"); }
  }

  const txns = useMemo(() => (table ? readTransactions(rows, table) : []), [rows, table]);
  const status = useMemo(() => matchExisting(
    txns,
    s.expenses.map((e) => ({ id: e.id, amount: e.amount, at: e.occurredAt })),
    s.incomes.map((x) => ({ id: x.id, amount: x.amount, at: x.receivedAt })),
  ), [txns]); // eslint-disable-line react-hooks/exhaustive-deps -- matched once per file, not as rows get added
  const fresh = txns.filter((t) => status.get(t.id) !== "imported");
  const alreadyImported = txns.length - fresh.length;

  const choose = async (file: File) => {
    setBusy(true);
    setError(null);
    // Don't leave the previous file's rows on screen while this one is read.
    setTable(null);
    setRows([]);
    try {
      const r = await readRows(file);
      const t = findTable(r);
      setFileName(file.name);
      setRows(r);
      setTable(t);
      if (!t) {
        setError("Couldn't find the transactions in this file. Download the statement from net banking as CSV or Excel (often called \"Detailed statement\"), then try again.");
        return;
      }
      setAccount(guessBank(r, t.headerRow) ?? "Bank");
      const txs = readTransactions(r, t);
      const st = matchExisting(txs,
        s.expenses.map((e) => ({ id: e.id, amount: e.amount, at: e.occurredAt })),
        s.incomes.map((x) => ({ id: x.id, amount: x.amount, at: x.receivedAt })));
      // Ticked to start with: everything new, except likely duplicates of hand-logged entries and transfers.
      setPicked(new Set(txs.filter((x) => !st.has(x.id) && !looksLikeTransfer(x)).map((x) => x.id)));
      setCategories({});
    } catch (e) {
      const msg = (e as Error).message ?? "";
      setError(/password|encrypt/i.test(msg)
        ? "This file is password-protected. Open it in Excel, save a copy without the password, then import that copy."
        : "Couldn't read this file. Import a CSV or Excel statement downloaded from net banking.");
    } finally {
      setBusy(false);
    }
  };

  const setColumn = (key: keyof ColumnMap, value: string) => {
    if (!table) return;
    const v = value === "" ? null : Number(value);
    setTable({ ...table, columns: { ...table.columns, [key]: key === "date" || key === "description" ? (v ?? table.columns[key]) : v } });
  };

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const shown = fresh.filter((t) => filter === "all" || t.direction === filter);
  const chosen = fresh.filter((t) => picked.has(t.id));
  const outCount = chosen.filter((t) => t.direction === "debit").length;
  const inCount = chosen.length - outCount;
  const outTotal = chosen.filter((t) => t.direction === "debit").reduce((sum, t) => sum + t.amount, 0);
  const inTotal = chosen.filter((t) => t.direction === "credit").reduce((sum, t) => sum + t.amount, 0);

  const add = async () => {
    const now = Date.now();
    const acct = account.trim() || "Bank";
    const expenses: Expense[] = chosen.filter((t) => t.direction === "debit").map((t) => ({
      id: t.id, amount: t.amount, merchant: t.name, note: t.description, category: categories[t.id] ?? t.category, account: acct,
      occurredAt: t.date.getTime(), createdAt: now, source: "import", pending: false, splitWays: 1, splitWith: "", exclude: false, recurring: false,
    }));
    const incomes: Income[] = chosen.filter((t) => t.direction === "credit").map((t) => ({
      id: t.id, amount: t.amount, source: t.incomeSource, note: t.description, account: acct, receivedAt: t.date.getTime(), createdAt: now,
    }));
    setBusy(true);
    await importTransactions(expenses, incomes);
    setBusy(false);
    onClose();
    const parts = [expenses.length && `${expenses.length} expense${expenses.length === 1 ? "" : "s"}`, incomes.length && `${incomes.length} income`].filter(Boolean);
    showToast(`Added ${parts.join(" and ")} from ${fileName}`, () => removeImported(expenses.map((e) => e.id), incomes.map((x) => x.id)));
  };

  const day = (d: Date) => d.toLocaleDateString([], { day: "numeric", month: "short" });

  return (
    <Sheet open={open} onClose={onClose} title="Import bank statement">
      {!table && (
        <div className="col gap12">
          <p className="t-muted small" style={{ margin: 0 }}>
            Download your statement from net banking as <b>CSV</b> or <b>Excel</b>, then choose it here. It's read in this
            browser; you check every transaction before anything is added. Rows you imported before are skipped automatically.
          </p>
          <button className="btn primary block" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={18} />{busy ? "Reading…" : "Choose statement file"}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt,.xls,.xlsx,.xlsm,.ods,text/csv" hidden
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void choose(f); }} />
          <p className="t-muted tiny" style={{ margin: 0 }}>PDF statements aren't supported yet. Most banks offer CSV or Excel next to PDF.</p>
        </div>
      )}
      {error && <p className="small" style={{ margin: 0, color: "var(--danger)" }} role="alert">{error}</p>}

      {table && (
        <>
          <div className="import-file row gap8">
            <Icon name="download" size={18} />
            <span className="grow ellipsis t-strong small">{fileName}</span>
            <button className="btn ghost" onClick={() => fileRef.current?.click()}>Choose another</button>
            <input ref={fileRef} type="file" accept=".csv,.txt,.xls,.xlsx,.xlsm,.ods,text/csv" hidden
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void choose(f); }} />
          </div>

          <Field label="Account these came from">
            <input type="text" value={account} onChange={(e) => setAccount(e.target.value)} />
          </Field>

          <details className="import-columns">
            <summary>Columns: {COLUMN_LABELS.filter(([k]) => table.columns[k] !== null).map(([k, l]) => `${l} = ${table.headers[table.columns[k]!] || "?"}`).join(" · ")}</summary>
            <div className="import-columns-grid">
              {COLUMN_LABELS.map(([key, label]) => (
                <Field key={key} label={label}>
                  <select value={table.columns[key] ?? ""} onChange={(e) => setColumn(key, e.target.value)}>
                    {key !== "date" && key !== "description" && <option value="">Not in this file</option>}
                    {table.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </Field>
              ))}
            </div>
          </details>

          {fresh.length === 0 ? (
            <Empty title={alreadyImported ? "Everything here is already in Tally" : "No transactions found"}
              body={alreadyImported ? `All ${alreadyImported} rows in this statement were imported before.` : "Check the columns above match the statement."} />
          ) : (
            <>
              <div className="row between wrap gap8">
                <div className="view-switch" role="group" aria-label="Show">
                  {(["all", "debit", "credit"] as Filter[]).map((f) => (
                    <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                      {f === "all" ? `All ${fresh.length}` : f === "debit" ? "Money out" : "Money in"}
                    </button>
                  ))}
                </div>
                <div className="row gap8">
                  <button className="btn ghost" onClick={() => setPicked(new Set([...picked, ...shown.map((t) => t.id)]))}>Tick all</button>
                  <button className="btn ghost" onClick={() => setPicked(new Set([...picked].filter((id) => !shown.some((t) => t.id === id))))}>Untick all</button>
                </div>
              </div>
              {alreadyImported > 0 && <p className="t-muted tiny" style={{ margin: 0 }}>{alreadyImported} row{alreadyImported === 1 ? " was" : "s were"} imported before and {alreadyImported === 1 ? "is" : "are"} skipped.</p>}

              <ul className="import-list">
                {shown.map((t) => <ImportRow key={t.id} t={t} day={day(t.date)} picked={picked.has(t.id)} onToggle={() => toggle(t.id)}
                  maybeLogged={status.get(t.id) === "maybe-logged"} transfer={looksLikeTransfer(t)}
                  category={categories[t.id] ?? t.category} onCategory={(c) => setCategories((m) => ({ ...m, [t.id]: c }))} />)}
              </ul>

              <button className="btn primary block" disabled={busy || chosen.length === 0} onClick={add}>
                {chosen.length === 0 ? "Tick the transactions to add"
                  : `Add ${[outCount && `${outCount} expense${outCount === 1 ? "" : "s"} (${formatMoney(outTotal)})`, inCount && `${inCount} income (${formatMoney(inTotal)})`].filter(Boolean).join(" and ")}`}
              </button>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

function ImportRow({ t, day, picked, onToggle, maybeLogged, transfer, category, onCategory }: {
  t: StatementTxn; day: string; picked: boolean; onToggle: () => void; maybeLogged: boolean; transfer: boolean;
  category: Category; onCategory: (c: Category) => void;
}) {
  return (
    <li className={`import-row${picked ? "" : " off"}`}>
      <input type="checkbox" checked={picked} onChange={onToggle} aria-label={`Include ${t.name}, ${formatMoney(t.amount)} on ${day}`} />
      <div className="col grow" style={{ minWidth: 0 }}>
        <div className="row gap8">
          <span className="t-strong ellipsis grow">{t.direction === "credit" ? t.incomeSource : t.name}</span>
          <span className={`num t-strong${t.direction === "credit" ? " in" : ""}`}>{t.direction === "credit" ? "+" : "−"}{formatMoney(t.amount, { showPaise: true })}</span>
        </div>
        <span className="tiny t-muted ellipsis" title={t.description}>{day} · {t.description}</span>
        <div className="row gap8 wrap" style={{ marginTop: 4 }}>
          {t.direction === "debit" && (
            <select className="import-cat" aria-label={`Category for ${t.name}`} value={category} onChange={(e) => onCategory(e.target.value as Category)}>
              {pickableCategories(category).map((c) => <option key={c} value={c}>{categoryMeta(c).title}</option>)}
            </select>
          )}
          {maybeLogged && <span className="tag warn">Looks like one you already logged</span>}
          {transfer && <span className="tag">Looks like a transfer or investment</span>}
        </div>
      </div>
    </li>
  );
}
