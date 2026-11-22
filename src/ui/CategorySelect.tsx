import { useState, type CSSProperties } from "react";
import { categoryMeta, pickableCategories, type Category } from "../core/categories";
import { useTally } from "../data/store";
import { t } from "../i18n";
import { CategoryEditor } from "../screens/Categories";

const NEW = "__new";

/**
 * A category dropdown whose last choice, "+ New category…", makes one on the spot (name, icon,
 * colour, words that pick it) and selects it. The same category then shows up everywhere:
 * logging, bills, budgets and Reports.
 */
export function CategorySelect({ value, onChange, label, className, style }: {
  value: Category;
  onChange: (category: Category) => void;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  useTally(); // re-render when categories change
  const [adding, setAdding] = useState(false);
  return (
    <>
      <select aria-label={label} className={className} style={style} value={value}
        onChange={(e) => (e.target.value === NEW ? setAdding(true) : onChange(e.target.value))}>
        {pickableCategories(value).map((c) => <option key={c} value={c}>{categoryMeta(c).title}</option>)}
        <option disabled>──────────</option>
        <option value={NEW}>{t("+ New category…")}</option>
      </select>
      <CategoryEditor value={adding ? "new" : null} used={0} onClose={() => setAdding(false)} onSaved={onChange} />
    </>
  );
}
