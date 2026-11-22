// Runs after `vite build` (see package.json). Fails the build — so Vercel never deploys it — when
// anything in dist/ could leak a secret or let code from another site run on Tally's pages.
//
//   1. A server secret's actual value appears in a shipped file. On Vercel the build can see the
//      project's secrets, so this compares the real values without ever printing them.
//   2. Something shaped like a secret appears: a Supabase secret key, a JWT that isn't the public
//      anon key, a Postgres URL with a password, a private key.
//   3. A page loads a script or stylesheet from another site.
//
// Usage: node scripts/check-build.mjs [dir]   (default dist)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const dir = process.argv[2] ?? "dist";
const problems = [];

function* files(d) {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

// Values that must never reach a browser. Only long values count, so an empty or placeholder
// variable can't match everything.
const SECRET_ENV = [
  "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET", "POSTGRES_PASSWORD",
  "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "POSTGRES_PRISMA_URL",
];
const secrets = SECRET_ENV.map((name) => [name, process.env[name]]).filter(([, v]) => typeof v === "string" && v.length >= 16);

const SHAPES = [
  ["a Supabase secret key", /sb_secret_[A-Za-z0-9_-]{16,}/],
  ["a Postgres URL with a password", /postgres(?:ql)?:\/\/[^:\s/"'`]+:[^@\s"'`]{6,}@/],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

/** JWTs in the bundle are allowed only when they're the public anon key. */
function badJwt(text) {
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const claims = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
      if (claims.role && claims.role !== "anon") return `a JWT with role "${claims.role}"`;
    } catch { /* not a JWT after all */ }
  }
  return null;
}

let scanned = 0;
for (const path of files(dir)) {
  if (!/\.(js|mjs|html|css|json|webmanifest|txt|map)$/.test(path)) continue;
  const text = readFileSync(path, "utf8");
  const where = relative(dir, path);
  scanned++;
  for (const [name, value] of secrets) if (text.includes(value)) problems.push(`${where}: contains the value of ${name}`);
  for (const [what, re] of SHAPES) if (re.test(text)) problems.push(`${where}: contains ${what}`);
  const jwt = badJwt(text);
  if (jwt) problems.push(`${where}: contains ${jwt}`);
  if (path.endsWith(".html")) {
    for (const m of text.matchAll(/<(script|link)\b[^>]*\b(?:src|href)\s*=\s*["']?(https?:)?\/\/[^"'\s>]+/gi)) {
      if (m[1].toLowerCase() === "script" || /rel\s*=\s*["']?(stylesheet|modulepreload|preload)/i.test(m[0])) {
        problems.push(`${where}: loads ${m[1]} from another site (${m[0].slice(0, 120)})`);
      }
    }
  }
}

if (problems.length) {
  console.error(`\nSecurity check failed. Nothing was deployed. Fix these first:\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
  process.exit(1);
}
console.log(`Security check passed: ${scanned} files, ${secrets.length} server secrets compared, no secrets or outside scripts.`);
