/** A built-in category ("food") or one the user added ("c-…"). */
export type Category = string;
type BuiltIn = "food" | "transport" | "groceries" | "shopping" | "bills" | "fun" | "health" | "other";

const BUILT_IN: BuiltIn[] = ["food", "transport", "groceries", "shopping", "bills", "fun", "health", "other"];

const CATEGORY_META: Record<BuiltIn, { title: string; icon: string; tint: string; keywords: string[] }> = {
  food: {
    title: "Food", icon: "food", tint: "#B34D0D",
    keywords: ["food", "lunch", "dinner", "breakfast", "brunch", "coffee", "tea", "chai", "cafe", "café", "snack", "snacks",
      "restaurant", "swiggy", "zomato", "biryani", "pizza", "burger", "meal", "starbucks", "chutneys", "dosa", "juice", "bakery"],
  },
  transport: {
    title: "Transport", icon: "car", tint: "#1D4FA8",
    keywords: ["auto", "uber", "ola", "rapido", "cab", "taxi", "metro", "bus", "petrol", "diesel", "fuel", "train", "flight",
      "parking", "toll", "travel", "irctc"],
  },
  groceries: {
    title: "Groceries", icon: "cart", tint: "#0B7A47",
    keywords: ["grocery", "groceries", "vegetables", "veggies", "fruits", "milk", "ratnadeep", "dmart", "bigbasket", "blinkit",
      "zepto", "instamart", "supermarket", "kirana"],
  },
  shopping: {
    title: "Shopping", icon: "bag", tint: "#B4410F",
    keywords: ["shopping", "amazon", "flipkart", "myntra", "ajio", "clothes", "shirt", "shoes", "nykaa", "decathlon", "gift",
      "electronics"],
  },
  bills: {
    title: "Bills", icon: "bolt", tint: "#7A4BC2",
    keywords: ["rent", "electricity", "wifi", "internet", "broadband", "recharge", "bill", "postpaid", "gas", "water",
      "maintenance", "emi", "insurance", "subscription"],
  },
  fun: {
    title: "Fun", icon: "sparkle", tint: "#BF2E73",
    keywords: ["movie", "movies", "netflix", "spotify", "concert", "game", "games", "party", "drinks", "bar", "pvr",
      "bookmyshow", "outing"],
  },
  health: {
    title: "Health", icon: "health", tint: "#C2321F",
    keywords: ["medicine", "medicines", "pharmacy", "doctor", "hospital", "clinic", "gym", "apollo", "medplus", "lab", "physio"],
  },
  other: { title: "Other", icon: "grid", tint: "#565C69", keywords: [] },
};

// ---------- the user's categories ----------

/** Icons and colours offered for categories. Colours are dark enough for white-on-tint and tint-on-white. */
export const CATEGORY_ICONS = [
  "food", "car", "cart", "bag", "bolt", "sparkle", "health", "home", "gift", "book", "plane", "phone", "dumbbell", "card", "sun", "grid",
];
export const CATEGORY_TINTS: { tint: string; name: string }[] = [
  { tint: "#B34D0D", name: "Rust" }, { tint: "#1D4FA8", name: "Blue" }, { tint: "#0B7A47", name: "Green" },
  { tint: "#7A4BC2", name: "Purple" }, { tint: "#BF2E73", name: "Pink" }, { tint: "#C2321F", name: "Red" },
  { tint: "#0E7C86", name: "Teal" }, { tint: "#8A5A2B", name: "Brown" }, { tint: "#4B4FC2", name: "Indigo" },
  { tint: "#6B7A12", name: "Olive" }, { tint: "#A86A00", name: "Amber" }, { tint: "#565C69", name: "Grey" },
];

/** How a category is stored in settings: a built-in with the user's changes, or one they added. */
export interface CategoryDef {
  id: Category;
  title: string;
  icon: string;
  tint: string;
  /** Extra words that make Smart add, receipts and imports pick this category. */
  keywords: string[];
  /** Left out of category pickers; existing expenses keep it. */
  hidden: boolean;
}

