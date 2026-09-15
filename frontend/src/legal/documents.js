/**
 * Which legal document an address refers to.
 *
 * Kept apart from the screen that renders them so App can read the address
 * without importing the documents themselves, and so the two constants below
 * are the single place a path is written down. The app has no router, and
 * adding one for two static pages would put a dependency in the bundle every
 * patient downloads for the sake of pages almost nobody opens mid consultation.
 */

export const LegalDocument = {
  PRIVACY: "privacy",
  TERMS: "terms",
};

const PATHS = {
  [LegalDocument.PRIVACY]: "/privacy",
  [LegalDocument.TERMS]: "/terms",
};

/**
 * Which document the current address asks for, or null for the app itself.
 *
 * Trailing slashes are tolerated because a printed or forwarded link often
 * grows one, and answering with the consultation screen to somebody who asked
 * for the privacy policy would be a strange way to treat that request.
 */
export function legalDocumentFromPath(pathname = window.location.pathname) {
  const path = pathname.replace(/\/+$/, "").toLowerCase();

  if (path === PATHS[LegalDocument.PRIVACY]) return LegalDocument.PRIVACY;
  if (path === PATHS[LegalDocument.TERMS]) return LegalDocument.TERMS;
  return null;
}

/** The address a document lives at, for a link or a history entry. */
export function pathForLegalDocument(document) {
  return PATHS[document] ?? "/";
}
