/** Sharing from Tally: the phone's share sheet where there is one, otherwise the clipboard. */

export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

export async function shareText(text: string, title = "Tally"): Promise<ShareResult> {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

/** Opens WhatsApp (the app on phones, WhatsApp Web elsewhere) with the message ready to send. */
export function whatsapp(text: string) {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

/** Shares an image file, or downloads it where files can't be shared. */
export async function shareImage(blob: Blob, name: string, text: string): Promise<ShareResult> {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "copied";
}
