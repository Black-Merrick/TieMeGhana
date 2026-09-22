/**
 * How long the talking face stays up, SRS section 4.2.
 *
 * The face is the patient's only evidence that their answer is being said aloud,
 * since they cannot hear it. It has to last as long as the sentence does. Left
 * to follow the audio alone it does not: the development language service
 * returns a fraction of a second of silence, and any device that reports "done"
 * the instant the sound stops, or a report that arrives just after the sound
 * began, takes the face away before it can be read. Seen on a real phone, where
 * it was gone almost as soon as it appeared.
 *
 * So once the sound has started, the face stays until a sentence of that length
 * would take to say, and longer if the audio itself is longer: this is a floor,
 * never a cut-off. A failure, a blocked sound or a stop is shown the instant it
 * is known, and does not wait for it.
 */

/** The shortest the face stays up, however short the sentence. */
export const MIN_OVERLAY_MS = 1800;

/** The longest it is held for on the strength of the words alone. */
export const MAX_HOLD_MS = 10000;

/** About 170 words a minute, a little brisk, so it errs towards not overstaying. */
const MS_PER_WORD = 350;
const LEAD_MS = 500;

/** How long saying `text` aloud would take, roughly. */
export function estimatedSpeechMs(text) {
  const words = String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return Math.min(MAX_HOLD_MS, Math.max(MIN_OVERLAY_MS, LEAD_MS + words * MS_PER_WORD));
}

/**
 * How much longer the face should stay once the sound has finished.
 *
 * `sinceStartedMs` is how long ago the sound began, or null when that was not
 * seen, as when the report of it was collapsed into the one after. Then it is
 * held only for the shortest time, since the sound may well have run its whole
 * length already.
 */
export function remainingHoldMs(text, sinceStartedMs) {
  if (sinceStartedMs === null || sinceStartedMs === undefined) return 0;
  return Math.max(0, estimatedSpeechMs(text) - sinceStartedMs);
}
