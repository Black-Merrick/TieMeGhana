/**
 * Save a file to the device, FR 6.2.
 *
 * A plain `<a download>` is honoured only for a file on the page's own origin.
 * The clips live on the storage bucket, another origin, where the attribute is
 * silently ignored and the tap merely opens the video, which a patient does not
 * know how to turn into a saved file. So the file is fetched, made into a blob
 * on this origin, and saved from there. That needs the bucket to allow this
 * origin (CORS), which it is asked to for offline replay in any case; where it
 * does not, this reports failure and the caller offers the plain link instead.
 *
 * Gives up after `timeoutMs`, and says so. A phone on a weak connection would
 * otherwise sit on "Saving" for ever with nothing to tell the patient it had
 * stalled, which is worse than being told it could not be done here.
 *
 * Resolves true when a save was started, false when it could not be.
 */
export const SAVE_TIMEOUT_MS = 45000;

export async function saveFile(url, filename, { timeoutMs = SAVE_TIMEOUT_MS } = {}) {
  let objectUrl = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return false;

    const blob = await response.blob();
    objectUrl = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    // Not straight away: the browser reads the blob after the click returns.
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }
}
