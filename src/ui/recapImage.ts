import type { RecapData } from "../core/recap";
import { categoryMeta } from "../core/categories";
import { formatMoney } from "../core/money";
import { dateLocale, t } from "../i18n";
import { monthLabel } from "../core/budget";

/**
 * Draws a month's recap as a 1080×1350 PNG (a portrait post for Instagram or a WhatsApp status).
 * With `showAmounts` off it shares only percentages and counts, never money.
 */

const W = 1080, H = 1350, PAD = 84;
const C = { bg: "#161C2A", ink: "#F7F4EC", muted: "#AEB6C6", fill: "#262E40", brand: "#F2B33D", brandInk: "#1C1503" };
const DISPLAY = '"Bricolage Grotesque Variable", "Hanken Grotesk Variable", system-ui, sans-serif';
const BODY = '"Hanken Grotesk Variable", system-ui, sans-serif';

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Sets the font, shrinking it until `text` fits in `max` pixels. */
function fit(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, family: string, max: number) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${family}`; s -= 2; } while (ctx.measureText(text).width > max && s > 18);
}

function tallyMarks(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string, groups: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = h / 9;
  ctx.lineCap = "round";
  const gap = h * 0.32;
  for (let g = 0; g < groups; g++) {
    const gx = x + g * (gap * 5.2);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { ctx.moveTo(gx + i * gap, y); ctx.lineTo(gx + i * gap, y + h); }
    ctx.moveTo(gx - gap * 0.4, y + h * 0.72);
    ctx.lineTo(gx + gap * 3.4, y + h * 0.28);
    ctx.stroke();
  }
}

export async function drawRecap(r: RecapData, showAmounts: boolean, host: string): Promise<Blob> {
  // The fonts are bundled with the app; make sure they're loaded before drawing with them.
  await Promise.all([`800 100px ${DISPLAY}`, `700 40px ${BODY}`, `500 30px ${BODY}`].map((f) => document.fonts?.load(f).catch(() => null)));
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Brand
  ctx.fillStyle = C.brand;
  rounded(ctx, PAD, PAD, 64, 64, 18);
  ctx.fill();
  tallyMarks(ctx, PAD + 17, PAD + 18, 28, C.brandInk, 1);
  ctx.fillStyle = C.ink;
  ctx.font = `700 40px ${BODY}`;
  ctx.fillText("Tally", PAD + 84, PAD + 46);

  // Title
  const monthName = monthLabel(r.month, dateLocale());
  const title = r.complete ? t("My {month}", { month: monthName }) : t("{month} so far", { month: monthName });
  ctx.fillStyle = C.ink;
  fit(ctx, title, 800, 120, DISPLAY, W - PAD * 2);
  ctx.fillText(title, PAD, 330);

  // Headline
  const pct = r.budget ? Math.round((r.spent / r.budget) * 100) : null;
  let headline: string;
  if (showAmounts) {
    headline = r.budget ? t("Spent {spent} of {budget}", { spent: formatMoney(r.spent), budget: formatMoney(r.budget) }) : t("Spent {spent}", { spent: formatMoney(r.spent) });
  } else if (pct !== null && r.complete) {
    headline = pct <= 100 ? t("Stayed {n}% under budget", { n: 100 - pct }) : t("Went {n}% over budget", { n: pct - 100 });
  } else if (pct !== null) {
    headline = t("Used {n}% of my budget", { n: pct });
  } else {
    headline = t("{n} expenses logged", { n: r.count });
  }
  ctx.fillStyle = C.brand;
  fit(ctx, headline, 700, 50, BODY, W - PAD * 2);
  ctx.fillText(headline, PAD, 412);

  // Where it went
  let y = 520;
  ctx.fillStyle = C.muted;
  ctx.font = `500 30px ${BODY}`;
  ctx.fillText(t("Where it went"), PAD, y);
  y += 30;
  const barW = W - PAD * 2;
  // Four rows fit above the tiles: the top three and, when there are more, everything else together.
  const rows = r.top.length <= 4 ? r.top : [...r.top.slice(0, 3), r.top.slice(3).reduce((o, c) => ({ id: "other", amount: o.amount + c.amount, share: o.share + c.share }), { id: "other", amount: 0, share: 0 })];
  rows.forEach((c, i) => {
    y += 60;
    const name = c.id === "other" ? t("Everything else") : categoryMeta(c.id).title;
    const right = showAmounts ? `${formatMoney(c.amount)} · ${Math.round(c.share * 100)}%` : `${Math.round(c.share * 100)}%`;
    ctx.font = `600 36px ${BODY}`;
    const rightW = ctx.measureText(right).width;
    ctx.fillStyle = C.ink;
    fit(ctx, name, 600, 36, BODY, barW - rightW - 24);
    ctx.fillText(name, PAD, y);
    ctx.font = `600 36px ${BODY}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(right, W - PAD - rightW, y);
    ctx.fillStyle = C.fill;
    rounded(ctx, PAD, y + 16, barW, 16, 8);
    ctx.fill();
    ctx.globalAlpha = [1, 0.8, 0.62, 0.46][i];
    ctx.fillStyle = C.brand;
    rounded(ctx, PAD, y + 16, Math.max(16, barW * c.share), 16, 8);
    ctx.fill();
    ctx.globalAlpha = 1;
    y += 36;
  });
  if (!r.top.length) {
    ctx.fillStyle = C.ink;
    ctx.font = `500 36px ${BODY}`;
    ctx.fillText(t("Nothing logged yet"), PAD, y + 70);
  }

  // Stats
  const tiles: [string, string][] = [
    [String(r.noSpendDays), t("No-spend days")],
    [String(r.count), t("Expenses logged")],
    showAmounts ? [formatMoney(Math.round(r.spent / Math.max(r.days, 1))), t("A day on average")] : [String(r.days), t("Days tracked")],
  ];
  const gap = 24, tileW = (W - PAD * 2 - gap * 2) / 3, tileH = 178, tileY = H - 200 - tileH;
  tiles.forEach(([value, label], i) => {
    const x = PAD + i * (tileW + gap);
    ctx.fillStyle = C.fill;
    rounded(ctx, x, tileY, tileW, tileH, 28);
    ctx.fill();
    ctx.fillStyle = C.ink;
    fit(ctx, value, 800, 68, DISPLAY, tileW - 48);
    ctx.fillText(value, x + 26, tileY + 92);
    ctx.fillStyle = C.muted;
    fit(ctx, label, 500, 26, BODY, tileW - 48);
    ctx.fillText(label, x + 26, tileY + 140);
  });

  // Footer
  tallyMarks(ctx, PAD + 6, H - 112, 34, C.brand, 3);
  ctx.fillStyle = C.muted;
  ctx.font = `500 28px ${BODY}`;
  const foot = t("Made with Tally · {host}", { host });
  ctx.fillText(foot, W - PAD - ctx.measureText(foot).width, H - 84);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw the recap"))), "image/png"));
}
