import { useState } from "react";
import { deleteCategory, saveCategory, showToast, useTally } from "../data/store";
import {
  allCategories, CATEGORY_ICONS, CATEGORY_TINTS, isCustomId, newCategoryId, type CategoryDef,
} from "../core/categories";
import { CategoryIcon, Icon } from "../ui/icons";
import { Field, Sheet, Toggle } from "../ui/components";

/** Settings → Categories: add your own, rename or recolour any, hide the ones you don't use. */
export function CategoriesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useTally();
  const [editing, setEditing] = useState<CategoryDef | "new" | null>(null);
  const used = (id: string) => s.expenses.filter((e) => e.category === id).length;

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Categories">
        <p className="t-muted small" style={{ margin: 0 }}>Hidden categories stay on the expenses that have them but aren't offered when you log.</p>
        <div className="card flush divided" style={{ background: "var(--surface-2)" }}>
          {allCategories().map((c) => (
            <button key={c.id} className="list-row" style={{ width: "100%", border: 0, background: "none", textAlign: "left", opacity: c.hidden ? 0.6 : 1 }}
              onClick={() => setEditing(c)}>
              <CategoryIcon category={c.id} size={32} />
              <span className="grow col">
                <span className="t-strong">{c.title}</span>
                <span className="t-muted tiny">{used(c.id)} expense{used(c.id) === 1 ? "" : "s"}{isCustomId(c.id) ? " · yours" : ""}</span>
              </span>
              {c.hidden && <span className="tag">Hidden</span>}
              <Icon name="next" size={16} />
            </button>
          ))}
        </div>
        <button className="btn primary block" onClick={() => setEditing("new")}><Icon name="plus" size={18} />Add category</button>
      </Sheet>
      <CategoryEditor value={editing} used={editing && editing !== "new" ? used(editing.id) : 0} onClose={() => setEditing(null)} />
    </>
  );
}

function CategoryEditor({ value, used, onClose }: { value: CategoryDef | "new" | null; used: number; onClose: () => void }) {
  const def = value && value !== "new" ? value : null;
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("grid");
  const [tint, setTint] = useState(CATEGORY_TINTS[0].tint);
  const [keywords, setKeywords] = useState("");
  const [hidden, setHidden] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [seen, setSeen] = useState<typeof value>(null);
  if (value !== seen) {
    setSeen(value);
    setTitle(def?.title ?? "");
    setIcon(def?.icon ?? "grid");
    setTint(def?.tint ?? CATEGORY_TINTS[6].tint);
    setKeywords(def?.keywords.join(", ") ?? "");
    setHidden(def?.hidden ?? false);
    setConfirmDelete(false);
  }
  const custom = !def || isCustomId(def.id);
  const name = title.trim();
  const clash = allCategories().some((c) => c.id !== def?.id && c.title.toLowerCase() === name.toLowerCase());

  const save = () => {
    saveCategory({
      id: def?.id ?? newCategoryId(), title: name, icon, tint, hidden,
      keywords: keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean),
    });
    showToast(def ? `Saved ${name}` : `Added ${name}`);
    onClose();
  };

  return (
    <Sheet open={value !== null} onClose={onClose} title={def ? `Edit ${def.title}` : "New category"}>
      <Field label="Name">
        <input type="text" value={title} maxLength={30} onChange={(e) => setTitle(e.target.value)} placeholder="Gym, Pets, Kids…" />
      </Field>
      {clash && <span className="small" style={{ color: "var(--danger)" }}>There's already a category called {name}.</span>}

      <div className="col gap8">
        <span className="t-strong small">Icon</span>
        <div className="icon-pick" role="group" aria-label="Icon">
          {CATEGORY_ICONS.map((i) => (
            <button key={i} className="icon-opt" aria-pressed={i === icon} aria-label={i} onClick={() => setIcon(i)} style={{ color: i === icon ? tint : undefined }}>
              <Icon name={i} size={20} />
            </button>
          ))}
        </div>
      </div>

      <div className="col gap8">
        <span className="t-strong small">Colour</span>
        <div className="icon-pick" role="group" aria-label="Colour">
          {CATEGORY_TINTS.map((t) => (
            <button key={t.tint} className="swatch" aria-pressed={t.tint === tint} aria-label={t.name} title={t.name} onClick={() => setTint(t.tint)}
              style={{ background: t.tint }}>
              {t.tint === tint && <Icon name="check" size={16} stroke={2.6} />}
            </button>
          ))}
        </div>
      </div>

      <Field label="Words that pick it">
        <input type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="gym, protein, cult" />
      </Field>
      <p className="t-muted tiny" style={{ margin: 0 }}>
        Smart add, receipts and bank imports put an expense here when these words appear{custom ? ", as well as the category's name" : ""}.
      </p>

      {def?.id !== "other" && (
        <div className="card" style={{ background: "var(--surface-2)", padding: "0 14px" }}>
          <Toggle label="Offer when logging" hint="Turn off to hide it from the category choices." checked={!hidden} onChange={(v) => setHidden(!v)} />
        </div>
      )}

      <button className="btn primary block" disabled={!name || clash} onClick={save}>{def ? "Save" : "Add category"}</button>

      {def && isCustomId(def.id) && (confirmDelete ? (
        <div className="card col gap8" style={{ background: "var(--danger-soft)" }} role="alertdialog" aria-label="Confirm delete">
          <span className="small t-strong" style={{ color: "var(--danger)" }}>
            Delete {def.title}?{used ? ` Its ${used} expense${used === 1 ? "" : "s"} move to Other.` : ""}
          </span>
          <div className="row gap8">
            <button className="btn danger" onClick={() => { void deleteCategory(def.id); showToast(`Deleted ${def.title}`); onClose(); }}>Delete</button>
            <button className="btn" onClick={() => setConfirmDelete(false)}>Keep it</button>
          </div>
        </div>
      ) : (
        <button className="btn danger block" onClick={() => setConfirmDelete(true)}>Delete category</button>
      ))}
    </Sheet>
  );
}