const MAX_CUSTOM = 40;
const isBuiltIn = (v: unknown): v is BuiltIn => BUILT_IN.includes(v as BuiltIn);
export const isCustomId = (v: unknown): v is string => typeof v === "string" && /^c-[a-z0-9-]{1,40}$/.test(v);
export const newCategoryId = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const builtInDef = (id: BuiltIn): CategoryDef => {
  const m = CATEGORY_META[id];
  return { id, title: m.title, icon: m.icon, tint: m.tint, keywords: [], hidden: false };
};

/**
 * The full category list from what settings hold: every built-in (with the user's changes) in a fixed
 * order, then the user's own. Settings arrive from sync and backups, so every field is checked.
 */
export function resolveCategories(saved: unknown): CategoryDef[] {
  const rows = Array.isArray(saved) ? saved : [];
  const read = (r: unknown): CategoryDef | null => {
    if (!r || typeof r !== "object") return null;
    const v = r as Record<string, unknown>;
    if (!isBuiltIn(v.id) && !isCustomId(v.id)) return null;
    const base = isBuiltIn(v.id) ? builtInDef(v.id) : null;
    const title = typeof v.title === "string" ? v.title.trim().slice(0, 30) : "";
    if (!title && !base) return null;
    return {
      id: v.id,
      title: title || base!.title,
      icon: CATEGORY_ICONS.includes(v.icon as string) ? (v.icon as string) : base?.icon ?? "grid",
      tint: CATEGORY_TINTS.some((t) => t.tint === v.tint) ? (v.tint as string) : base?.tint ?? "#565C69",
      keywords: Array.isArray(v.keywords)
        ? [...new Set(v.keywords.filter((k): k is string => typeof k === "string").map((k) => k.trim().toLowerCase()).filter(Boolean))].slice(0, 30)
        : [],
      // "Other" is where unknown and deleted categories go, so it's always available.
      hidden: v.hidden === true && v.id !== "other",
    };
  };
  const byId = new Map<string, CategoryDef>();
  for (const r of rows) {
    const d = read(r);
    if (d && !byId.has(d.id)) byId.set(d.id, d);
  }
  const custom = [...byId.values()].filter((d) => isCustomId(d.id)).slice(0, MAX_CUSTOM);
  return [...BUILT_IN.map((id) => byId.get(id) ?? builtInDef(id)), ...custom];
}

let defs: CategoryDef[] = resolveCategories([]);

/** Called by the store whenever settings change. */
export function setCategoryDefs(saved: unknown) { defs = resolveCategories(saved); }

export const allCategories = (): CategoryDef[] => defs;
export const categoryMeta = (id: Category): CategoryDef => defs.find((d) => d.id === id) ?? defs.find((d) => d.id === "other")!;
/** Categories to choose from: the visible ones, plus `current` if it's hidden. */
export const pickableCategories = (current?: Category): Category[] => defs.filter((d) => !d.hidden || d.id === current).map((d) => d.id);
export const isCategory = (v: unknown): v is Category => typeof v === "string" && defs.some((d) => d.id === v);

/** A category from outside the app (a link, a synced row): anything unknown becomes the fallback. */
export const toCategory = (v: unknown, fallback: Category = "other"): Category => (isCategory(v) ? v : fallback);

/** Best category for free text; earlier words win. The user's own categories are checked first. */
export function guessCategory(text: string): Category {
  const words = text.toLowerCase().split(/[^0-9a-zé]+/).filter(Boolean);
  const order = [...defs.filter((d) => isCustomId(d.id)), ...defs.filter((d) => !isCustomId(d.id))].filter((d) => !d.hidden);
  const keywordsOf = (d: CategoryDef) => [
    ...d.keywords, ...(isBuiltIn(d.id) ? CATEGORY_META[d.id].keywords : d.title.toLowerCase().split(/[^0-9a-zé]+/).filter(Boolean)),
  ];
  for (const w of words) {
    for (const d of order) {
      if (keywordsOf(d).includes(w)) return d.id;
    }
  }
  return "other";
}
