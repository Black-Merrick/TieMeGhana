/**
 * The prescription the doctor's device has issued to the patient's phone, kept
 * so it can be sent again when the phone comes back.
 *
 * Only the reference, which identifies nobody (ADR 044) and which the server
 * already holds. It is remembered separately from the prescription on the
 * doctor's own screen because that one is forgotten when the doctor presses
 * Done, and the phone must not be: the patient is still holding it. Expires
 * with the visit and is cleared when the next patient starts. See ADR 053.
 */

import { isPrescriptionReference } from "../prescription/currentPrescription.js";
import { VISIT_MAX_AGE_MS } from "../visit/visit.js";

const STORAGE_KEY = "tiemeghana.sent-prescription";

export function saveSentPrescription(reference, now = Date.now()) {
  if (!isPrescriptionReference(reference)) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ reference, savedAt: now }));
  } catch {
    // Held in state for this page load; a reload then sends nothing until the
    // doctor issues another, which is what happened before this existed.
  }
}

export function loadSentPrescription(now = Date.now()) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!isPrescriptionReference(saved?.reference) || !Number.isFinite(saved?.savedAt)) {
      return null;
    }
    if (now - saved.savedAt > VISIT_MAX_AGE_MS) {
      clearSentPrescription();
      return null;
    }
    return saved.reference;
  } catch {
    return null;
  }
}

export function clearSentPrescription() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to remove from.
  }
}
