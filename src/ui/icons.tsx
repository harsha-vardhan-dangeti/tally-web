import type { Category } from "../core/categories";
import { CATEGORY_META } from "../core/categories";

const paths: Record<string, string> = {
  home: "M4 11l8-7 8 7v9H4z",
  chart: "M5 20V10M12 20V4M19 20v-7",
  target: "M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6",
  inbox: "M4 13l2.5-8h11L20 13v6H4zM4 13h5l1 2h4l1-2h5",
  plus: "M12 5v14M5 12h14",
  search: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M20 20l-3.5-3.5",
  gear: "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  trend: "M4 17l6-6 4 4 6-7M14 8h6v6",
  back: "M15 6l-6 6 6 6",
  next: "M9 6l6 6-6 6",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12l5 5 9-10",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  edit: "M4 20h4L19 9l-4-4L4 16z",
  split: "M8 7a3 3 0 1 0 0 .1M16 7a3 3 0 1 0 0 .1M3 20c0-3 2.5-5 5-5s5 2 5 5M13 15.5c1-.3 2-.5 3-.5 2.5 0 5 2 5 5",
  repeat: "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4",
  backspace: "M9 5h11v14H9l-6-7zM12 9l5 6M17 9l-5 6",
  scan: "M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M8 12h8",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  upload: "M12 20V9M7 14l5-5 5 5M5 4h14",
  food: "M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 11h1.5a2.5 2.5 0 0 1 0 5H17",
  car: "M3 8h18v9H3zM7.5 17a1.8 1.8 0 1 0 0 .1M16.5 17a1.8 1.8 0 1 0 0 .1",
  cart: "M5 8h14l-1.5 11h-11zM9 8a3 3 0 0 1 6 0",
  bag: "M6 7h12l1 13H5zM9 7a3 3 0 0 1 6 0",
  bolt: "M13 3L5 14h6l-1 7 8-11h-6z",
  sparkle: "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z",
  health: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  card: "M3 6h18v13H3zM3 10h18M16 15h2",
  mic: "M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3",
  sun: "M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2",
  alert: "M12 4l9 16H3zM12 10v4M12 17v.5",
  info: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 11v6M12 7.5v.5",
};

export function Icon({ name, size = 22, stroke = 2, label }: { name: string; size?: number; stroke?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" role={label ? "img" : undefined} aria-label={label}
      aria-hidden={label ? undefined : true}>
      <path d={paths[name] ?? paths.grid} />
    </svg>
  );
}

export function CategoryIcon({ category, size = 40 }: { category: Category; size?: number }) {
  const meta = CATEGORY_META[category];
  return (
    <span className="cat-icon" style={{ width: size, height: size, color: meta.tint, background: `color-mix(in srgb, ${meta.tint} 14%, transparent)` }}>
      <Icon name={meta.icon} size={Math.round(size * 0.5)} />
    </span>
  );
}
