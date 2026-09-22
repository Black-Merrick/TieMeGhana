import { isPrescriptionReference } from "../prescription/currentPrescription.js";

/**
 * Whether the doctor's device is in emergency mode, as its messages say it.
 *
 * Carried by every message that tells the phone where it should be (`emergency`
 * itself, `path`, `question` and `resume`), not only by the one that announces
 * it. The connection hands a screen only the newest message, so a phone that
 * missed the announcement because something else was sent in the same instant
 * would otherwise stay on the wrong screen for as long as the doctor stayed on
 * the right one. Undefined when the message says nothing about it. See ADR 053.
 */
const CARRIES_SCREEN = new Set(["emergency", "path", "question", "resume"]);
const CARRIES_PATH = new Set(["emergency", "path", "question"]);

export function announcedEmergency(message) {
  if (!message || !CARRIES_SCREEN.has(message.type)) return undefined;
  return typeof message.emergency === "boolean" ? message.emergency : undefined;
}

/**
 * The prescription the doctor has issued to this phone, as a message says it.
 *
 * Only ever the opaque reference, which identifies nobody (ADR 044) and which
 * the server already holds; the phone fetches the medicines themselves from
 * there, as it would after scanning the code. Carried on the same messages as
 * `emergency`, for the same reason: the connection hands a screen only the
 * newest one. Undefined when a message says nothing, or says something that is
 * not a reference. A phone never forgets a prescription because a message did
 * not mention one: it is the patient's to keep.
 */
export function announcedPrescription(message) {
  if (!message || !CARRIES_SCREEN.has(message.type)) return undefined;
  return isPrescriptionReference(message.prescription) ? message.prescription : undefined;
}

/** The literacy path a message announces, when it is one that does. */
export function announcedPath(message) {
  if (!message || !CARRIES_PATH.has(message.type)) return undefined;
  return message.path;
}
