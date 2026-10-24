import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { addExpense, deleteExpense, setSettings, showToast, useTally } from "../data/store";
import { CATEGORIES, CATEGORY_META, type Category } from "../core/categories";
import { formatMoney } from "../core/money";
import { parseLines, yourShare } from "../core/smartParser";
import { parseReceipt } from "../core/receiptParser";
import { CategoryIcon, Icon } from "../ui/icons";
import { Sheet } from "../ui/components";

const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** `initialDate` pre-fills the date, e.g. when adding from a day in the calendar. */
export function QuickAdd({ open, onClose, onSmart, initialDate }: {
  open: boolean; onClose: () => void; onSmart: () => void; initialDate?: Date | null;
}) {
  const s = useTally();
  const [digits, setDigits] = useState("");
  const [category, setCategory] = useState<Category>("food");
  const [account, setAccount] = useState(s.settings.defaultAccount);
  const [date, setDate] = useState(toLocalInput(new Date()));
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(0);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const saveStart = useRef<number | null>(null);
  const swipedSave = useRef(false);

  useEffect(() => {
    if (open) { setDigits(""); setNote(""); setSaved(0); setDate(toLocalInput(initialDate ?? new Date())); setAccount(s.settings.defaultAccount); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const amount = (parseInt(digits || "0", 10) || 0) * 100;
  const accounts = useMemo(() => {
    const names = ["UPI", "Cash", "Credit card", ...s.accounts.map((a) => a.name)];
    return [...new Set(names)];
  }, [s.accounts]);

  const tap = (k: string) => {
    if (k === "⌫") return setDigits((d) => d.slice(0, -1));
    setDigits((d) => (d.length + k.length > 7 || (!d && k.startsWith("0")) ? d : d + k));
  };

  // Physical keyboard on desktop: digits, Backspace, Enter.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA") return;
      if (/^\d$/.test(e.key)) tap(e.key);
      else if (e.key === "Backspace") tap("⌫");
      else if (e.key === "Enter") save(false);
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") cycle(e.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const cycle = (dir: number) => {
    const i = CATEGORIES.indexOf(category);
    setCategory(CATEGORIES[(i + dir + CATEGORIES.length) % CATEGORIES.length]);
  };

  const save = (keepOpen: boolean) => {
    if (!amount) return;
    const [y, m, d] = date.split("-").map(Number);
    const when = new Date();
    const occurredAt = toLocalInput(when) === date ? when.getTime() : new Date(y, m - 1, d, 12).getTime();
    const e = addExpense({ amount, category, merchant: note.trim(), account, occurredAt, source: "manual" });
    navigator.vibrate?.(12);
    setSettings({ defaultAccount: account });
    if (keepOpen) {
      setSaved((n) => n + 1);
      setDigits("");
      setNote("");
    } else {
      showToast(`Logged ${formatMoney(amount)} · ${CATEGORY_META[category].title}`, () => deleteExpense(e.id, false));
      onClose();
    }
  };

  const amtDown = (e: RPointerEvent) => { swipeStart.current = { x: e.clientX, y: e.clientY }; };
  const amtUp = (e: RPointerEvent) => {
    const st = swipeStart.current; swipeStart.current = null;
    if (!st) return;
    const dx = e.clientX - st.x;
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(e.clientY - st.y)) cycle(dx < 0 ? 1 : -1);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Quick add"
      actions={<button className="btn ghost" onClick={onSmart}>Type, speak or scan</button>}>
      <div className="amount-display" onPointerDown={amtDown} onPointerUp={amtUp}>
        <div className="t-muted small">{saved ? `Saved ${saved} · keep going` : "New expense"}</div>
        <div className="big display num" aria-live="polite">{formatMoney(amount)}</div>
        <div className="t-muted tiny">Swipe the amount sideways (or ← →) to change category</div>
      </div>

      <div className="cat-grid" role="group" aria-label="Category">
        {CATEGORIES.map((c) => (
          <button key={c} className="cat-btn" aria-pressed={c === category} onClick={() => setCategory(c)}>
            <Icon name={CATEGORY_META[c].icon} size={20} />{CATEGORY_META[c].title}
          </button>
        ))}
      </div>

      <div className="row gap8">
        <select aria-label="Paid from" value={account} onChange={(e) => setAccount(e.target.value)} style={{ flex: 1 }}>
          {accounts.map((a) => <option key={a}>{a}</option>)}
        </select>
        <input aria-label="Date" type="date" value={date} max={toLocalInput(new Date())} onChange={(e) => setDate(e.target.value)} style={{ flex: 1 }} />
      </div>
      <input type="text" aria-label="Merchant or note" placeholder="Merchant or note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />

      <div className="keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"].map((k) => (
          <button key={k} onClick={() => tap(k)} aria-label={k === "⌫" ? "Delete digit" : k}>
            {k === "⌫" ? <Icon name="backspace" /> : k}
          </button>
        ))}
      </div>

      <div className="col gap4">
        <button className="btn primary block" disabled={!amount}
          onClick={() => { if (swipedSave.current) { swipedSave.current = false; return; } save(false); }}
          onPointerDown={(e) => { saveStart.current = e.clientY; }}
          onPointerUp={(e) => {
            if (saveStart.current !== null && saveStart.current - e.clientY > 40) { swipedSave.current = true; save(true); }
            saveStart.current = null;
          }}>
          {amount ? `Save ${formatMoney(amount)} · ${CATEGORY_META[category].title}` : "Enter an amount"}
        </button>
        <button className="btn ghost" disabled={!amount} onClick={() => save(true)}>Save and add another (or swipe up on Save)</button>
      </div>
    </Sheet>
  );
}

