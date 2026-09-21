/**
 * The last message the doctor's device sent the patient's phone, kept so it
 * can be sent again when the phone comes back.
 *
 * A phone that reloads has nothing on screen until the doctor's device tells
 * it what the question was. Held on the doctor's device only, with the
 * transcript it already keeps of the same exchange, expiring with the visit
 * and cleared when the next patient starts. See ADR 053.
 */

import { VISIT_MAX_AGE_MS } from "../visit/visit.js";

const STORAGE_KEY = "tiemeghana.last-question";

export function saveLastQuestion(message, now = Date.now()) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ message, savedAt: now }));
  } catch {
    // Full disk or private mode. A phone that reloads then waits for the next
    // question rather than being shown the last one.
  }
}

export function loadLastQuestion(now = Date.now()) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved?.message?.type !== "question") return null;
    if (!Number.isFinite(saved.savedAt) || now - saved.savedAt > VISIT_MAX_AGE_MS) {
      clearLastQuestion();
      return null;
    }
    return saved.message;
  } catch {
    return null;
  }
}

export function clearLastQuestion() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to remove from.
  }
}
