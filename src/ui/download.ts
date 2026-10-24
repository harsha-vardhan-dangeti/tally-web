/** Saves text as a file in the user's Downloads. */
export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const backupFileName = () => `tally-backup-${new Date().toISOString().slice(0, 10)}.json`;
