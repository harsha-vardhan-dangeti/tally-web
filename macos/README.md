# Tally for Mac and desktop widgets

A small native macOS app (macOS 14 Sonoma or later) that runs the Tally web app. It also has three desktop widgets:

| Widget | Size | Shows |
|---|---|---|
| **Month summary** | Medium | Spent vs budget with a progress bar, safe to spend today, days left, top 3 categories |
| **Quick log** | Medium, Large | Your pinned repeats as buttons. Click **Coffee · ₹180** and it's logged, without opening Tally |
| **Upcoming bills** | Medium | The next 3 bills and subscriptions, days until due, price-rise flags, total due in 14 days |

Clicking a widget opens Tally for Mac on the matching tab.

## How the data flows (nothing leaves your Mac)

```
Tally for Mac (WKWebView running /app)
  │  IndexedDB lives inside the app, like a browser profile
  │  after every change the web app posts a small summary  ── src/data/native.ts
  ▼
App Group folder on this Mac: snapshot.json, pending-logs.json
  ▲                                   │
  │ Quick log button appends a log    │ widgets read the summary
  └───────── Desktop widgets ◀────────┘
```

- **Logging from a widget:**
  1. The widget adds the expense to `pending-logs.json` and pings the app. Its totals update straight away.
  2. If Tally is running, even with its window closed, it adds the expense within a second. Otherwise it adds it the next time Tally opens.
  3. A log leaves the queue only after the web app confirms it, and the web app ignores IDs it already has. So a log is never lost or added twice.
- **App updates:** the app loads the deployed website, so every Vercel deploy reaches the Mac app on its next launch, or right away with View → Reload (⌘R). Your data isn't touched.

## Build and install

You need **Xcode 15 or later**, free from the Mac App Store, and an Apple ID. The free Personal Team is enough to run it on your own Mac.

1. Open Xcode once. Go to **Settings → Accounts**, add your Apple ID and note the **Team ID** of your Personal Team.
2. In `Config.xcconfig`, set `DEVELOPMENT_TEAM` to that Team ID. If you like, change `BUNDLE_ID` to something unique, like `com.yourname.tally`.
3. Open `Tally.xcodeproj` and choose the **Tally** scheme, with **My Mac** as the destination.
4. Press **⌘R** to build and run. To keep a copy outside Xcode, use **Product → Archive → Distribute App → Copy App** and drag `Tally.app` into Applications.
5. Add the widgets: right-click the desktop → **Edit Widgets…** → search for **Tally** → drag them onto the desktop.

If you change `project.yml`, regenerate the project with `brew install xcodegen && xcodegen`. Changing `Config.xcconfig` doesn't need a regenerate.

## Move your data into the Mac app

The Mac app has its own storage, separate from Safari or Chrome.

1. In your browser's Tally, go to **Settings → Back up (JSON)**.
2. In Tally for Mac, go to **Settings → Restore**, choose the file and confirm.

From then on, use Tally for Mac on this Mac. The widgets follow the Mac app's data.

## Files

| Path | What |
|---|---|
| `Shared/` | Snapshot and log types, App Group storage, budget maths and ₹ formatting (ported from `src/core`). Built into both targets. |
| `TallyMac/` | The app: window, shared web view, the bridge, file pickers and downloads for backup and restore |
| `TallyWidgets/` | Widget bundle, timeline (refreshes at midnight for "safe today" and due dates), the three widgets and the Quick log intent |
| `project.yml`, `Config.xcconfig` | XcodeGen spec and your signing and URL settings |

## Limits

- **Face ID / Touch ID lock:** the in-app lock uses passkeys, which don't work inside an app's web view, so turning it on shows "Couldn't turn on the lock". Use your Mac's login password and screen lock.
- **Offline launch:** the app needs a connection to start, because it loads the deployed site. Data you've already logged stays on the Mac either way.
- **Desktop widget tinting:** macOS shows desktop widgets desaturated when another app's window is in front. That's normal.
