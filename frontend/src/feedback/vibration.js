/**
 * The app's entire vibration vocabulary, SRS section 6.
 *
 * The SRS is explicit that this is a single source of truth: every feature
 * reuses one of these patterns and none invents a sixth. That matters because
 * a Deaf patient learns what each pulse means over repeated use, so the same
 * pulse meaning two different things anywhere in the app would teach them
 * something false. Section 4.4, Consistency.
 *
 * Patterns follow the Vibration API convention: alternating vibrate and pause
 * durations in milliseconds, starting with a vibration.
 */

export const VibrationPattern = {
  /** A tap selection was registered. One short pulse. */
  TAP_SELECTION: [40],

  /** Speech to the hearing listener has started. Two short pulses. */
  AUDIO_STARTED: [40, 70, 40],

  /** Speech to the hearing listener has finished. One long pulse. */
  AUDIO_FINISHED: [220],

  /**
   * A critical alert was selected in Emergency Visual Triage. Three short,
   * sharp pulses. Deliberately the most urgent pattern in the set, because it
   * confirms the highest stakes action in the app.
   */
  EMERGENCY_ALERT: [60, 45, 60, 45, 60],

  /** The session transcript was saved. One soft, brief pulse. */
  TRANSCRIPT_SAVED: [18],
};

/** Whether this device and browser can vibrate at all. */
export function isVibrationSupported() {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

/**
 * Fire one of the vocabulary's patterns.
 *
 * Returns whether the device actually vibrated, so a caller can fall back to
 * visual feedback alone. NFR 3 requires exactly this: vibration must degrade
 * gracefully where unsupported rather than failing silently, and a thrown
 * error inside a tap handler would break the interaction itself, which is far
 * worse than no haptic feedback.
 */
export function vibrate(pattern) {
  if (!isVibrationSupported()) return false;

  try {
    // Chrome returns false when it refuses, for example before any user
    // gesture, so the browser's own answer is passed through.
    return navigator.vibrate(pattern) !== false;
  } catch {
    return false;
  }
}
