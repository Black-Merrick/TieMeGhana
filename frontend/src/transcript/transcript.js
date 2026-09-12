/**
 * The session transcript, SRS FR 4.1 to FR 4.3.
 *
 * Stored on the device and nowhere else. There is no endpoint that accepts a
 * transcript, so NFR 4's promise that it is never transmitted is a property of
 * what the system can do rather than a setting that could be misconfigured.
 * See ADR 002.
 *
 * Deleted when the visit ends, because this app runs on a device hospital staff
 * hand from one patient to the next. A transcript that outlived its visit would
 * show the next patient the previous patient's consultation, and those
 * consultations are about pregnancy, sexually transmitted infections, and HIV
 * status. Exposing one to a stranger is the precise harm this project exists to
 * prevent. See ADR 026.
 */

import { VibrationPattern, vibrate } from "../feedback/vibration.js";

const STORAGE_KEY = "tiemeghana.transcript";

/** Who said it. FR 4.1 requires the direction of every exchange. */
export const Direction = {
  /** The doctor to the patient: a caption and its sign video. */
  TO_PATIENT: "to_patient",
  /** The patient to the doctor: typed, tapped, or a confirmed nod. */
  TO_DOCTOR: "to_doctor",
};

/**
 * Read the transcript for the current visit.
 *
 * Returns an empty list rather than throwing when storage is unavailable, so a
 * private window cannot take down the consultation screen.
 */
export function readTranscript() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }

  if (!raw) return [];

  try {
    const entries = JSON.parse(raw);
    return Array.isArray(entries) ? entries : [];
  } catch {
    // Corrupt. An empty transcript is honest, whereas guessing at half parsed
    // clinical content would not be.
    return [];
  }
}

/**
 * Append one exchange and return the whole transcript.
 *
 * FR 4.1 requires direction, text, and a timestamp on every entry, so all
 * three are required here rather than defaulted. A timestamp that silently
 * defaulted to now would misdate an entry replayed from elsewhere.
 */
export function appendEntry({ direction, text, at = new Date().toISOString(), ...rest }) {
  if (!Object.values(Direction).includes(direction)) {
    throw new Error(`Unknown transcript direction: ${direction}`);
  }

  const entries = readTranscript();
  const entry = { id: `${entries.length}-${at}`, direction, text, at, ...rest };
  const updated = [...entries, entry];

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    // One soft, brief pulse, SRS section 6. The patient's confirmation that
    // their record was kept, for an event with no other cue.
    vibrate(VibrationPattern.TRANSCRIPT_SAVED);
  } catch {
    // Storage full or unavailable. The caller still receives the updated list
    // and the consultation continues, it just will not survive a reload.
  }

  return updated;
}

/**
 * Delete the transcript.
 *
 * FR 4.3 gives this to the patient, and ending a visit calls it too, so the
 * next person handed the device starts with nothing.
 */
export function clearTranscript() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage was never available.
  }
}

/**
 * Render the transcript as plain text for the patient to keep.
 *
 * The abstract promises a Deaf patient documented proof of what the doctor
 * communicated. Since the transcript is deleted with the visit, taking a copy
 * has to be possible, and it is an explicit patient action, which is exactly
 * the wording NFR 4 uses.
 */
export function transcriptAsText(entries = readTranscript()) {
  const lines = entries.map((entry) => {
    const who = entry.direction === Direction.TO_PATIENT ? "Doctor" : "Patient";
    return `[${entry.at}] ${who}: ${entry.text}`;
  });

  return ["Tie Me Ghana, consultation record", "", ...lines, ""].join("\n");
}
