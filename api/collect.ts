import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * POST /api/collect — anonymous usage counts, crash reports and feedback from the Tally app.
 *
 * Everything is checked here before it's stored: known event names only, short strings, small
 * bodies, and a per-address rate limit. Rows go into tables that browsers can't read or write
 * (see the people_loans_feedback migration); only this function's secret key can. Old usage and
 * crash rows are deleted after a year.
 */

declare const process: { env: Record<string, string | undefined> };

const EVENTS = new Set([
  "app_open", "expense_added", "import_done", "ledger_added", "loan_added", "pay_request_shared", "recap_shared",
  "language_changed", "currency_changed", "signed_in", "feedback_sent",
]);
const MOODS = new Set(["love", "okay", "problem"]);
const MAX_BODY = 32_000;
const KEEP_DAYS = 365;

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

const done = (status: number) => new Response(null, { status, headers: { "cache-control": "no-store" } });

// Per-address limits. Instances are reused between requests, so this holds across most of them.
const hits = new Map<string, { count: number; feedback: number; resetAt: number }>();
function allowed(ip: string, isFeedback: boolean): boolean {
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || h.resetAt < now) {
    h = { count: 0, feedback: 0, resetAt: now + 10 * 60_000 };
    hits.set(ip, h);
    if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
  }
  h.count++;
  if (isFeedback) h.feedback++;
  return h.count <= 120 && h.feedback <= 5;
}

/** Only rows the tables accept: flat props with short keys and values. */
function cleanProps(v: unknown): Row {
  if (!isRow(v)) return {};
  const out: Row = {};
  for (const [k, val] of Object.entries(v).slice(0, 8)) {
    if (!/^[a-z_]{1,24}$/.test(k)) continue;
    if (typeof val === "boolean" || (typeof val === "number" && Number.isFinite(val))) out[k] = val;
    else if (typeof val === "string") out[k] = val.slice(0, 40);
  }
  return out;
}

let admin: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (admin) return admin;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export async function POST(request: Request): Promise<Response> {
  // Only Tally's own pages may send. (Browsers always set Origin on cross-site POSTs.)
  const origin = request.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== new URL(request.url).host) return done(403); } catch { return done(403); }
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) return done(413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return done(400); }
  if (!isRow(body)) return done(400);

  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!allowed(ip, isRow(body.feedback))) return done(429);

  const client = db();
  if (!client) return done(503);

  const device = text(body.device, 64);
  const release = text(body.release, 40);

  if (Array.isArray(body.events)) {
    if (!device || device.length < 8) return done(400);
    const rows = body.events.slice(0, 50).filter(isRow).filter((e) => typeof e.event === "string" && EVENTS.has(e.event))
      .map((e) => ({ device, event: e.event as string, props: cleanProps(e.props), release, lang: text(body.lang, 8) }));
    if (rows.length) {
      const { error } = await client.from("usage_events").insert(rows);
      if (error) return done(500);
    }
  }

  if (isRow(body.error)) {
    const e = body.error;
    const message = text(e.message, 500);
    if (message) {
      const { error } = await client.from("client_errors").insert({
        device, message, stack: text(e.stack, 4000), path: text(e.path, 200), release, user_agent: text(e.userAgent, 300),
      });
      if (error) return done(500);
    }
  }

  if (isRow(body.feedback)) {
    const f = body.feedback;
    const message = text(f.message, 4000)?.trim();
    if (!message) return done(400);
    const email = text(f.email, 320)?.trim() ?? "";
    const { error } = await client.from("feedback").insert({
      device, message, mood: typeof f.mood === "string" && MOODS.has(f.mood) ? f.mood : null,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
      path: text(f.path, 200), release, user_agent: text(f.userAgent, 300),
    });
    if (error) return done(500);
  }

  // Now and then, clear out usage and crash rows older than a year.
  if (Math.random() < 0.01) {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
    await Promise.all([
      client.from("usage_events").delete().lt("created_at", cutoff),
      client.from("client_errors").delete().lt("created_at", cutoff),
    ]);
  }

  return done(204);
}
