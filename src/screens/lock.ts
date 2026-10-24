/**
 * App lock using the device's platform authenticator (Face ID / Touch ID / Windows Hello) via WebAuthn.
 * There is no server, so this is a local privacy screen — it does not encrypt the data.
 */

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export const lockSupported = () =>
  typeof window !== "undefined" && !!window.PublicKeyCredential && window.isSecureContext;

export async function enableLock(): Promise<string | null> {
  if (!lockSupported()) return null;
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: random(32),
        rp: { name: "Tally" },
        user: { id: random(16), name: "tally-lock", displayName: "Tally app lock" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    return cred ? b64(cred.rawId) : null;
  } catch {
    return null;
  }
}

export async function unlock(credentialId: string): Promise<boolean> {
  try {
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        allowCredentials: [{ type: "public-key", id: unb64(credentialId) }],
        userVerification: "required",
        timeout: 60_000,
      },
    });
    return !!res;
  } catch {
    return false;
  }
}
