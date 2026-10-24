import { useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db, type StoreName } from "./db";
import { allRecords, load, onLocalChange } from "./store";
import {
  changeKey, firstSignInPlan, fromSyncData, KIND_OF, nextCursor, pullFrom, rowsToApply, STORE_OF, toSyncData,
  type Change, type RemoteRow,
} from "./syncCore";

/**
 * Optional Google sign-in and sync through Supabase. Signed out, Tally works exactly as before:
 * data stays in this browser. Signed in, every change also goes to the person's rows in Supabase
 * (row-level security: nobody else can read them) and other devices pick it up.
 *
 * The device's own copy (IndexedDB) stays the working copy, so Tally keeps working offline;
 * edits wait in the "outbox" store and upload when there's a connection.
 */

const SUPABASE_URL: string | undefined = import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY: string | undefined =
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False when the build has no Supabase settings; sign-in is hidden and Tally stays local-only. */
export const cloudAvailable = Boolean(SUPABASE_URL && SUPABASE_KEY);

export interface CloudUser { id: string; email: string; name: string; avatar: string | null }
export interface CloudState {
  user: CloudUser | null;
  status: "signed-out" | "syncing" | "synced" | "offline" | "error";
  lastSyncedAt: number | null;
  /** Changes on this device not uploaded yet. */
  pending: number;
  message: string | null;
}

let cloud: CloudState = { user: null, status: "signed-out", lastSyncedAt: null, pending: 0, message: null };
const listeners = new Set<() => void>();
const setCloud = (patch: Partial<CloudState>) => { cloud = { ...cloud, ...patch }; listeners.forEach((l) => l()); };
export function useCloud(): CloudState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => cloud);
}

// ---------- client ----------

let client: SupabaseClient | null = null;

/** supabase-js loads only for people who sign in, so local-only use stays as light as before. */
async function getClient(): Promise<SupabaseClient> {
  if (client) return client;
  const { createClient } = await import("@supabase/supabase-js");
  client = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    // PKCE: Google sends back a one-time code, which is exchanged below. Nothing sensitive in the URL fragment.
    auth: { flowType: "pkce", detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
  });
  return client;
}

const hasStoredSession = () => {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
  } catch {
    return false;
  }
};

/**
 * Finishes the Google redirect before the app renders: exchanges ?code= for a session and removes
 * the sign-in parameters from the address bar. Call once at startup.
 */
export async function completeSignInRedirect(): Promise<void> {
  if (!cloudAvailable) return;
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (!code && !error) return;
  for (const p of ["code", "state", "error", "error_code", "error_description"]) url.searchParams.delete(p);
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  if (error) {
    setCloud({ status: "error", message: `Google sign-in didn't finish: ${error}` });
    return;
  }
  try {
    const c = await getClient();
    const { error: exchangeError } = await c.auth.exchangeCodeForSession(code!);
    if (exchangeError) throw exchangeError;
  } catch (e) {
    setCloud({ status: "error", message: `Couldn't finish signing in: ${(e as Error).message}. Try again.` });
  }
}

export async function signInWithGoogle(): Promise<void> {
  const c = await getClient();
  const { error } = await c.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${location.origin}${location.pathname}`, queryParams: { prompt: "select_account" } },
  });
  if (error) setCloud({ status: "error", message: `Couldn't open Google sign-in: ${error.message}` });
}

// ---------- outbox ----------

const toRow = (c: Change) => ({ kind: c.kind, record_id: c.record_id, data: c.data, deleted: c.deleted, changed_at: new Date(c.changedAt).toISOString() });

function track(store: StoreName, key: string, value: unknown | null) {
  const kind = KIND_OF[store];
  if (!kind || (store === "kv" && key !== "settings")) return;
  let change: Change;
  if (value === null) {
    if (kind === "settings") return;
    change = { key: changeKey(kind, key), kind, record_id: key, data: null, deleted: true, changedAt: Date.now() };
  } else {
    const s = toSyncData(store, value);
    if (!s) return;
    change = { key: changeKey(s.kind, s.id), kind: s.kind, record_id: s.id, data: s.data, deleted: false, changedAt: Date.now() };
  }
  void db.put("outbox", change).then(refreshPending).then(() => scheduleSync(1500));
}

async function refreshPending() {
  setCloud({ pending: (await db.all<Change>("outbox")).length });
}

// ---------- sync ----------

interface SyncAccount { key: "syncAccount"; userId: string; cursor: string | null }

const PAGE = 1000;

async function pull(c: SupabaseClient, cursor: string | null): Promise<RemoteRow[]> {
  const from = pullFrom(cursor);
  const rows: RemoteRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = c.from("sync_records").select("kind, record_id, data, deleted, changed_at, synced_at")
      .order("synced_at").order("kind").order("record_id").range(offset, offset + PAGE - 1);
    if (from) q = q.gt("synced_at", from);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data as RemoteRow[]));
    if (data.length < PAGE) return rows;
  }
}

