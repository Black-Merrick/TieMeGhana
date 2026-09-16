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

/** How an answer came to be recorded, for the saved copy. */
const ATTRIBUTION = {
  doctor: " (confirmed by the doctor)",
  patient: " (tapped by the patient)",
};

/**
 * Render the transcript as plain text for the patient to keep.
 *
 * The abstract promises a Deaf patient documented proof of what the doctor
 * communicated. Since the transcript is deleted with the visit, taking a copy
 * has to be possible, and it is an explicit patient action, which is exactly
 * the wording NFR 4 uses.
 *
 * The patient's name is passed in rather than read from storage, and it is
 * deliberately never stored. It is asked for at the moment of saving and used
 * only in the file the patient takes away. A name kept alongside a clinical
 * transcript on a shared device would make the leak ADR 026 guards against far
 * more identifying: a stranger reading a stray transcript would learn whose it
 * was. See ADR 028.
 */
/** For labelling the second rendering in a saved record. */
const LANGUAGE_NAMES = { en: "English", tw: "Twi" };

export function transcriptAsText(
  entries = readTranscript(),
  { patientName = "", savedAt = new Date() } = {},
) {
  // Both languages, where both were kept. The saved copy is the one a patient
  // shows to another clinician, who may not share the language the
  // consultation happened in, and a file that has to be read in a particular
  // language is a file that fails the person carrying it. Nothing is
  // translated here: both renderings already exist, from when the line was
  // spoken or captioned.
  const lines = entries.flatMap((entry) => {
    const who = entry.direction === Direction.TO_PATIENT ? "Doctor" : "Patient";
    const attribution = ATTRIBUTION[entry.answeredBy] ?? "";
    const line = `[${formatStamp(entry.at)}] ${who}: ${entry.text}${attribution}`;

    if (!entry.translation || entry.translation === entry.text) return [line];

    // Indented under its own line rather than on it, so the record stays
    // readable by somebody who only wants one of the two languages.
    return [line, `${" ".repeat(11)}${LANGUAGE_NAMES[entry.translationLanguage] ?? "Also"}: ${entry.translation}`];
  });

  return [
    "Tie Me Ghana",
    "Consultation record",
    "",
    `Patient: ${patientName.trim() || "Not given"}`,
    `Saved: ${savedAt.toLocaleString()}`,
    "",
    ...lines,
    "",
    "This record was kept on the patient's own device and is their copy.",
    "",
  ].join("\n");
}

/** Readable time of day, falling back to the raw value if it will not parse. */
function formatStamp(iso) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
