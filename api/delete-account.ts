import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/delete-account — deletes the signed-in person's Tally account.
 *
 * The caller proves who they are with their own access token (Authorization: Bearer …); the
 * secret key stays on the server. Every session is signed out first so other devices stop
 * syncing, then the user is deleted, and their synced rows go with it (the table's foreign key
 * to auth.users is ON DELETE CASCADE). Browsers never attach this header on their own, so
 * another site can't trigger it.
 */

declare const process: { env: Record<string, string | undefined> };

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ message }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(401, "Sign in to delete your account.");

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return json(500, "Account deletion isn't set up on this server.");

  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json(401, "Your sign-in has expired. Sign in again, then delete your account.");

  // Revoke every session (all devices) before the account disappears.
  await admin.auth.admin.signOut(token, "global");
  const deleted = await admin.auth.admin.deleteUser(data.user.id);
  if (deleted.error) return json(500, "Couldn't delete your account. Nothing was removed; try again.");
  return json(200, "Your account and synced data are deleted.");
}
