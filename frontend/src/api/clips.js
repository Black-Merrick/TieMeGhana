import { apiRequest } from "./client.js";

/** The gloss of the FR 2.1 literacy question, asked in sign video only. */
export const LITERACY_PROMPT_GLOSS = "CAN_YOU_READ_AND_WRITE";

/**
 * Fetch one reviewed clip by its gloss.
 *
 * Rejects when the clip is missing, unfilmed, or unapproved, all of which the
 * API reports as a 404. The caller must treat that as "cannot ask" rather than
 * carrying on, since acting on an answer to a question never asked is worse
 * than not asking.
 */
export function fetchClipByGloss(gloss) {
  return apiRequest(`/clips/by-gloss/${encodeURIComponent(gloss)}/`);
}
