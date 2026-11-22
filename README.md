# Tally: expense tracker website

Log a spend in 3 seconds and always know **what's safe to spend today**. It's a mobile-first web app (PWA), so you can add it to your iPhone Home Screen, and it also works on Android and desktop.

- **Account optional:** without one, data stays in the browser (IndexedDB). Sign in with Google to sync phone and laptop through Supabase. No ads or third-party trackers; anonymous usage counts can be turned off in Settings.
- **Works offline** after the first load: the service worker caches every file of a release.
- **Updates in place:** a new deploy downloads in the background and the app shows *Update ready → Reload*. Data is untouched.
- **Stack:** React 19, TypeScript, Vite, Supabase (auth + Postgres), one Vercel function. Plain CSS with light/dark themes.

## Site map

| Path | File | What it is |
|---|---|---|
| `/` | `index.html` + `src/landing/` | Public landing page with a live Smart add demo |
| `/app` | `app.html` + `src/main.tsx` | The app |
| `/privacy` | `privacy.html` | Privacy page |
| `/pay#…` | `pay.html` + `src/pay/` | Payment request opened from a shared link (details live in the URL fragment; UPI button for rupees) |
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

`vercel.json` sets a strict Content-Security-Policy, HSTS, `X-Frame-Options: DENY`, COOP, CORP, `nosniff`, `no-referrer` and a Permissions-Policy. Scripts come only from Tally itself; the receipt reader is served from `/ocr/<version>/` in the build, not a CDN. The only other host allowed is Tally's own Supabase project; if the project changes, update `connect-src`. `vite preview` serves the same headers, so CSP problems show up locally.

