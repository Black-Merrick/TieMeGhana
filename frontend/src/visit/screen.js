/**
 * Which full screen the doctor's device had open, so a reload comes back to it.
 *
 * Emergency triage and the prescription builder each replace the consultation,
 * and each was lost on a reload, dropping the doctor back onto a consultation
 * they had left. Only those two are recorded; the consultation itself is the
 * default and needs no record. Cleared when the next patient starts, and
 * expiring with the visit like everything else held about one.
 */

import { VISIT_MAX_AGE_MS } from "./visit.js";

const STORAGE_KEY = "tiemeghana.screen";

export const Screen = { EMERGENCY: "emergency", PRESCRIPTION: "prescription" };

const VALID = new Set(Object.values(Screen));

export function loadScreen(now = Date.now()) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!VALID.has(saved?.name) || !Number.isFinite(saved?.startedAt)) return null;
    if (now - saved.startedAt > VISIT_MAX_AGE_MS) {
      clearScreen();
      return null;
    }
    return saved.name;
  } catch {
    return null;
  }
}

export function saveScreen(name, now = Date.now()) {
  if (!VALID.has(name)) throw new Error(`Unknown screen: ${name}`);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, startedAt: now }));
  } catch {
    // Held in state for this page load; it just will not survive a reload.
  }
}

export function clearScreen() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to remove from.
  }
}
