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

export function announcedEmergency(message) {
  if (!message || !CARRIES_SCREEN.has(message.type)) return undefined;
  return typeof message.emergency === "boolean" ? message.emergency : undefined;
}
