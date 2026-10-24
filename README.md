# Tally: expense tracker website

Log a spend in 3 seconds and always know **what's safe to spend today**. It's a mobile-first web app (PWA), so you can add it to your iPhone Home Screen, and it also works on Android and desktop.

- **Private by design:** all data stays in the browser (IndexedDB). There's no account, no server and no tracking.
- **Works offline** after the first load: the service worker caches every file of a release.
- **Updates in place:** a new deploy downloads in the background and the app shows *Update ready → Reload*. Data is untouched.
- **Stack:** React 19, TypeScript, Vite. Plain CSS with light/dark themes. No UI framework.

## Site map

| Path | File | What it is |
|---|---|---|
| `/` | `index.html` + `src/landing/` | Public landing page with a live Smart add demo |
| `/app` | `app.html` + `src/main.tsx` | The app |
| `/privacy` | `privacy.html` | Privacy page |
| 404 | `404.html` | Not-found page |

`public/forward.js` sends old app links that point at `/` (`/?log=`, `/?capture=`, `#finances`, Home Screen installs) on to `/app`.

## Releases and offline support

`sw/service-worker.js` is a template. At build time, the plugin in `vite.config.ts` writes `dist/sw.js` with:

- a version hash of every output file, and
- the exact list of files to precache. The build fails if a listed file is missing.

A new release installs in the background and waits. `src/data/updates.ts` shows the *Update ready* bar, and Reload activates the new worker, which deletes the previous release's cache. If a release raises the IndexedDB version, open tabs on the old release close their connection and reload.

## Data safety

- **Restore** (`src/data/backup.ts`) checks the whole file before changing anything:
  - It rejects non-Tally files, newer versions and rows with a broken amount or date.
  - It fills defaults for older backups.
- The restore is then written in one IndexedDB transaction, so it either fully happens or doesn't happen at all.
- The data it replaces is kept as a restore point. **Swap it back** in Settings puts it back, and is itself reversible.
- Home shows a reminder when there are 20+ expenses and no backup in 30 days.
- A crash shows a recovery screen with Reload and Download backup instead of a blank page.

## Security headers

`vercel.json` sets a strict Content-Security-Policy, HSTS, `X-Frame-Options: DENY`, COOP, `nosniff`, `no-referrer` and a Permissions-Policy. The only third-party origin allowed is `cdn.jsdelivr.net`, for the receipt-OCR engine. `vite preview` serves the same headers, so CSP problems show up locally.

## Features

- **Home**
  - Monthly spend vs budget, safe-to-spend today, and days left.
  - Swipe the dark card sideways to change month; tap it for the recap.
  - Pull down to search.
- **One-tap repeats:** tap to log. Long-press (or right-click) to log ±₹50, edit or remove.
- **Swipe rows:** left = Edit / Delete (a full swipe deletes, with a 5-second Undo). Right = Split / Repeat monthly.
- **Quick add**
  - Keypad.
  - Swipe the amount (or press ← →) to change category.
  - Swipe up on Save to log and keep going.
  - Drag the sheet handle down to close.
- **Smart add**
  - Type `lunch 350 at chutneys, split with arjun`, or several lines at once.
  - Receipt photo OCR runs in the browser with Tesseract (WebAssembly).
- **Expense detail:** edit everything, split N ways (only your share counts toward the budget), repeat monthly, exclude from budget.
- **Finances:** net worth from your accounts, 6-month spending chart, category donut.
- **Plan:** overall and category budgets; bills and subscriptions (due dates, price-rise flag, auto-log); savings goals.
- **Inbox:** captured payments wait for a one-tap confirm.
- **Recap:** month-end forecast, change vs the same point last month, biggest spend, no-spend days, logging streak.
- **Settings:** Face ID / Touch ID privacy lock (WebAuthn), JSON backup and restore, CSV export, delete all data.
- **Desktop:** sidebar layout, plus keyboard shortcuts: `N` add, `S` smart add, `/` search, `Esc` close.

### Log from iPhone Shortcuts (Action Button, Back Tap, Siri, Apple Pay)

Tally reacts to URL parameters:

| URL | Effect |
|---|---|
| `/app?log=180&note=Coffee&cat=food` | Logs ₹180 immediately |
| `/app?capture=640&merchant=Amazon` | Adds a pending payment to Inbox |
| `/app?add` / `/app?smart` | Opens Quick add / Smart add |

Links without `/app` (from before the website existed) still work; they're forwarded.

To set one up:

1. In the Shortcuts app, create a shortcut with the action **Open URLs** and one of the links above.
2. Assign it to the Action Button or Back Tap, or run it with Siri.
3. For Apple Pay, use an Automation with the **Transaction** trigger and an **Open URLs** action with `/app?capture=[Amount]&merchant=[Merchant]`.

> **iPhone storage note:** Shortcuts open links in Safari. A Home Screen web app keeps its own separate storage. If you rely on Shortcuts, turn off **Open as Web App** when adding Tally to the Home Screen, so it shares Safari's data.

## Run locally

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # unit tests for money, budget maths and both parsers
npm run build     # type-check + production build into dist/
npm run preview   # serve dist/ with production headers at http://localhost:4173
```

## Deploy to Vercel

### Option A: from your Mac, about 2 minutes

```bash
cd tally-web
npm install
npx vercel login          # once; opens the browser
npx vercel --prod         # accept the defaults (framework: Vite, output: dist)
```

You'll get a URL like `https://tally-web-yourname.vercel.app`.

### Option B: GitHub plus Vercel (auto-deploys on every push)

1. Create a GitHub repository and push this folder to it.
2. Go to https://vercel.com/new → **Import** the repo. The defaults are correct: Framework **Vite**, Build `npm run build`, Output `dist`.
3. Click **Deploy**. Every `git push` to `main` redeploys.

### Custom domain (optional)

Vercel → your project → **Settings → Domains** → add `tally.yourdomain.com` and create the DNS record it shows.

## Data and privacy

- Data lives in this browser's IndexedDB. Clearing website data deletes it, so use **Settings → Back up (JSON)** regularly.
- The app asks the browser to keep its storage persistent (`navigator.storage.persist()`).
- The only network requests after load are optional: the first receipt scan downloads the OCR engine and its English model from a public CDN.
- The Face ID lock is a privacy screen built on the device's passkey sign-in. Without a server, it does not encrypt the data.
