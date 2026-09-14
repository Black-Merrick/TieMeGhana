/**
 * Taking the splash down, once the app is actually on screen.
 *
 * The splash lives in index.html so it paints before any JavaScript is parsed.
 * That means React has to remove it, and it has to do so only after the first
 * real frame: hiding it the moment the module runs would swap one blank screen
 * for another.
 */

/** Matches the transition in index.html, so the node outlives its fade. */
const FADE_MS = 260;

export function dismissSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;

  // Two frames, not one. The first lands before the browser has painted what
  // React just committed, so fading on it can still show a gap underneath.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      splash.dataset.leaving = "true";
      setTimeout(() => splash.remove(), FADE_MS);
    });
  });
}
