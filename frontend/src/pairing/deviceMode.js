/**
 * Whether this visit runs on one shared device or on two, and nothing else.
 *
 * The first question a visit asks is whether the patient has their own phone,
 * before the literacy check, so its answer cannot live in the visit: a visit
 * only exists once the literacy question has been answered, and `loadVisit`
 * rejects anything without a valid literacy path. It is stored beside the
 * visit instead, on the same terms: on this device, never sent to a server,
 * and cleared with everything else when the next patient starts. See ADR 053.
 *
 * Held with a timestamp and expired on the same clock as a visit, for the
 * same reason. A "paired" answer that outlived its visit would send the next
 * patient to a pairing screen for a phone they have not got.
 */

import { VISIT_MAX_AGE_MS } from "../visit/visit.js";

const STORAGE_KEY = "tiemeghana.device";

export const DeviceMode = {
  /** The device is passed between doctor and patient, as it always was. */
  SHARED: "shared",
  /** The patient's own phone is joined to this one over a direct connection. */
  PAIRED: "paired",
};

const VALID = new Set(Object.values(DeviceMode));

/** The saved choice, or null when nobody has been asked (or it has expired). */
export function loadDeviceMode(now = Date.now()) {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!VALID.has(saved?.mode) || !Number.isFinite(saved?.startedAt)) return null;

  if (now - saved.startedAt > VISIT_MAX_AGE_MS) {
    clearDeviceMode();
    return null;
  }

  return saved.mode;
}

/** Record the answer. Returns it, so a caller can put it straight into state. */
export function saveDeviceMode(mode, now = Date.now()) {
  if (!VALID.has(mode)) {
    throw new Error(`Unknown device mode: ${mode}`);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, startedAt: now }));
  } catch {
    // Private mode or a full disk. The choice still applies for this page
    // load, held in state by the caller; it just will not survive a reload.
  }
  return mode;
}

export function clearDeviceMode() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to remove from.
  }
}