The rules every change must keep, the automatic checks that enforce them (`npm test`, and the post-build scan in `npm run build` that blocks a deploy), and the dashboard settings to review are in [SECURITY.md](SECURITY.md).

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
- **Home:** safe to spend today (with the month drawn as tally marks), cash flow, what's due in 14 days, budgets, net worth and recent activity.
- **Activity:** every expense by month, as a list or calendar, filtered by category.
- **Reports:** cash flow for any period (where the money went, income vs spending by month, savings rate), spending grouped by category, place or payment method, filters, CSV export, and a month-in-detail view.
- **Accounts:** net worth over time from month-end balances, accounts grouped by type, and transfers between accounts.
- **Plan:** overall and category budgets; bills and subscriptions (due dates, price-rise flag, auto-log); repeating charges found in your spending (`src/core/recurring.ts`); savings goals.
- **People** (`src/core/people.ts`): who owes whom, worked out from split expenses ("split with ravi, priya", and who paid) plus money lent, borrowed and paid back. "Ask to pay" shares a message with a `/pay` link that opens a UPI app with the amount filled in. Money lent or paid back can name the account it left or came into, which moves that account's balance; Accounts → Transfer → "A person" does the same.
- **Splitwise groups** (`src/core/groups.ts`, `src/screens/Groups.tsx`, Accounts → Splitwise groups, or Add account → Type → "Splitwise group…"): a group (flat, trip) has a name and members (`Settings.groups`, synced with settings). Add a bill with who paid and who it's split between, equally. From your side it's stored the way Tally already stores splits, with `group` set (`planGroupBill`): you paid and you're in it → one split expense; someone else paid and you're in it → a split expense with `paidBy`; you paid for others only → money lent to each; a bill between others doesn't change anything for you, so it can't be added. The group shows where you stand with each member (`groupStanding`), every bill and payment, and Settle up, which records a payment in the group with the account it went through. Balances join up with People by name. Deleting a group leaves its bills as ordinary splits.
- **Splitwise import** (`src/core/splitwise.ts`, People → Import from Splitwise): reads a group's "Export as spreadsheet" CSV, for bringing in history from Splitwise. Your share of each expense goes to spending and what each member owes you goes to People. Each row has a fixed ID, so importing next month's export only adds new rows; rows that look already logged in Tally start unticked.
- **Loans & EMIs** (Plan, `src/core/loans.ts`): EMI worked out from amount, rate and months; what's left from the schedule; each EMI can add itself to expenses; loans count as debts in net worth.
- **Share your month:** a 1080×1350 recap picture (`src/ui/recapImage.ts`), with amounts hidden unless you turn them on. Offered on Home in the first week of each month.
- **Languages and currencies:** English, Hindi, Telugu and Tamil (`src/i18n/`, English text is the key; `i18n.test.ts` fails if a string is missing), 17 home currencies, and amounts paid abroad with a remembered rate.
- **Feedback, usage counts and crash reports:** sent to `api/collect.ts`, which validates them and writes to the `usage_events`, `client_errors` and `feedback` tables (no browser access). See "Reading feedback and usage" below.
- **Month start day** (Settings → Month starts on): budget months can run from payday, e.g. 25 Oct – 24 Nov. `monthRange`, `addMonths`, `daysInMonth` and `dayOfMonth` in `src/core/budget.ts` follow it everywhere.
- **Your own categories, from anywhere:** every category dropdown (bills, EMIs, the expense page, repeats, rules, imports, the inbox) ends with **+ New category…**, and Quick add's grid ends with **+ New**. Each opens the category editor (name, icon, colour, words that pick it). The new category is selected straight away, and the form you were filling in keeps what you typed (`src/ui/CategorySelect.tsx`).
- **Subcategories and tags:** subcategories per category (Settings → Categories), picked in Quick add or the expense; `#tags` in Smart add or on the expense, searchable (`#goa`) and filterable in Reports. Reports can group by subcategory or tag, and has weekly and yearly periods.
- **Calculator:** amount fields take sums (`250+120`, `1800/4`), and Quick add's keypad has + − × ÷ (`evaluate` in `src/core/money.ts`, no eval).
- **Budgets per week, month or year** for each category.
- **Accounts that follow transactions:** an account can update from expenses paid from it, income into it and money lent or borrowed through it (matched by name), from the balance you last entered (`liveBalance` in `src/data/store.ts`). Anything recorded after that balance moves it, whatever its date, and deleting it puts the balance back; things recorded before it are taken to be in it. Statement imports go by their date. A backdated entry can be marked "Already in the balance" (`inBalance`, `applies`). Transfers count the same way instead of rewriting balances. Credit cards take a statement day and due day and show the bill and due date (`src/core/cards.ts`), which also appears in Coming up. Accounts can hold another currency, converted for net worth.
- **Link everything to accounts:** Accounts and Home show how many entries went through something that isn't one of your accounts ("UPI", "Cash", "Credit card", nothing). "Link them" groups them by method with a suggested account each (`unlinkedGroups`, `suggestAccount`), previews every balance before and after (`previewLink`), and links expenses, income, money lent or borrowed, and the bills, EMIs and regular incomes paid that way (`linkGroups`, `src/ui/LinkAccountsSheet.tsx`), with Undo. A method can be remembered ("UPI → HDFC Bank", `settings.methodAccounts`) so future entries land there.
- **Each account on its own:** tap a bank, cash or investment account in Accounts for its balance, money in and out this month, and every income, expense, transfer and loan to a person through it (All / In / Out), newest first (`accountItems`, `src/screens/AccountSheet.tsx`). Add income to it from there; tap an income to edit it or an expense to open it. Entries dated before you entered the balance are marked as already in it (`balanceEnteredAt`).
- **Paying back part of it:** the pay-back form offers "All ₹X" or "Part of it" and warns when an amount is more than what's owed (the rest flips who owes whom). Pay-backs are matched to the oldest open loan or borrowing first, so each one in a person's history shows "₹2,000 of ₹5,000 paid back · ₹3,000 left" or "Paid back" (`payBackProgress` in `src/core/people.ts`).
- **Lending through an account:** money lent, borrowed or paid back starts on the account you last used for it (else your default if it's an account, else your first bank or cash account, `likelyAccount`), says whether that balance moves, and offers to apply a backdated entry to it. People shows a prompt for entries that went through "UPI" or no account, to move them onto an account (`linkLedger`, `src/ui/LedgerLinkSheet.tsx`); Splitwise shares are left out.
- **Income into an account:** income picks the account it lands in from the same list as expenses (defaulting to where your last income went), and says whether that balance will move. "Bank" means your bank when you have one bank account (`resolveAccount`). Income or regular income going into "Bank", "UPI" or nothing shows a prompt on Home and Accounts to move it into an account (`linkIncomes`, `src/ui/IncomeLinkSheet.tsx`).
- **Credit card limits and auto-pay:** each card can have a limit (used, available and % used in Accounts and on Home; Quick add and the expense sheet show the credit left and warn before going over; a heads-up at 80% and 100%). A card's bill can pay itself from a bank account on the due date, recorded as a transfer (`runDueCardPayments`).
- **Each card on its own:** tap a card in Accounts (or on Home) for what you owe on it, the bill and due date, the credit left, spending statement by statement (calendar months without a statement day), this statement by category, every charge and bill payment (`cardActivity`, `src/ui/CardSheet.tsx`). Home's Credit cards panel shows what you owe on each card and card spending over 6 months (`cardSpendByMonth`). Expenses paid with plain "Credit card" go on your card when you have one; with several, Smart add matches the card named in the text ("450 swiggy hdfc card"), and the card sheet moves older "Credit card" expenses onto a card, optionally adding the ones from before its balance was set (`linkToCard`).
- **Card purchases on EMI:** "Convert to EMI" on a card expense (months, interest or no-cost, processing fee). The purchase leaves the card's balance and the budget; each EMI is charged to the card on its date and counts toward that month's budget; unbilled principal stays blocked on the card's limit (`convertToEmi`, `cardEmiOutstanding`). Undo puts the purchase back.
- **From your accounts** (Plan): the next 30 days of bills, EMIs, repeating transfers, card bills and regular income under the account each uses, with the balance it leaves and a warning before a shortfall or a card over its limit (`scheduledFlows` in `src/data/store.ts`). Bills, EMIs and regular income pick their account from the same list as Quick add (`src/ui/AccountSelect.tsx`).
- **Repeats:** bills every week, month or year (`src/core/schedule.ts`) and transfers that repeat monthly, like a SIP.
- **Investments and SIPs:** an investment account keeps its value and what's been put in (each SIP adds to it), so Accounts and Home show returns. SIPs are listed per fund with the investment and bank account they use.
- **Excel export** (Settings → Export Excel): expenses, income, transfers, accounts, loans and people as one workbook.
- **App lock delay:** ask again on leaving, or after 1, 5, 15 or 60 minutes away.
- **Inbox:** captured payments wait for a one-tap confirm.
- **Recap:** month-end forecast, change vs the same point last month, biggest spend, no-spend days, logging streak.
- **Regular income:** salary and other monthly income add themselves on their day (Plan → Regular income, or "Repeats every month" on an income entry).
- **Bank statement import:** Settings → Import bank statement reads PDF, Excel or CSV statements from net banking (HDFC, ICICI, SBI, Axis and similar layouts), in the browser.
  - Withdrawals become expenses and deposits become income, with a category and a readable name for each.
  - Likely duplicates of hand-logged entries and transfers (card bills, own-account moves, SIPs) start unticked.
  - Re-importing the same statement never adds a row twice.
  - PDFs are read with pdf.js (`src/core/pdfTable.ts` rebuilds the table from word positions); password-protected PDFs ask for the password. Scanned PDFs have no text and can't be read.
  - The column layout you confirm for a bank is remembered for next time.
- **Rules:** Settings → Rules, or "Always" while importing or editing an expense: "Swiggy is always Food", optionally with a cleaner name.
- **Account:** optional Google sign-in syncs phone and laptop. **Delete account** removes the account and its synced data.
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

- **Signed out:** data lives in this browser's IndexedDB. Clearing website data deletes it, so use **Settings → Back up (JSON)** regularly. The app asks the browser to keep its storage persistent.
- **Signed in:** the browser keeps its working copy and also syncs to the `sync_records` table in Supabase (AWS us-east-1). Row-level security lets each person read and write only their own rows.
- **Deleting:** Settings → Account → **Delete account** calls `api/delete-account.ts`, which signs out every session and deletes the user; their rows go with it.
- The first receipt scan downloads the OCR engine and its English model from jsDelivr. Photos are read on the device.
- The Face ID lock is a privacy screen built on the device's passkey sign-in. It does not encrypt the data.

## Sign-in and sync

| Piece | Where |
|---|---|
| Sync rules (pure, tested) | `src/data/syncCore.ts` |
| Sign-in, outbox, push/pull | `src/data/cloud.ts` |
| Account UI | `src/screens/Account.tsx` |
| Database schema, RLS, `sync_push()` | `supabase/migrations/` |
| Account deletion | `api/delete-account.ts` (needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY` on Vercel) |

- Every local write lands in the `outbox` store, uploads through `sync_push()` (the newest edit wins), and other devices pull rows changed since their last server timestamp.
- On a device's first sign-in, the account's data comes first, then anything only that device has is added.
- **Setup:** the Supabase integration on Vercel provides `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, which are built into the app. Run `vercel env pull` for local development.
- **Migrations:** apply with `supabase db push --db-url "$POSTGRES_URL_NON_POOLING"`.
- **Google:** enable the Google provider in Supabase with an OAuth client whose redirect URI is `https://<project>.supabase.co/auth/v1/callback`. Allow the site's URLs under Authentication → URL Configuration.


## Reading feedback and usage

Run these in the Supabase dashboard's SQL editor. Browsers can't read these tables; only the dashboard and `api/collect.ts` (secret key) can.

```sql
-- Newest feedback
select created_at, mood, message, email from feedback order by created_at desc limit 50;

-- Daily active devices and what they did
select * from usage_daily where day > current_date - 14 order by day desc, devices desc;

-- Crashes by message, last 7 days
select message, count(*), max(created_at) from client_errors
where created_at > now() - interval '7 days' group by 1 order by 2 desc;
```

Usage and crash rows older than a year are deleted by `api/collect.ts`.
