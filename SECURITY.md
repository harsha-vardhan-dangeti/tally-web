# Security

Tally holds people's money records: what they spend, earn, owe and are owed. This file is the set
of rules every change must keep, what enforces each one, and the account settings that live outside
the code.

## Reporting a problem

Open a private report from the repository's **Security → Report a vulnerability** page on GitHub.
Don't open a public issue for anything that could expose someone's data.

## How Tally keeps data safe

- **Local first.** Without sign-in, everything stays in the browser's IndexedDB. Nothing is sent
  anywhere except anonymous usage counts, which people can turn off in Settings and which are off
  by default in browsers that send Global Privacy Control.
- **Sync is per person.** Signed-in records go to `public.sync_records`. Row-level security lets
  each person read and write only their own rows. Writes go through `sync_push()`, which runs as
  the caller (`security invoker`) and is capped at 500 changes per batch and 64 KB per record.
- **Secrets stay on the server.** The browser has only the public Supabase URL and publishable or
  anon key. The secret key is used only by `api/collect.ts`, which accepts known fields only, has a
  size limit and a per-address limit, and by `api/delete-account.ts`, which first checks the
  caller's own access token.
- **Only Tally's own code runs on Tally's pages.** The Content Security Policy allows scripts from
  this site only. The receipt reader (Tesseract), PDF reader and spreadsheet reader are all served
  from Tally's own build, never a CDN.
- **Text is never treated as HTML.** Everything goes through React or `textContent`.

## Rules every change keeps

Each rule is checked automatically. `npm test` runs `scripts/security.test.ts`, and
`npm run build` runs `scripts/check-build.mjs`, which stops a Vercel deploy when it fails.

| Rule | Checked by |
| --- | --- |
| No `innerHTML`, `dangerouslySetInnerHTML`, `eval`, `new Function` or `document.write`. | test |
| CSP `script-src` is `'self' 'wasm-unsafe-eval'` only: no `unsafe-inline`, `unsafe-eval`, wildcards or CDNs. | test |
| `connect-src` allows this site and Tally's one Supabase project only. | test |
| No code is loaded from a CDN at runtime. | test + build check |
| HSTS, `nosniff`, `X-Frame-Options: DENY`, `no-referrer`, COOP and Permissions-Policy headers stay on. | test |
| Only `VITE_*` and `NEXT_PUBLIC_*` variables are bundled. App code never reads a secret variable. | test |
| No secret value, `sb_secret_` key, non-anon JWT, Postgres URL with a password or private key appears in `dist/`. On Vercel, the real secret values are compared without being printed. | build check |
| No secret or `.env` file is committed. `.env*` stays in `.gitignore` and `.vercelignore`. | test |
| Every API function that uses the secret key either verifies the caller's token, or checks the origin, limits the body size and rate-limits. Responses are `no-store`. | test |
| Account deletion signs out every device before deleting the user. | test |
| Every table has RLS on and no `anon` access. Every policy is `to authenticated` and checks `auth.uid() = user_id`. Updates also have `with check`. No `auth.role()` or `user_metadata`. | test |
| No `security definer` functions. Every function's `EXECUTE` is revoked from `public`. Views use `security_invoker = true`. | test |
| Dependencies are pinned to exact versions. Tarball dependencies carry a lockfile hash. | test |
| No high-severity advisories in production dependencies. | CI (`npm run audit:deps`) |

If a rule has to change, change `SECURITY.md` and the test in the same commit, and say why.

### When you…

- **Add a dependency:** pin it exactly (`npm install --save-exact`), check it's at least two weeks
  old and widely used, and run `npm run audit:deps`. Never load its files from a CDN; serve them
  from the build, as `vite.config.ts` does for Tesseract.
- **Add a table or function:** write a migration that turns on RLS, revokes `anon`, adds
  ownership policies (`to authenticated` + `auth.uid() = user_id`, with `with check` on updates),
  and revokes `EXECUTE` from `public`. Then run the project's security advisors in the Supabase
  dashboard.
- **Add an API function:** prove who the caller is (`auth.getUser(token)`), or limit what it
  accepts (allowed fields, body size, rate). Never trust `user_metadata`. Return `no-store`.
- **Add a new host** (an API, an image source): add the exact host to the CSP. Never use a
  wildcard.
- **Handle what a link or file contains** (pay links, backups, statements): treat every field as
  untrusted, check its type and length, and show it with `textContent`.

## Settings outside the code

These live in dashboards, not the repository. Check them after any change to sign-in or hosting.

**Supabase** (Tally's project, via Vercel → Storage → tally-db → Open in Supabase)
- Authentication → Providers: turn **Email off**. Tally signs in with Google only. Left on, anyone
  holding the public key can create password accounts and fill the database through sync.
- Authentication → URL Configuration: Site URL and Redirect URLs list
  `https://tally-web-kappa.vercel.app` (and any custom domain) **exactly**, with no wildcard
  `*.vercel.app` entries.
- Authentication → Sessions: keep access tokens short (1 hour) and refresh-token rotation on.
- Advisors → Security: run it after every migration; it should show no errors.

**Vercel** (Project → Settings)
- Environment Variables: the app needs only `SUPABASE_SECRET_KEY` (server) and the
  `NEXT_PUBLIC_SUPABASE_*` pair (browser). `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` and
  the `POSTGRES_*` values aren't used by the code. Remove them from **Development** at least, so
  `vercel env pull` doesn't copy the database password to laptops.
- Deployment Protection: keep Vercel Authentication on for previews.
- Firewall: add a rate-limit rule for `/api/*`, for example 60 requests per minute per IP. The
  in-function limit in `api/collect.ts` is per server instance, so it's a backstop, not a guarantee.

**GitHub** (Repository → Settings)
- Branch protection on `main`: require the CI check to pass before merging.
- Code security: turn on Dependabot alerts, secret scanning and push protection.
- Account: two-factor authentication on every account that can push or deploy.

## Known gaps

- **Data on a shared device.** Records in IndexedDB aren't encrypted, and there's no app lock.
  Anyone using the same browser profile can open Tally.
- **No storage quota per person.** A signed-in account can keep pushing records until the database
  is full. Turning off the Email provider (above) means only Google accounts can sign in, which
  limits this.
- **The pay page can't prove who made a link.** It shows the UPI ID and asks the payer to check the
  name their UPI app shows before paying.
