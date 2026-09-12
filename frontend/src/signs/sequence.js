/**
 * Building sign sequences the player can accept.
 *
 * The caption pipeline returns sequences already in this shape. Other features
 * play a single named clip instead, the literacy prompt, a clinical question,
 * a prescription instruction, and they all go through the same player per SRS
 * section 4.4, so they need the same shape.
 */

/** Wrap one clip as a sequence, so it plays through the shared player. */
export function singleClipSequence(clip) {
  if (!clip) {
    return {
      source_text: "",
      segments: [],
      total_duration_ms: 0,
      fingerspelled_tokens: [],
      unavailable_tokens: [],
    };
  }

  return {
    source_text: clip.gloss,
    segments: [{ token: clip.gloss, match: "gloss", clips: [clip] }],
    total_duration_ms: clip.duration_ms ?? 0,
    fingerspelled_tokens: [],
    unavailable_tokens: [],
  };
}
