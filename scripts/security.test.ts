import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Security guardrails. Each test is a rule from SECURITY.md; if one fails, the change broke a rule
 * that protects people's money data. Fix the change, or update SECURITY.md and this test together
 * with a reason.
 */

const read = (p: string) => readFileSync(p, "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const appSource = walk("src").filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p));
const pages = readdirSync(".").filter((n) => n.endsWith(".html"));
const vercel = JSON.parse(read("vercel.json"));
const header = (key: string): string =>
  vercel.headers.find((h: { source: string }) => h.source === "/(.*)").headers.find((h: { key: string }) => h.key === key)?.value ?? "";
const csp = Object.fromEntries(header("Content-Security-Policy").split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
const migrations = readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql")).sort()
  .map((n) => read(join("supabase/migrations", n)).replace(/--.*$/gm, "")).join("\n").toLowerCase();

describe("security: the page can't be made to run someone else's code", () => {
  it("never builds HTML from strings or evaluates text as code", () => {
    const sink = /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write|\beval\s*\(|new Function\s*\(|setTimeout\s*\(\s*["'`]/;
    const hits = [...appSource, ...pages].filter((p) => sink.test(read(p)));
    expect(hits, "Set text with textContent / JSX instead").toEqual([]);
  });

  it("only runs scripts that ship with Tally, with no inline or eval escape hatches", () => {
    expect(csp["script-src"]).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    for (const d of ["default-src", "style-src", "connect-src", "worker-src", "img-src"]) {
      expect(csp[d], d).not.toContain("'unsafe-inline'");
      expect(csp[d], d).not.toContain("'unsafe-eval'");
      expect(csp[d], d).not.toContain("*");
      expect(csp[d], d).not.toContain("https:");
    }
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
  });

  it("talks only to Tally and its own Supabase project", () => {
    const outside = (csp["connect-src"] ?? []).filter((s: string) => s !== "'self'");
    expect(outside).toHaveLength(1);
    expect(outside[0]).toMatch(/^https:\/\/[a-z0-9]{20}\.supabase\.co$/);
  });

  it("loads no code from a CDN at runtime", () => {
    const cdn = /cdn\.jsdelivr|unpkg\.com|cdnjs\.|esm\.sh|skypack/;
    expect([...appSource, ...pages, "sw/service-worker.js"].filter((p) => cdn.test(read(p)))).toEqual([]);
  });

  it("sends the other protective headers on every page", () => {
    expect(header("Strict-Transport-Security")).toMatch(/max-age=(\d{8,})/);
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("Referrer-Policy")).toBe("no-referrer");
    expect(header("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(header("Permissions-Policy")).toMatch(/geolocation=\(\)/);
    expect(header("Permissions-Policy")).toMatch(/microphone=\(\)/);
  });

  it("opens other sites without giving them a handle on Tally's window", () => {
    for (const p of appSource) {
      for (const m of read(p).matchAll(/window\.open\(([^;]*)\)/g)) expect(m[1], p).toMatch(/noopener/);
    }
  });

  it("links only to https sites", () => {
    const plain = /["'`]http:\/\/(?!localhost|127\.0\.0\.1)/;
    expect([...appSource, ...pages].filter((p) => plain.test(read(p)))).toEqual([]);
  });
});

describe("security: secrets stay on the server", () => {
  it("bundles only public environment variables", () => {
    expect(read("vite.config.ts")).toMatch(/envPrefix:\s*\["VITE_",\s*"NEXT_PUBLIC_"\]/);
    const secretName = /import\.meta\.env\.\w*(SECRET|SERVICE_ROLE|PASSWORD|PRIVATE|JWT)/;
    expect(appSource.filter((p) => secretName.test(read(p)))).toEqual([]);
  });

  it("reads the secret key only in server functions", () => {
    const secretUse = /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_JWT_SECRET|POSTGRES_/;
    expect(appSource.filter((p) => secretUse.test(read(p)))).toEqual([]);
  });

  it("keeps .env files out of git and out of deploy uploads", () => {
    expect(read(".gitignore")).toMatch(/^\.env\*$/m);
    expect(read(".vercelignore")).toMatch(/^\.env\*$/m);
  });

  it("has no secret committed to git", () => {
    let tracked: string[];
    try { tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean); }
    catch { return; } // not a git checkout
    expect(tracked.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".example"))).toEqual([]);
    const shapes = [
      /sb_secret_[A-Za-z0-9_-]{16,}/,
      /postgres(?:ql)?:\/\/[^:\s/"'`]+:[^@\s"'`$<{]{6,}@/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    ];
    const hits = tracked
      .filter((f) => existsSync(f) && !/\.(png|jpe?g|webp|woff2?|ico|gz|wasm)$/.test(f) && f !== "scripts/security.test.ts" && f !== "scripts/check-build.mjs")
      .filter((f) => shapes.some((re) => re.test(read(f))));
    expect(hits, "Move these values into Vercel environment variables").toEqual([]);
  });
});

describe("security: the server functions check every request", () => {
  const apis = readdirSync("api").filter((n) => n.endsWith(".ts")).map((n) => [n, read(join("api", n))] as const);

  it("every function using the secret key first proves the caller or limits what it accepts", () => {
    for (const [name, src] of apis) {
      if (!/SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/.test(src)) continue;
      const provesUser = /auth\.getUser\(/.test(src);
      const limitsInput = /MAX_BODY/.test(src) && /headers\.get\("origin"\)/.test(src) && /allowed\(/.test(src);
      expect(provesUser || limitsInput, name).toBe(true);
    }
  });

  it("never answers with something a cache or another site could keep", () => {
    for (const [name, src] of apis) expect(src, name).toMatch(/no-store/);
  });

  it("deleting an account signs out every device before the account goes", () => {
    const src = read("api/delete-account.ts");
    expect(src.indexOf("signOut(")).toBeGreaterThan(-1);
    expect(src.indexOf("signOut(")).toBeLessThan(src.indexOf("deleteUser("));
  });
});

describe("security: each person's rows are theirs alone", () => {
  const tables = [...migrations.matchAll(/create table (?:if not exists )?public\.(\w+)/g)].map((m) => m[1]);
  const functions = [...migrations.matchAll(/create (?:or replace )?function public\.(\w+)/g)].map((m) => m[1]);

  it("turns on row-level security for every table", () => {
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(migrations, t).toContain(`alter table public.${t} enable row level security`);
  });

  it("never lets anonymous visitors touch a table", () => {
    for (const t of tables) expect(migrations, t).toMatch(new RegExp(`revoke all on table [^;]*public\\.${t}\\b[^;]*from [^;]*anon`));
  });

  it("checks ownership on every policy, not just that someone signed in", () => {
    for (const m of migrations.matchAll(/create policy[^;]+;/g)) {
      expect(m[0]).toMatch(/to authenticated/);
      expect(m[0]).toMatch(/auth\.uid\(\)\)?\s*=\s*user_id/);
      if (/for update/.test(m[0])) expect(m[0]).toMatch(/with check/);
    }
    expect(migrations).not.toMatch(/auth\.role\(\)|user_metadata/);
  });

  it("runs database functions as the caller, never with elevated rights", () => {
    expect(migrations).not.toMatch(/security definer/);
    for (const f of functions) expect(migrations, f).toMatch(new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\) from [^;]*public`));
  });

  it("makes views respect row-level security", () => {
    for (const m of migrations.matchAll(/create (?:or replace )?view public\.(\w+)([^;]*)/g)) expect(m[2], m[1]).toMatch(/security_invoker\s*=\s*true/);
  });
});

describe("security: dependencies can't change underneath us", () => {
  it("pins every dependency to an exact version", () => {
    const pkg = JSON.parse(read("package.json"));
    const lock = JSON.parse(read("package-lock.json"));
    for (const [name, v] of Object.entries<string>({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (v.startsWith("https://")) expect(lock.packages[`node_modules/${name}`]?.integrity, name).toMatch(/^sha512-/);
      else expect(v, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
