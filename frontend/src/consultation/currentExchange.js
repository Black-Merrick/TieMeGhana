/**
 * The exchange currently on screen, kept across a page reload.
 *
 * The transcript already survives a reload, but it is a written record. What
 * was being lost was the live part of the consultation: the question the
 * patient is looking at, the stitched sign video they may not have finished
 * watching, and whether they were part way through pointing at a body
 * location.
 *
 * A reload is not an unusual event on a hospital device. A patient taps the
 * wrong thing, the browser reloads the service worker after an update, or the
 * screen is handed over mid question. Losing the question at that moment means
 * asking the patient to sit through it again, and if they had already answered
 * in their head, it means asking them something they thought they had settled.
 *
 * Stored on the device with the same lifetime as the visit, and cleared with
 * it, for the reasons in ADR 026. See ADR 032.
 */

const STORAGE_KEY = "tiemeghana.exchange";

/**
 * Read the exchange that was on screen, or null if there was none.
 *
 * Every access is guarded. localStorage throws in a private window, and an
 * exception here would take down the consultation screen on load, which is
 * strictly worse than losing the question.
 */
export function loadCurrentExchange() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }

  if (!raw) return null;

  try {
    const stored = JSON.parse(raw);
    return isRestorable(stored) ? stored : null;
  } catch {
    // Corrupt, or written by an older version. Starting fresh is safe here:
    // the transcript still holds what was said, so nothing is actually lost
    // except the video the patient was watching.
    return null;
  }
}

/**
 * Whether a stored record can actually be put back on screen.
 *
 * Checked by shape, not merely by presence. A caption written by an older
 * version, or a partial write, can be missing the resolved sequence the player
 * and the coverage notice both read, and restoring one of those crashes the
 * consultation screen on load. That is strictly worse than losing the
 * question, so anything that does not match fails closed and the screen starts
 * clean.
 */
function isRestorable(stored) {
  const caption = stored?.caption;
  return Boolean(
    caption &&
      typeof caption.caption === "string" &&
      Array.isArray(caption.sequence?.segments) &&
      Array.isArray(caption.sequence?.fingerspelled_tokens) &&
      Array.isArray(caption.sequence?.unavailable_tokens) &&
      // Added with ADR 033. A record written before the safety gate existed
      // has no verdict on it, and treating a missing verdict as either answer
      // would be a guess about whether a sentence is safe to show.
      typeof caption.sequence?.is_safe_to_show === "boolean",
  );
}

/** Merge into the stored exchange, keeping whatever is not being changed. */
export function saveCurrentExchange(changes) {
  const merged = { ...(loadCurrentExchange() ?? {}), ...changes };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Storage full or unavailable. The exchange still works, it just will not
    // survive a reload, which is the behaviour this module exists to improve
    // rather than something the consultation depends on.
  }

  return merged;
}

/**
 * Forget the exchange on screen.
 *
 * Called when a question is answered, so the next one starts clean, and when
 * the visit ends, so the next patient never sees the previous patient's
 * question waiting for them.
 */
export function clearCurrentExchange() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage was never available.
  }
}