export function SmartAdd({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useTally();
  const [text, setText] = useState("");
  const [scanning, setScanning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setText(""); setError(null); } }, [open]);

  const parsed = useMemo(() => parseLines(text), [text]);

  const save = () => {
    const ids: string[] = [];
    for (const p of parsed) {
      ids.push(addExpense({
        amount: p.amount, category: p.category, merchant: p.merchant ?? "", note: p.note, account: p.account,
        occurredAt: p.date.getTime(), source: "smart", splitWays: p.splitWays, splitWith: p.splitWith.join(", "),
      }).id);
    }
    const total = parsed.reduce((t, p) => t + yourShare(p.amount, p.splitWays), 0);
    showToast(`Logged ${parsed.length} · ${formatMoney(total)} your share`, () => ids.forEach((id) => deleteExpense(id, false)));
    onClose();
  };

  const scan = async (file: File) => {
    setError(null);
    setScanning("Loading text reader…");
    try {
      // Tesseract runs in the browser (WebAssembly); the image never leaves the device.
      const { createWorker } = await import("tesseract.js");
      setScanning("Reading receipt…");
      const worker = await createWorker("eng");
      const { data } = await worker.recognize(file);
      await worker.terminate();
      const r = parseReceipt(data.text.split("\n"));
      if (!r.total) { setError("Couldn't find a total. Type the amount instead."); return; }
      const line = `${(r.total / 100).toFixed(2).replace(/\.00$/, "")}${r.merchant ? " at " + r.merchant.toLowerCase() : ""}`;
      setText((t) => (t ? t + "\n" + line : line));
    } catch {
      setError("Couldn't read that image. Check your connection the first time (the reader downloads once), or type it.");
    } finally {
      setScanning(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Smart add">
      <label className="field">
        <span>Write it how you'd say it — one expense per line</span>
        <textarea rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"lunch 350 at chutneys, split with arjun\nauto 120\ngroceries 850 card"} />
      </label>
      <p className="t-muted tiny" style={{ margin: 0 }}>Tip: tap the microphone on your phone's keyboard to dictate instead of typing.</p>

      <div className="row gap8">
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={!!scanning}>
          <Icon name="scan" size={18} />{scanning ?? "Scan a receipt photo"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void scan(f); }} />
      </div>
      {error && <p className="small" style={{ color: "var(--danger)", margin: 0 }}>{error}</p>}

      {parsed.length > 0 && (
        <div className="card flush divided" style={{ background: "var(--surface-2)" }}>
          {parsed.map((p, i) => (
            <div key={i} className="col gap8" style={{ padding: 14 }}>
              <div className="row gap12">
                <CategoryIcon category={p.category} size={32} />
                <span className="grow t-strong ellipsis">{p.merchant ?? (p.note || CATEGORY_META[p.category].title)}</span>
                <span className="t-strong num">{formatMoney(p.amount, { showPaise: true })}</span>
              </div>
              <div className="row gap4 wrap">
                <span className="tag">{CATEGORY_META[p.category].title}</span>
                {p.merchant && p.note && <span className="tag">{p.note}</span>}
                <span className="tag">{sameDayLabel(p.date)}</span>
                <span className="tag">{p.account ?? s.settings.defaultAccount}</span>
                {p.splitWays > 1 && (
                  <span className="tag accent">
                    Split {p.splitWith.length ? "with " + p.splitWith.join(", ") : p.splitWays + " ways"} · you {formatMoney(yourShare(p.amount, p.splitWays))}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {text && parsed.length === 0 && <p className="t-muted small" style={{ margin: 0 }}>Add an amount, like “auto 120”.</p>}

      <button className="btn primary block" disabled={!parsed.length} onClick={save}>
        {parsed.length > 1 ? `Log ${parsed.length} expenses` : "Log expense"}
      </button>
      <p className="t-muted tiny" style={{ margin: 0 }}>Understood in your browser. Nothing you type is sent anywhere.</p>
    </Sheet>
  );
}

function sameDayLabel(d: Date) {
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}
