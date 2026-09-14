/**
 * The current visit, and which interaction path the patient is on.
 *
 * FR 2.2 says the literacy answer "determines their interaction path for the
 * visit". The scope in that sentence is load bearing. This app runs on a
 * device hospital staff hand from one patient to the next, so an answer that
 * outlived its visit would route the next patient down the wrong path, and the
 * wrong path here means a patient who cannot read being shown captions. That
 * is the exact failure the literacy check exists to prevent. See ADR 020.
 *
 * Stored on the device, never sent to a server, consistent with ADR 002.
 */

const STORAGE_KEY = "tiemeghana.visit";

/**
 * A visit older than this is treated as finished even if nobody pressed the
 * button. A safety net, not the primary mechanism: staff ending the visit is.
 * Four hours is longer than a consultation and shorter than a shift, so it
 * cannot span two patients in practice.
 */
export const VISIT_MAX_AGE_MS = 4 * 60 * 60 * 1000;

/**
 * The hearing listener's language, FR 3.4.
 *
 * Set once per session and applied to every response for the rest of the
 * visit. It is the listener's language, not the patient's: the point is that
 * whoever is listening understands, whichever of the two they speak.
 */
export const OutputLanguage = { ENGLISH: "en", TWI: "tw" };

/**
 * English by default, because it is the language clinical staff in Ghanaian
 * hospitals most reliably share. The toggle is permanently on screen per
 * section 4.1, so a nurse who speaks Twi changes it in one tap rather than
 * being asked before the consultation can start.
 */
export const DEFAULT_OUTPUT_LANGUAGE = OutputLanguage.ENGLISH;

export const LiteracyPath = {
  /** Reads and writes: free captioning and typed replies, FR 2.3. */
  LITERATE: "literate",
  /** Does not read print: Guided Interrogation only, FR 2.4. */
  GUIDED: "guided",
};

/**
 * Read the current visit, or null if there is none or it has gone stale.
 *
 * Every storage access is guarded. localStorage throws in a private window and
 * can be disabled entirely, and an exception here would take down the first
 * screen a patient ever sees.
 */
export function loadVisit(now = Date.now()) {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }

  if (!raw) return null;

  let visit;
  try {
    visit = JSON.parse(raw);
  } catch {
    // Corrupt or from an older version. Re asking is always safe, whereas
    // guessing a path is not.
    return null;
  }

  // Checked by type, not truthiness. A timestamp of 0 is a valid number and a
  // falsy check would reject it, which is the kind of bug that hides until a
  // clock or a fixture happens to produce one.
  if (!Number.isFinite(visit?.startedAt)) return null;

  // An unrecognized path fails closed and re asks, rather than falling through
  // to whichever branch the UI happens to default to.
  if (!Object.values(LiteracyPath).includes(visit.literacyPath)) return null;

  // Deliberately fails closed. A stale visit means we re ask the literacy
  // question, which costs the patient a few seconds. Failing open would route
  // them silently, which could cost them the consultation.
  if (now - visit.startedAt > VISIT_MAX_AGE_MS) {
    endVisit();
    return null;
  }

  return {
    ...visit,
    // A record written before this field existed, or carrying a value we do
    // not recognize, falls back rather than leaving it undefined. An undefined
    // output language would be sent to the server and rejected, turning an old
    // stored visit into a broken consultation.
    outputLanguage: Object.values(OutputLanguage).includes(visit.outputLanguage)
      ? visit.outputLanguage
      : DEFAULT_OUTPUT_LANGUAGE,
  };
}

/**
 * Record the patient's literacy answer and start their visit.
 *
 * Starting the visit here rather than earlier means the timer runs from the
 * answer, which is the first moment there is anything worth remembering.
 */
export function saveLiteracyPath(path, now = Date.now()) {
  if (!Object.values(LiteracyPath).includes(path)) {
    throw new Error(`Unknown literacy path: ${path}`);
  }

  const visit = {
    literacyPath: path,
    outputLanguage: DEFAULT_OUTPUT_LANGUAGE,
    startedAt: now,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visit));
  } catch {
    // Storage unavailable. The visit still works, it is held in memory by the
    // caller, it just will not survive a page reload.
  }

  return visit;
}

/**
 * End the visit, so the next patient is asked fresh.
 *
 * This is the control staff use between patients, and it is why the literacy
 * answer is safe to persist across a reload at all.
 */
export function endVisit() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage was never available.
  }
}


/**
 * Change the hearing listener's language for the rest of this visit.
 *
 * Returns the updated visit, or null if there is none, so a caller cannot
 * silently set a language against a visit that has already ended.
 */
export function saveOutputLanguage(language, now = Date.now()) {
  if (!Object.values(OutputLanguage).includes(language)) {
    throw new Error(`Unknown output language: ${language}`);
  }

  const visit = loadVisit(now);
  if (!visit) return null;

  const updated = { ...visit, outputLanguage: language };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Storage unavailable. The caller holds the value in memory, it just will
    // not survive a reload.
  }

  return updated;
}
