import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
// Serve `vite preview` with the same security headers as production, so CSP problems show up locally.
const productionHeaders: Record<string, string> = Object.fromEntries(
  vercel.headers.find((h: { source: string }) => h.source === "/(.*)").headers.map((h: { key: string; value: string }) => [h.key, h.value]),
);

const PAGES: Record<string, string> = { "/": "index.html", "/app": "app.html", "/privacy": "privacy.html" };
const STATIC = ["manifest.webmanifest", "forward.js", "icons/icon-192.png", "icons/icon-512.png"];

/**
 * Writes dist/sw.js once the build is on disk: its version is a hash of every output file, and it
 * precaches exactly the files that exist. A missing file would make the service worker fail to install.
 */
function serviceWorker(): Plugin {
  return {
    name: "tally-service-worker",
    apply: "build",
    writeBundle(options) {
      const outDir = options.dir!;
      const assets = readdirSync(join(outDir, "assets")).filter((n) => !n.endsWith(".map")).sort().map((n) => `assets/${n}`);
      const files = [...Object.values(PAGES), ...assets, ...STATIC];
      for (const f of files) if (!existsSync(join(outDir, f))) throw new Error(`Service worker would precache a missing file: ${f}`);
      const hash = createHash("sha256");
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      // Statement-import libraries and font subsets for other scripts are large and rarely needed:
      // the service worker caches them the first time they're used instead of on install.
      const onDemand = (f: string) => /^assets\/(xlsx|pdf)[.-]|-(cyrillic|greek|vietnamese)[a-z-]*\.woff2$|-italic[a-z-]*\.woff2$/.test(f);
      const precache = [...Object.keys(PAGES), ...[...assets.filter((f) => !onDemand(f)), ...STATIC].map((f) => `/${f}`)];
      const source = readFileSync("sw/service-worker.js", "utf8")
        .replace("const VERSION = __VERSION__;", `const VERSION = ${JSON.stringify(hash.digest("hex").slice(0, 12))};`)
        .replace("const PRECACHE = __PRECACHE__;", `const PRECACHE = ${JSON.stringify(precache)};`);
      if (source.includes("__")) throw new Error("Service worker template placeholders were not filled in");
      writeFileSync(join(outDir, "sw.js"), source);
    },
  };
}

export default defineConfig({
  appType: "mpa",
  // NEXT_PUBLIC_* are the public Supabase URL and key the Vercel integration provides. Secret keys
  // (service role, Postgres URLs) have other names and are never bundled.
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  plugins: [react(), serviceWorker()],
  build: {
    target: "es2022",
    sourcemap: false,
    // The CSP allows fonts from this site only (font-src 'self'), so small fonts must stay files, not data: URLs.
    assetsInlineLimit: (file: string) => (file.endsWith(".woff2") ? false : undefined),
    rollupOptions: { input: { landing: "index.html", app: "app.html", privacy: "privacy.html", notFound: "404.html" } },
  },
  preview: { headers: productionHeaders },
  test: { environment: "node" },
} as any);
