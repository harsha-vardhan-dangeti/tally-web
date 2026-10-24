import "./landing.css";
import { parseExpense, yourShare, type ParsedExpense } from "../core/smartParser";
import { sameDay, snapshot } from "../core/budget";
import { formatMoney } from "../core/money";
import { CATEGORY_META } from "../core/categories";

/** The hero demo: Tally's real Smart add parser and budget maths, on a sample month. Nothing is stored. */

const BUDGET = 30_000_00; // paise
const now = new Date();
// A plausible month so far: about ₹850 a day before today.
const spentBefore = (now.getDate() - 1) * 850_00;
const logged: ParsedExpense[] = [];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLInputElement>("demo-input");
const parseOut = $("demo-parse");
const log = $("demo-log");

const total = (list: ParsedExpense[]) => list.reduce((t, p) => t + yourShare(p.amount, p.splitWays), 0);

function renderBudget() {
  const today = total(logged.filter((p) => sameDay(p.date, now)));
  // "Yesterday" on the 1st belongs to last month, so it doesn't count here.
  const earlier = total(logged.filter((p) => !sameDay(p.date, now) && p.date.getMonth() === now.getMonth()));
  const snap = snapshot(BUDGET, spentBefore + earlier + today, today, now);
  $("demo-safe").textContent = formatMoney(snap.leftToday);
  $("demo-spent").textContent = formatMoney(snap.spent);
  $("demo-left").textContent = formatMoney(snap.left);
  $("demo-days").textContent = String(snap.daysLeft);
  $("demo-bar").style.width = `${Math.min(snap.fractionUsed, 1) * 100}%`;
}

function field(label: string, value: string, tint?: string) {
  const wrap = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  if (tint) dd.style.setProperty("--tint", tint);
  if (tint) dd.className = "cat";
  wrap.append(dt, dd);
  return wrap;
}

function renderParse() {
  const p = parseExpense(input.value, now);
  parseOut.replaceChildren();
  if (!p) {
    parseOut.append(field("Waiting for", "an amount, like 350 or 1.2k"));
    return;
  }
  const meta = CATEGORY_META[p.category];
  parseOut.append(field("Amount", formatMoney(p.amount, { showPaise: true })));
  if (p.splitWays > 1) parseOut.append(field("Your share", `${formatMoney(yourShare(p.amount, p.splitWays))} of ${p.splitWays}`));
  parseOut.append(field("Category", meta.title, meta.tint));
  if (p.merchant) parseOut.append(field("At", p.merchant));
  if (p.note) parseOut.append(field("Note", p.note));
  if (p.splitWith.length) parseOut.append(field("Split with", p.splitWith.join(", ")));
  if (p.account) parseOut.append(field("Paid by", p.account));
  if (!sameDay(p.date, now)) parseOut.append(field("When", "Yesterday"));
}

function renderLog() {
  log.replaceChildren(...logged.slice(-3).reverse().map((p) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    const amt = document.createElement("span");
    name.textContent = p.merchant || p.note || CATEGORY_META[p.category].title;
    amt.textContent = `−${formatMoney(yourShare(p.amount, p.splitWays))}`;
    amt.className = "num";
    li.style.setProperty("--tint", CATEGORY_META[p.category].tint);
    li.append(name, amt);
    return li;
  }));
}

// Proof that the demo is local: count network requests the page makes after the first keystroke.
let watching = false;
let requests = 0;
function watchNetwork() {
  if (watching || typeof PerformanceObserver === "undefined") return;
  watching = true;
  try {
    new PerformanceObserver((list) => {
      requests += list.getEntries().length;
      $("demo-requests").textContent = String(requests);
    }).observe({ type: "resource" });
  } catch {
    // Older browsers: leave the counter at 0 rather than guess.
  }
}

input.addEventListener("input", () => { watchNetwork(); renderParse(); });
$("demo-form").addEventListener("submit", (e) => {
  e.preventDefault();
  watchNetwork();
  const p = parseExpense(input.value, now);
  if (!p) { input.focus(); return; }
  logged.push(p);
  input.value = "";
  renderParse();
  renderLog();
  renderBudget();
});
document.querySelectorAll<HTMLButtonElement>("[data-try]").forEach((b) => b.addEventListener("click", () => {
  watchNetwork();
  input.value = b.dataset.try ?? "";
  renderParse();
  input.focus();
}));

// People who already use Tally on this device get straight to their data.
try {
  if (localStorage.getItem("tally:onboarded")) {
    document.querySelectorAll("[data-open-app]").forEach((a) => { a.textContent = "Open your Tally"; });
  }
} catch {
  // Storage blocked: keep the default label.
}

renderParse();
renderBudget();