/** Writes downloaded rows into this device's copy, then reloads the app state. */
async function apply(rows: RemoteRow[]): Promise<number> {
  const pending = new Map((await db.all<Change>("outbox")).map((c) => [c.key, c.changedAt]));
  const todo = rowsToApply(rows, pending);
  if (!todo.length) return 0;
  const localSettings = (await db.get<{ value: Record<string, unknown> }>("kv", "settings"))?.value;
  for (const r of todo) {
    const store = STORE_OF[r.kind];
    if (r.deleted) {
      if (r.kind !== "settings") await db.delete(store, r.record_id);
    } else {
      await db.put(store, fromSyncData(r.kind, r.data, localSettings));
    }
  }
  await load();
  return todo.length;
}

async function push(c: SupabaseClient) {
  const outbox = await db.all<Change>("outbox");
  for (let i = 0; i < outbox.length; i += 200) {
    const batch = outbox.slice(i, i + 200);
    const { error } = await c.rpc("sync_push", { changes: batch.map(toRow) });
    if (error) throw error;
    // Clear what was sent, unless it was edited again while uploading.
    for (const sent of batch) {
      const current = await db.get<Change>("outbox", sent.key);
      if (current && current.changedAt === sent.changedAt) await db.delete("outbox", sent.key);
    }
  }
}

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function scheduleSync(delay = 0) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

/** Upload this device's changes, then download everyone else's. Safe to call any time. */
export async function syncNow(): Promise<void> {
  if (!cloud.user || !client) return;
  if (running) { again = true; return; }
  running = true;
  setCloud({ status: "syncing", message: null });
  try {
    const c = client;
    let account = await db.get<SyncAccount>("kv", "syncAccount");
    if (account?.userId !== cloud.user.id) {
      // First sync on this device for this account: the account's data comes first, then whatever
      // only this device has is added to it.
      const remote = await pull(c, null);
      await apply(remote);
      const plan = firstSignInPlan(allRecords(), remote);
      for (const id of plan.dropChipIds) await db.delete("chips", id);
      if (plan.dropChipIds.length) await load();
      await db.putMany("outbox", plan.uploads);
      account = { key: "syncAccount", userId: cloud.user.id, cursor: nextCursor(remote, null) };
      await db.put("kv", account);
    }
    await push(c);
    const rows = await pull(c, account.cursor);
    await apply(rows);
    await db.put("kv", { ...account, cursor: nextCursor(rows, account.cursor) });
    setCloud({ status: "synced", lastSyncedAt: Date.now() });
  } catch (e) {
    const offline = !navigator.onLine || e instanceof TypeError;
    setCloud({ status: offline ? "offline" : "error", message: offline ? null : `Sync failed: ${(e as Error).message}` });
  } finally {
    running = false;
    await refreshPending();
    if (again) { again = false; scheduleSync(0); }
  }
}

let started = false;

/** Call once the app's data has loaded. Picks up an existing session and keeps devices in step. */
export async function startCloud(): Promise<void> {
  if (!cloudAvailable || started) return;
  if (!hasStoredSession() && !client) return;
  started = true;
  const c = await getClient();
  const { data } = await c.auth.getSession();
  c.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      if (cloud.user) setCloud({ user: null, status: "signed-out" });
      onLocalChange(null);
    }
  });
  const user = data.session?.user;
  if (!user) return;
  const meta = user.user_metadata as Record<string, string | undefined>;
  setCloud({
    user: { id: user.id, email: user.email ?? "", name: meta.full_name ?? meta.name ?? user.email ?? "", avatar: meta.avatar_url ?? meta.picture ?? null },
    status: "syncing",
  });
  onLocalChange(track);
  await syncNow();
  // Keep in step: when the tab comes back, when the connection returns, and every minute while visible.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") scheduleSync(0); });
  window.addEventListener("online", () => scheduleSync(0));
  setInterval(() => { if (document.visibilityState === "visible") scheduleSync(0); }, 60_000);
}

/**
 * Signs out and removes Tally's data from this browser (it stays in the account). Refuses when
 * changes couldn't be uploaded, unless `discardUnsynced` is set.
 */
export async function signOut(discardUnsynced = false): Promise<{ ok: true } | { ok: false; pending: number }> {
  if (!client) return { ok: true };
  await syncNow();
  const pending = (await db.all<Change>("outbox")).length;
  if (pending > 0 && !discardUnsynced) return { ok: false, pending };
  onLocalChange(null);
  await client.auth.signOut({ scope: "local" });
  for (const s of ["expenses", "incomes", "chips", "budgets", "bills", "accounts", "goals", "kv", "outbox"] as StoreName[]) await db.clear(s);
  try { localStorage.removeItem("tally:homeView"); } catch { /* nothing to remove */ }
  setCloud({ user: null, status: "signed-out", lastSyncedAt: null, pending: 0, message: null });
  await load();
  return { ok: true };
}
