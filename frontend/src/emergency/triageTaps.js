/**
 * One tap on the emergency screen, as it crosses between two devices.
 *
 * In a paired visit the patient taps on their own phone and the sound is made
 * on the doctor's device (FR 3.5), so a tap has to travel. What travels is
 * which button it was and nothing else: a kind and an id. Never the words to
 * be spoken. The doctor's device looks the words up itself, in the alerts it
 * loaded and the fixed pain scale and body map it ships with, so a message
 * that names something it has never heard of is dropped instead of read aloud
 * to whoever is treating the patient. See ADR 053.
 *
 * The same three constructors serve the shared device, which speaks a tap on
 * the spot, so the sentence a tap becomes is written once.
 */

import { PAIN_LEVELS } from "./painLevels.js";
import { FACE_REGIONS, REGIONS } from "../components/bodySilhouette.js";

export const TapKind = { ALERT: "alert", PAIN: "pain", LOCATION: "location" };

const KINDS = new Set(Object.values(TapKind));

/** `key` names the phrase in the fixed vocabulary; `english` is the fallback. */
export function tapForAlert(alert) {
  return {
    kind: TapKind.ALERT,
    id: alert.id,
    key: alert.id,
    english: alert.english_text,
  };
}

export function tapForPain(option) {
  // Spoken as words rather than "4 of 5", because a number out of context
  // tells the clinician nothing they can act on.
  return {
    kind: TapKind.PAIN,
    id: option.level,
    key: `PAIN_${option.level}`,
    english: option.label,
  };
}

export function tapForRegion(region) {
  return {
    kind: TapKind.LOCATION,
    id: region.id,
    key: region.id,
    english: `My ${region.label.toLowerCase()} hurts`,
  };
}

/** What goes over the connection for a tap. */
export function tapMessage(tap) {
  return { type: "triage", kind: tap.kind, id: tap.id };
}

/**
 * The tap a `triage` message names, or null when it names nothing this device
 * offers. `alerts` is the list this device loaded, which may not have arrived
 * or may have failed to, and then no alert can be resolved.
 */
export function resolveTap(message, alerts) {
  if (message?.type !== "triage" || !KINDS.has(message.kind)) return null;

  if (message.kind === TapKind.ALERT) {
    const alert = Array.isArray(alerts)
      ? alerts.find((candidate) => candidate.id === message.id)
      : null;
    return alert ? tapForAlert(alert) : null;
  }

  if (message.kind === TapKind.PAIN) {
    const option = PAIN_LEVELS.find((candidate) => candidate.level === message.id);
    return option ? tapForPain(option) : null;
  }

  const region = [...REGIONS, ...FACE_REGIONS].find(
    (candidate) => candidate.id === message.id,
  );
  return region ? tapForRegion(region) : null;
}
