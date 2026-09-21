/**
 * The name of the rendezvous two paired devices use to find each other again.
 *
 * Sixteen random bytes from the browser's own secure generator, as URL safe
 * base64: twenty two characters and 128 bits, which is what makes it safe to
 * be the only thing standing between a stranger and a consultation, where the
 * six character code the pair first met over is not. It is made on the
 * doctor's device and handed to the phone over their own connection, so it
 * has never been to the server before either of them reconnects. See ADR 053.
 */
export function generateResumeToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Whether a value is shaped like one, so nothing else is ever trusted as one. */
export function isResumeToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{22,64}$/.test(value);
}
