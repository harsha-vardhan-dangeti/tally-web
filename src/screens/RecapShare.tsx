import { useEffect, useMemo, useState } from "react";
import { showToast, useTally } from "../data/store";
import { track } from "../data/telemetry";
import { addMonths } from "../core/budget";
import { recapData } from "../core/recap";
import { dateLocale, t } from "../i18n";
import { Sheet, Toggle } from "../ui/components";
import { Icon } from "../ui/icons";
import { drawRecap } from "../ui/recapImage";
import { shareImage } from "../ui/share";

export type RecapMonth = "this" | "last";

/** A picture of the month to post or send: this month so far, or last month in full. */
export function RecapShare({ open, initial, onClose }: { open: boolean; initial: RecapMonth; onClose: () => void }) {
  const s = useTally();
  const [which, setWhich] = useState<RecapMonth>(initial);
  const [showAmounts, setShowAmounts] = useState(false);
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setWhich(initial); }, [open, initial]);

  const now = new Date();
  const month = which === "this" ? now : addMonths(now, -1);
  const data = useMemo(() => recapData(s.expenses, month, s.settings.monthlyBudget, now),
    [s.expenses, s.settings.monthlyBudget, which, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let url = "";
    void drawRecap(data, showAmounts, location.host).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setImage({ blob, url });
    }).catch(() => setImage(null));
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [open, data, showAmounts, s.settings.language, s.settings.currency]);

  const name = `tally-${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}.png`;
  const share = async () => {
    if (!image) return;
    setBusy(true);
    const result = await shareImage(image.blob, name, t("My month with Tally"));
    setBusy(false);
    if (result === "copied") showToast(t("Saved the picture to your downloads"));
    if (result !== "cancelled" && result !== "failed") track("recap_shared", { amounts: showAmounts, month: which, via: result });
  };
  const label = (m: Date) => m.toLocaleDateString(dateLocale(), { month: "long" });

  return (
    <Sheet open={open} onClose={onClose} title={t("Share your month")}>
      <div className="row gap8" role="group" aria-label={t("Month")}>
        <button className={`chip${which === "this" ? " on" : ""}`} aria-pressed={which === "this"} onClick={() => setWhich("this")}>
          {t("{month} so far", { month: label(now) })}
        </button>
        <button className={`chip${which === "last" ? " on" : ""}`} aria-pressed={which === "last"} onClick={() => setWhich("last")}>
          {label(addMonths(now, -1))}
        </button>
      </div>
      <div className="recap-preview">
        {image ? <img src={image.url} alt={t("Recap picture for {month}", { month: label(month) })} /> : <div className="recap-placeholder" />}
      </div>
      <div className="card" style={{ background: "var(--surface-2)", padding: "0 14px" }}>
        <Toggle label={t("Show amounts")} hint={t("Off: only percentages and counts, so nobody sees how much you spend")}
          checked={showAmounts} onChange={setShowAmounts} />
      </div>
      <button className="btn primary block" disabled={!image || busy} onClick={() => void share()}>
        <Icon name="upload" size={18} />{t("Share picture")}
      </button>
    </Sheet>
  );
}
