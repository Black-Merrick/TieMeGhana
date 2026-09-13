import { apiRequest } from "./client.js";

/**
 * Prescription playback, SRS FR 6.1 to FR 6.4.
 */

/**
 * Issue a prescription, FR 6.1.
 *
 * Returns the whole playlist rather than only the new reference, so the doctor
 * can see what the patient will see before handing over the QR code. In
 * particular `is_fully_signable`: an instruction that cannot be rendered in
 * GhSL has to be visible while the patient is still in the room.
 */
export function issuePrescription(items) {
  return apiRequest("/prescriptions/", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

/** Resolve a scanned reference to its playlist, FR 6.2 and FR 6.3. */
export function fetchPlaylist(reference) {
  return apiRequest(`/prescriptions/${encodeURIComponent(reference)}/`);
}

/** The path a QR code points at. One place, so the router cannot disagree. */
export function playlistPath(reference) {
  return `/p/${reference}`;
}

/** The absolute URL encoded into the QR code, FR 6.3. */
export function playlistUrl(reference, origin = window.location.origin) {
  return `${origin}${playlistPath(reference)}`;
}

/**
 * Read a prescription reference out of the current path, if there is one.
 *
 * Returns null for every other route. Deliberately a plain path check rather
 * than a router: this is the only deep link in the app, and a routing library
 * would be a dependency and a bundle cost for one comparison.
 */
export function referenceFromPath(pathname = window.location.pathname) {
  const match = /^\/p\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
  return match ? match[1] : null;
}

/**
 * Pull every clip in a playlist through the cache, FR 6.2.
 *
 * The service worker caches clips on first play, which would mean a patient
 * who walks out without pressing play has nothing saved and no way to know it.
 * FR 6.2 asks for the playlist to be cached on the phone, so the fetching is
 * done deliberately, while they are still on the hospital connection.
 *
 * Each clip is requested for its side effect on the cache and the body is
 * discarded. Failures are collected rather than thrown: a prescription where
 * four of five clips saved is still worth having, and the caller reports how
 * many made it rather than claiming the whole thing is available offline.
 */
export async function cachePlaylistClips(playlist) {
  const urls = new Set();

  for (const item of playlist?.items ?? []) {
    if (item.sequence?.stitched_video_url) {
      urls.add(item.sequence.stitched_video_url);
    }
    for (const segment of item.sequence?.segments ?? []) {
      for (const clip of segment.clips ?? []) {
        if (clip.video_url) urls.add(clip.video_url);
      }
    }
  }

  const results = await Promise.allSettled(
    [...urls].map((url) => fetch(url, { cache: "reload" })),
  );

  const saved = results.filter(
    (result) => result.status === "fulfilled" && result.value?.ok,
  ).length;

  return { saved, total: urls.size };
}
