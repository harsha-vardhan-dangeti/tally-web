import { useState } from "react";
import { deleteRule, saveRule, showToast, uid, useTally } from "../data/store";
import { categoryMeta, pickableCategories, type Category } from "../core/categories";
import type { Rule } from "../core/rules";
import { CategoryIcon, Icon } from "../ui/icons";
import { Empty, Field, Sheet } from "../ui/components";

/** Settings → Rules: "when a payment mentions …, it's …". Used by Smart add, captures and bank imports. */
export function RulesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useTally();
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  return (
    <>
      <Sheet open={open} onClose={onClose} title="Rules">
        <p className="t-muted small" style={{ margin: 0 }}>
          When a payment's description mentions these words, Tally files it under the category and name you choose. Rules come before Tally's own guesses.
        </p>
        {s.settings.rules.length === 0 ? (
          <Empty title="No rules yet" body="Add one here, or tap “Always” after changing a category while importing a statement." />
        ) : (
          <div className="card flush divided" style={{ background: "var(--surface-2)" }}>
            {s.settings.rules.map((r) => (
              <button key={r.id} className="list-row row-btn" onClick={() => setEditing(r)}>
                <CategoryIcon category={r.category} size={32} />
                <span className="grow col" style={{ minWidth: 0 }}>
                  <span className="t-strong ellipsis">“{r.match}”</span>
                  <span className="t-muted tiny ellipsis">{categoryMeta(r.category).title}{r.rename ? ` · shown as ${r.rename}` : ""}</span>
                </span>
                <Icon name="next" size={16} />
              </button>
            ))}
          </div>
        )}
        <button className="btn primary block" onClick={() => setEditing("new")}><Icon name="plus" size={18} />Add rule</button>
      </Sheet>
      <RuleEditor value={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function RuleEditor({ value, onClose }: { value: Rule | "new" | null; onClose: () => void }) {
  const rule = value && value !== "new" ? value : null;
  const [match, setMatch] = useState("");
  const [category, setCategory] = useState<Category>("food");
  const [rename, setRename] = useState("");
  const [seen, setSeen] = useState<typeof value>(null);
  if (value !== seen) {
    setSeen(value);
    setMatch(rule?.match ?? "");
    setCategory(rule?.category ?? "food");
    setRename(rule?.rename ?? "");
  }
  const text = match.trim().toLowerCase();
  return (
    <Sheet open={value !== null} onClose={onClose} title={rule ? "Edit rule" : "New rule"}>
      <Field label="When the description mentions">
        <input type="text" value={match} maxLength={40} onChange={(e) => setMatch(e.target.value)} placeholder="swiggy" autoFocus />
      </Field>
      <Field label="File it under">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {pickableCategories(category).map((c) => <option key={c} value={c}>{categoryMeta(c).title}</option>)}
        </select>
      </Field>
      <Field label="Show it as (optional)">
        <input type="text" value={rename} maxLength={40} onChange={(e) => setRename(e.target.value)} placeholder="Swiggy" />
      </Field>
      <p className="t-muted tiny" style={{ margin: 0 }}>Matches whole words from their start, ignoring capitals: “swiggy” matches “UPI/SWIGGY123”, not “myswiggy”.</p>
      <button className="btn primary block" disabled={text.length < 2} onClick={() => {
        saveRule({ id: rule?.id ?? uid(), match: text, category, rename: rename.trim() });
        showToast(rule ? "Rule saved" : `Rule added: “${text}” → ${categoryMeta(category).title}`);
        onClose();
      }}>{rule ? "Save" : "Add rule"}</button>
      {rule && <button className="btn danger block" onClick={() => { deleteRule(rule.id); showToast("Rule deleted"); onClose(); }}>Delete rule</button>}
    </Sheet>
  );
}
