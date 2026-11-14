import { useState } from "react";
import { showToast } from "../data/store";
import { useCloud } from "../data/cloud";
import { sendFeedback, type Mood } from "../data/telemetry";
import { t } from "../i18n";
import { Field, Sheet } from "../ui/components";

const MOODS: { id: Mood; label: string }[] = [
  { id: "love", label: "Loving it" },
  { id: "okay", label: "It's okay" },
  { id: "problem", label: "Something's wrong" },
];

/** A note to whoever runs Tally: an idea, a bug, what's missing. */
export function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cloud = useCloud();
  const [mood, setMood] = useState<Mood | null>(null);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);
  if (open !== seen) {
    setSeen(open);
    if (open) { setMood(null); setMessage(""); setEmail(cloud.user?.email ?? ""); setError(null); }
  }

  const send = async () => {
    setBusy(true);
    setError(null);
    const ok = await sendFeedback({ message: message.trim(), mood, email });
    setBusy(false);
    if (ok) { showToast(t("Thanks, your feedback was sent")); onClose(); }
    else setError(navigator.onLine ? t("Couldn't send it. Try again in a minute.") : t("You're offline. Send it when you're connected."));
  };

  return (
    <Sheet open={open} onClose={onClose} title={t("Send feedback")}>
      <div className="row gap8 wrap" role="group" aria-label={t("How's Tally working for you?")}>
        {MOODS.map((m) => (
          <button key={m.id} className={`chip${mood === m.id ? " on" : ""}`} aria-pressed={mood === m.id} onClick={() => setMood(mood === m.id ? null : m.id)}>{t(m.label)}</button>
        ))}
      </div>
      <Field label={t("What would make Tally better?")}>
        <textarea rows={5} autoFocus value={message} maxLength={4000} onChange={(e) => setMessage(e.target.value)}
          placeholder={t("A bug, an idea, something you expected to find…")} />
      </Field>
      <Field label={t("Email for a reply (optional)")}>
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </Field>
      {error && <p className="small" role="alert" style={{ color: "var(--danger)", margin: 0 }}>{error}</p>}
      <button className="btn primary block" disabled={!message.trim() || busy} onClick={() => void send()}>{busy ? t("Sending…") : t("Send feedback")}</button>
      <p className="t-muted tiny" style={{ margin: 0 }}>{t("Only what you write here is sent, with the app version and your browser type. Don't include card or account numbers.")}</p>
    </Sheet>
  );
}
