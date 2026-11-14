/**
 * Anonymous usage counts, crash reports and feedback, sent to /api/collect.
 *
 * Usage events say only that something happened ("expense_added", source "smart"): never amounts,
 * names, notes or merchants. The device ID is a random value made in this browser and isn't tied
 * to the Google account. People can turn usage and crash reports off in Settings; browsers that
 * send Global Privacy Control start with them off. Feedback is sent only when someone writes it.
 */

declare const __RELEASE__: string;
const RELEASE = typeof __RELEASE__ === "string" ? __RELEASE__ : "dev";
const ENDPOINT = "/api/collect";
const USAGE_KEY = "tally:usage";
const DEVICE_KEY = "tally:device";
const DAY_KEY = "tally:lastOpenDay";

export type EventName =
  | "app_open" | "expense_added" | "import_done" | "ledger_added" | "loan_added" | "pay_request_shared" | "recap_shared"
  | "language_changed" | "currency_changed" | "signed_in" | "feedback_sent";
type Props = Record<string, string | number | boolean>;

const storage = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

const enabled = () => typeof window !== "undefined" && !import.meta.env.DEV && import.meta.env.MODE !== "test";

/** Usage and crash reports: on unless turned off, or the browser asks sites not to track (GPC). */
export function usageAllowed(): boolean {
  const v = storage.get(USAGE_KEY);
  if (v !== null) return v === "1";
  return !(typeof navigator !== "undefined" && (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl);
}
export function setUsageAllowed(v: boolean) {
  storage.set(USAGE_KEY, v ? "1" : "0");
  if (!v) queue.length = 0;
}

function device(): string {
  let id = storage.get(DEVICE_KEY);
  if (!id || id.length < 8) {
    id = (globalThis.crypto && "randomUUID" in crypto) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
    storage.set(DEVICE_KEY, id);
  }
  return id;
}

/** Where in the app: the page and tab (#plan), never the query string. */
const where = () => (typeof location === "undefined" ? "" : (location.pathname + (/^#[a-z]+$/.test(location.hash) ? location.hash : "")).slice(0, 200));
const lang = () => (typeof document === "undefined" ? "" : document.documentElement.lang || "en").slice(0, 8);

interface QueuedEvent { event: EventName; props: Props; at: number }
const queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function send(body: unknown, beacon: boolean): Promise<boolean> {
  const json = JSON.stringify(body);
  if (beacon && navigator.sendBeacon) {
    return Promise.resolve(navigator.sendBeacon(ENDPOINT, new Blob([json], { type: "text/plain" })));
  }
  return fetch(ENDPOINT, { method: "POST", headers: { "content-type": "text/plain" }, body: json, keepalive: json.length < 60_000 })
    .then((r) => r.ok).catch(() => false);
}

function flush(beacon = false) {
  clearTimeout(timer);
  timer = undefined;
  if (!queue.length || !usageAllowed()) return;
  const events = queue.splice(0, 50);
  void send({ device: device(), release: RELEASE, lang: lang(), events }, beacon);
}

export function track(event: EventName, props: Props = {}) {
  if (!enabled() || !usageAllowed()) return;
  queue.push({ event, props, at: Date.now() });
  if (queue.length >= 20) flush();
  else if (!timer) timer = setTimeout(() => flush(), 15_000);
}

const reported = new Set<string>();

/** Sends a crash or unexpected error, once per message per visit and at most 10 a visit. */
export function reportError(error: unknown) {
  if (!enabled() || !usageAllowed()) return;
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");
  const message = (err.message || err.name || "Error").slice(0, 500);
  if (reported.has(message) || reported.size >= 10) return;
  reported.add(message);
  // Strip the site's address from stack frames: shorter, and the same across deployments.
  const stack = (err.stack ?? "").replaceAll(location.origin, "").slice(0, 4000);
  void send({ device: device(), release: RELEASE, error: { message, stack, path: where(), userAgent: navigator.userAgent.slice(0, 300) } }, false);
}

export type Mood = "love" | "okay" | "problem";

/** Feedback goes out even with usage reports off: the person chose to send it. */
export async function sendFeedback(f: { message: string; mood: Mood | null; email: string }): Promise<boolean> {
  if (!enabled()) { console.info("Feedback (not sent in development):", f); return true; }
  const ok = await send({
    device: device(), release: RELEASE,
    feedback: { message: f.message.slice(0, 4000), mood: f.mood, email: f.email.trim().slice(0, 320), path: where(), userAgent: navigator.userAgent.slice(0, 300) },
  }, false);
  if (ok) track("feedback_sent", { mood: f.mood ?? "none" });
  return ok;
}

/** Once at startup: crash reporting, one "app_open" a day, and sending what's queued when the page is hidden. */
export function startTelemetry() {
  if (!enabled()) return;
  window.addEventListener("error", (e) => reportError(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });
  const today = new Date().toISOString().slice(0, 10);
  if (storage.get(DAY_KEY) !== today) {
    storage.set(DAY_KEY, today);
    const standalone = matchMedia?.("(display-mode: standalone)").matches ?? false;
    track("app_open", { installed: standalone, width: Math.round(innerWidth / 100) * 100 });
  }
}
