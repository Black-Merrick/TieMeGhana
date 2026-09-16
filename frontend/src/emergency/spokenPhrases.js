/**
 * Choosing which rendering of an emergency phrase to speak.
 *
 * Emergency mode says a fixed set of things: two alerts, sixteen body
 * locations, five pain levels. The server translates them once and serves both
 * renderings, so a tap costs one synthesis call rather than a translation and
 * a synthesis, and speaks in about three seconds rather than five.
 *
 * The gate matters more than the saving. Machine translation of a single
 * clinical word is visibly unreliable, and the server marks what has not been
 * reviewed. An unreviewed phrase is spoken in English rather than read as
 * nonsense to a clinician who is treating somebody.
 */

/** No phrases loaded yet, or the request failed. English, and no surprises. */
export const NO_PHRASES = { byKey: {}, pendingReview: [] };

/** Index the payload by key, tolerating anything the server did not send. */
export function indexPhrases(payload) {
  if (!payload || !Array.isArray(payload.phrases)) return NO_PHRASES;

  const byKey = {};
  for (const phrase of payload.phrases) {
    if (phrase?.key) byKey[phrase.key] = phrase;
  }

  return {
    byKey,
    pendingReview: Array.isArray(payload.pending_review)
      ? payload.pending_review
      : [],
  };
}

/**
 * What to say for one tap, and in which language.
 *
 * Returns the text together with the language it is actually in, because the
 * two can differ from what was asked for: requesting Twi for an unreviewed
 * phrase gets English back. The caller passes the returned language on as the
 * source, so the server has nothing to translate and simply speaks it.
 *
 * `fallbackEnglish` covers a key the server does not know, which is how a new
 * body location behaves before the vocabulary catches up. Speaking the English
 * label is better than speaking nothing.
 */
export function phraseToSpeak(phrases, key, wanted, fallbackEnglish) {
  const phrase = phrases?.byKey?.[key];
  const english = phrase?.en ?? fallbackEnglish;

  if (wanted !== "tw") return { text: english, language: "en" };

  // The whole safety gate, in one condition. Unreviewed Twi is never spoken.
  if (phrase?.tw_reviewed && phrase.tw) {
    return { text: phrase.tw, language: "tw" };
  }

  return { text: english, language: "en", fellBackToEnglish: true };
}

/** Whether any phrase would be spoken in English despite Twi being asked for. */
export function anyFallsBackToEnglish(phrases, wanted) {
  if (wanted !== "tw") return false;
  return (phrases?.pendingReview?.length ?? 0) > 0;
}
