// The payment-request page (/pay#to=…&amt=…). Everything comes from the URL fragment, which the
// browser never sends to a server; text is only ever set with textContent.
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/bricolage-grotesque";
import "../landing/landing.css";
import "./pay.css";
import { formatMoney, isCurrency } from "../core/money";
import { readPayLink, upiIntent } from "../core/people";

const $ = (id: string) => document.getElementById(id)!;

function render() {
  const r = readPayLink(location.hash, isCurrency);
  $("request").hidden = !r;
  $("invalid").hidden = !!r;
  if (!r) return;
  const amount = formatMoney(r.amount, { currency: r.currency, showPaise: true });
  $("who").textContent = r.to ? `${r.to} asked you to pay` : "You've been asked to pay";
  $("amount").textContent = amount;
  document.title = `${r.to ? `Pay ${r.to}` : "Pay"} ${amount} · Tally`;
  if (r.note) { $("for").textContent = `for ${r.note}`; $("for").hidden = false; }
  const intent = upiIntent(r);
  $("upi").hidden = !intent;
  $("no-upi").hidden = !!intent;
  if (intent) {
    ($("upi-pay") as HTMLAnchorElement).href = intent;
    $("upi-pay").textContent = `Pay ${amount} with a UPI app`;
    $("upi-id").textContent = r.upi;
    // The name and amount come from whoever made the link, so the payer checks the name their UPI app shows.
    $("check").textContent = r.to
      ? `Before you pay, check that your UPI app shows ${r.to}'s name for ${r.upi}. Anyone can make a link like this, and Tally doesn't check who sent it.`
      : `Before you pay, check that your UPI app shows the name of the person you mean to pay. Anyone can make a link like this, and Tally doesn't check who sent it.`;
    $("copy").onclick = async () => {
      try { await navigator.clipboard.writeText(r.upi); $("copy").textContent = "Copied"; }
      catch { $("copy").textContent = "Select and copy it"; }
    };
  }
}

render();
window.addEventListener("hashchange", render);
