import { deleteLedgerEntry, deleteTransfer, useTally, type Income } from "../data/store";
import type { ActivityItem } from "../data/activity";
import { formatMoney } from "../core/money";
import { Icon } from "../ui/icons";
import { Sheet } from "../ui/components";

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const fullDate = (at: number) => new Date(at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export type MoveItem = Extract<ActivityItem, { kind: "transfer" | "people" }>;

export function IncomeRowView({ x, at = x.receivedAt }: { x: Income; at?: number }) {
  return (
    <div className="expense-row">
      <span className="cat-icon income-icon" style={{ width: 40, height: 40 }}><Icon name="download" size={20} /></span>
      <div className="grow col gap4">
        <span className="t-strong ellipsis">{x.source || "Income"}</span>
        <span className="t-muted tiny ellipsis">{["Income", x.account, x.note, time(at)].filter(Boolean).join(" · ")}</span>
      </div>
      <span className="amt num in">+{formatMoney(x.amount, { showPaise: true })}</span>
    </div>
  );
}

/** A transfer between your accounts, or money with a person. Neither is spending. */
export function MoveRowView({ item }: { item: MoveItem }) {
  const s = useTally();
  if (item.kind === "transfer") {
    const t = item.transfer;
    const toCard = s.accounts.find((a) => a.id === t.toId)?.kind === "card";
    return (
      <div className="expense-row">
        <span className="cat-icon move-icon" style={{ width: 40, height: 40 }}><Icon name="transfer" size={20} /></span>
        <div className="grow col gap4">
          <span className="t-strong ellipsis">{item.from} → {item.to}</span>
          <span className="t-muted tiny ellipsis">{[toCard ? "Card bill payment" : "Transfer", t.note, time(item.at)].filter(Boolean).join(" · ")}</span>
        </div>
        <span className="amt num t-muted">{formatMoney(item.amount, { showPaise: true })}</span>
      </div>
    );
  }
  const l = item.entry;
  return (
    <div className="expense-row">
      <span className="cat-icon move-icon" style={{ width: 40, height: 40 }}><Icon name="split" size={20} /></span>
      <div className="grow col gap4">
        <span className="t-strong ellipsis">{item.title}</span>
        <span className="t-muted tiny ellipsis">{[l.kind === "settled" ? "Settle-up" : l.kind === "lent" ? "Lent" : "Borrowed", l.account, l.note, time(item.at)].filter(Boolean).join(" · ")}</span>
      </div>
      <span className={`amt num${item.amount > 0 ? " in" : ""}`}>{item.amount > 0 ? "+" : "−"}{formatMoney(Math.abs(item.amount), { showPaise: true })}</span>
    </div>
  );
}

/** What a transfer or a settle-up was, with a way to remove it (Undo puts it back). */
export function MoveSheet({ item, onClose }: { item: MoveItem | null; onClose: () => void }) {
  const s = useTally();
  if (!item) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const group = item.kind === "people" && item.entry.group ? s.settings.groups.find((g) => g.id === item.entry.group)?.name : undefined;
  const rows: [string, string][] = item.kind === "transfer"
    ? [["From", item.from], ["To", item.to], ["Amount", formatMoney(item.amount, { showPaise: true })], ["When", fullDate(item.at)], ...(item.transfer.note ? [["Note", item.transfer.note] as [string, string]] : [])]
    : [["With", item.entry.person], ["Amount", `${item.amount > 0 ? "+" : "−"}${formatMoney(Math.abs(item.amount), { showPaise: true })} ${item.amount > 0 ? "came in" : "went out"}`],
      ...(item.entry.account ? [[item.amount > 0 ? "Into" : "From", item.entry.account] as [string, string]] : []),
      ["When", fullDate(item.at)], ...(group ? [["Group", group] as [string, string]] : []), ...(item.entry.note ? [["Note", item.entry.note] as [string, string]] : [])];
  return (
    <Sheet open onClose={onClose} title={item.kind === "transfer" ? "Transfer" : item.title}>
      <dl className="card detail-list" style={{ background: "var(--surface-2)" }}>
        {rows.map(([k, v]) => <div key={k} className="row between gap8"><dt className="t-muted small">{k}</dt><dd className="small t-strong" style={{ margin: 0, textAlign: "right" }}>{v}</dd></div>)}
      </dl>
      <p className="t-muted tiny" style={{ margin: 0 }}>
        {item.kind === "transfer" ? "Moving money between your accounts isn't spending, so it isn't in your totals." : "Money with people isn't spending, so it isn't in your totals. It changes what they owe you in People."}
      </p>
      <button className="btn danger block" onClick={() => {
        if (item.kind === "transfer") deleteTransfer(item.transfer.id); else deleteLedgerEntry(item.entry.id);
        onClose();
      }}>{item.kind === "transfer" ? "Remove this transfer" : "Delete this entry"}</button>
    </Sheet>
  );
}
