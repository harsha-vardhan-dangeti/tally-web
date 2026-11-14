import { useState } from "react";
import { setSettings, useTally } from "../data/store";
import { cloudAvailable, useCloud } from "../data/cloud";
import { daysInMonth, snapshot } from "../core/budget";
import { CURRENCIES, formatMoney, parsePaise } from "../core/money";
import { LANGUAGES, t, type Lang } from "../i18n";
import { Icon } from "../ui/icons";
import { TallyMarks } from "../ui/tally";
import { Avatar, GoogleButton } from "./Account";

const EXAMPLE_BUDGET = 55_000_00;

/**
 * First run. One choice — sign in with Google (synced) or use Tally without an account — then the
 * monthly budget, with the summary card on the left showing what it means for today as you type.
 * Signed-in people whose account already has Tally data go straight to the app once it's downloaded.
 */
export function Welcome() {
  const c = useCloud();
  const { settings } = useTally();
  const [local, setLocal] = useState(false);
  const [budget, setBudget] = useState("");
  const [income, setIncome] = useState("");
  const now = new Date();
  const b = parsePaise(budget) ?? 0;
  const snap = snapshot(b || EXAMPLE_BUDGET, 0, 0, now);
  const signedIn = c.user !== null;
  // Until the first download finishes, an existing account's data may still be on its way.
  const fetching = signedIn && c.lastSyncedAt === null && c.status === "syncing";
  const step = signedIn || local ? "budget" : "choose";

  const finish = (withBudget: boolean) => setSettings({
    onboarded: true, monthlyBudget: withBudget ? b : 0, monthlyIncome: withBudget ? parsePaise(income) ?? 0 : 0,
  });

  return (
    <div className="welcome">
      <aside className="welcome-art">
        <div className="welcome-brand">
          <span className="brand-mark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 5v14M10 5v14M14 5v14M18 5v14M4 15L20 9" /></svg>
          </span>
          Tally
          <select className="welcome-lang" aria-label="Language" value={settings.language} onChange={(e) => setSettings({ language: e.target.value as Lang })}>
            {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.native}</option>)}
          </select>
        </div>
        <div className="welcome-card">
          <span className="label">{t("Safe to spend today")}</span>
          <span className="amount display num">{formatMoney(snap.leftToday)}</span>
          <TallyMarks days={daysInMonth(now)} today={now.getDate()} />
          <span className="tiny welcome-note">
            {b ? t("{amount} a month, {n} days left", { amount: formatMoney(b), n: snap.daysLeft })
              : t("Example: {amount} a month, {n} days left", { amount: formatMoney(EXAMPLE_BUDGET), n: snap.daysLeft })}
          </span>
        </div>
        <ul className="welcome-points">
          <li><Icon name="sparkle" size={18} /><span>{t("Type it the way you'd say it:")} <i>lunch 350 at chutneys</i></span></li>
          <li><Icon name="split" size={18} /><span>{t("Split bills and see who owes you")}</span></li>
          <li><Icon name="lock" size={18} /><span>{t("No bank login. Works offline.")}</span></li>
        </ul>
      </aside>

      <main className="welcome-main">
        {step === "choose" ? (
          <div className="welcome-step">
            <span className="eyebrow">{t("Welcome to Tally")}</span>
            <h1 className="display">{t("Know what's safe to spend today.")}</h1>
            <p className="t-muted">{t("Log a spend in seconds, and Tally turns your month into one number you can act on.")}</p>
            {cloudAvailable && (
              <div className="col gap8">
                <GoogleButton block label={t("Continue with Google")} />
                <span className="t-muted small">{t("Your expenses stay in step on your phone and laptop.")}</span>
                {c.message && <span className="small" style={{ color: "var(--danger)" }} role="alert">{c.message}</span>}
              </div>
            )}
            {cloudAvailable && <div className="welcome-or"><span>{t("or")}</span></div>}
            <div className="col gap8">
              <button className={`btn block${cloudAvailable ? "" : " primary"}`} onClick={() => setLocal(true)}>{t("Use without an account")}</button>
              <span className="t-muted small">{t("Everything stays in this browser. You can sign in later from Settings.")}</span>
            </div>
          </div>
        ) : (
          <form className="welcome-step" onSubmit={(e) => { e.preventDefault(); finish(true); }}>
            {signedIn ? (
              <div className="signed-in-chip">
                <Avatar user={c.user!} size={32} />
                <span className="col" style={{ minWidth: 0 }}>
                  <span className="small t-strong ellipsis">{t("Signed in as {name}", { name: c.user!.name || c.user!.email })}</span>
                  <span className="tiny t-muted ellipsis">{fetching ? t("Checking your account for Tally data…") : c.user!.email}</span>
                </span>
                <Icon name={fetching ? "repeat" : "check"} size={16} />
              </div>
            ) : (
              <button type="button" className="btn ghost small-btn welcome-back" onClick={() => setLocal(false)}><Icon name="back" size={14} />{t("Back")}</button>
            )}
            <h1 className="display">{t("What's your monthly budget?")}</h1>
            <p className="t-muted">{t("Tally divides what's left by the days left, so you always know today's number. Leave out rent if you'll add it as a bill.")}</p>
            <div className="welcome-budget-row">
              <label className="field grow">
                <span>{t("Monthly budget")}</span>
                <input type="text" inputMode="numeric" autoFocus placeholder={formatMoney(EXAMPLE_BUDGET)} value={budget} disabled={fetching}
                  onChange={(e) => setBudget(e.target.value)} className="display welcome-amount" />
              </label>
              <label className="field">
                <span>{t("Currency")}</span>
                <select value={settings.currency} disabled={fetching} onChange={(e) => setSettings({ currency: e.target.value })}>
                  {CURRENCIES.map((x) => <option key={x.code} value={x.code}>{x.code}</option>)}
                </select>
              </label>
            </div>
            <label className="field">
              <span>{t("Monthly income")} <span className="t-muted">{t("(optional)")}</span></span>
              <input type="text" inputMode="numeric" placeholder={formatMoney(85_000_00)} value={income} disabled={fetching} onChange={(e) => setIncome(e.target.value)} />
            </label>
            <div className="col gap8">
              <button className="btn primary block" type="submit" disabled={fetching || !b}>
                {b ? t("Start with {amount} for today", { amount: formatMoney(snap.leftToday) }) : t("Enter a budget to start")}
              </button>
              <button type="button" className="btn ghost" disabled={fetching} onClick={() => finish(false)}>{t("Skip for now")}</button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
