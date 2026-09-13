import { apiRequest } from "./client.js";

/** The gloss of the FR 2.1 literacy question, asked in sign video only. */
export const LITERACY_PROMPT_GLOSS = "CAN_YOU_READ_AND_WRITE";

/**
 * What the "ask where it hurts" action says.
 *
 * Stitched from the clip library like any other utterance, so it needs no clip
 * of its own. Kept next to the body location fetch because the two are only
 * ever used together.
 */
export const WHERE_DOES_IT_HURT = "Where does it hurt?";

/**
 * Fetch the body locations a patient can point to, FR 2.5.
 *
 * Returns every location, filmed or not, each reporting whether it can be
 * shown. The caller withholds the whole grid unless all of them can, per
 * ADR 022.
 */
export function fetchBodyLocations() {
  return apiRequest("/clips/body-locations/");
}

/**
 * Fetch the critical alerts for Emergency Visual Triage, FR 5.3.
 *
 * Every alert is returned whether its GhSL clip is filmed or not, because an
 * icon a patient half recognises beats having no way to say "cannot breathe".
 * See ADR 040.
 */
export function fetchCriticalAlerts() {
  return apiRequest("/clips/alerts/");
}

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
