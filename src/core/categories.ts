export type Category =
  | "food" | "transport" | "groceries" | "shopping" | "bills" | "fun" | "health" | "other";

export const CATEGORIES: Category[] = ["food", "transport", "groceries", "shopping", "bills", "fun", "health", "other"];

/** A category from outside the app (a link, a synced row): anything unknown becomes the fallback. */
export const toCategory = (v: unknown, fallback: Category = "other"): Category =>
  CATEGORIES.includes(v as Category) ? (v as Category) : fallback;

export const CATEGORY_META: Record<Category, { title: string; icon: string; tint: string; keywords: string[] }> = {
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

/** Best category for free text; earlier words win. */
export function guessCategory(text: string): Category {
  const words = text.toLowerCase().split(/[^0-9a-zé]+/).filter(Boolean);
  for (const w of words) {
    for (const c of CATEGORIES) {
      if (CATEGORY_META[c].keywords.includes(w)) return c;
    }
  }
  return "other";
}
