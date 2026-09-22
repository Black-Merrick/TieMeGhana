import { useEffect, useState } from "react";

import { fetchCriticalAlerts, fetchEmergencySpeech } from "../api/clips.js";
import { NO_PHRASES, indexPhrases } from "../emergency/spokenPhrases.js";

/**
 * What emergency triage can say, fetched once: the critical alerts and the
 * fixed vocabulary of spoken phrases.
 *
 * Shared by the doctor's screen and the patient's phone, which each load it for
 * themselves: the alerts are what is drawn and the phrases are what a record of
 * a tap says, and neither is anything about the patient.
 *
 * Emergency mode has no free text, so everything it can say is known in
 * advance and is translated on the server rather than at the moment of a tap.
 * That is what makes a tap speak in about three seconds rather than five, and
 * what keeps an unreviewed clinical translation from being read aloud during
 * triage.
 */
/**
 * How long to wait before asking again, when the alerts or the phrases could
 * not be fetched. A phone that has just been pulled onto this screen by the
 * doctor's device may be on a poor connection, and a list that failed once and
 * stayed failed would leave the patient without the one group of buttons that
 * can be about not breathing. The pain scale and the body are drawn locally and
 * never wait on this. Bounded, so a server that is genuinely down is not hit
 * for ever.
 */
export const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000];

export default function useTriageVocabulary() {
  const [alerts, setAlerts] = useState(null);
  const [phrases, setPhrases] = useState(NO_PHRASES);

  useEffect(() => {
    let cancelled = false;
    const timers = [];

    /** Run `load` now and, while it keeps failing, again after each delay. */
    const untilLoaded = (load, onFailure, attempt = 0) => {
      load().catch(() => {
        if (cancelled) return;
        // Said at once, so the screen shows what it has rather than a
        // loading message for as long as the retries take.
        onFailure();
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) return;
        timers.push(setTimeout(() => untilLoaded(load, onFailure, attempt + 1), delay));
      });
    };

    untilLoaded(
      () =>
        fetchCriticalAlerts().then((loaded) => {
          if (cancelled) return;

          // Shape checked rather than trusted. A payload that is not a list
          // would throw inside render and take the whole screen down with it,
          // including the pain scale and body map, which need nothing from the
          // server and must survive anything the server does.
          setAlerts(Array.isArray(loaded) ? loaded : []);
        }),
      // The pain scale and body map still work, so triage degrades rather
      // than failing. Both are drawings and need nothing from the server.
      () => setAlerts((before) => before ?? []),
    );

    // Failure here is survivable in the same way: without the vocabulary
    // every tap is spoken in English, which is the behaviour before this
    // existed rather than a broken screen.
    untilLoaded(
      () =>
        fetchEmergencySpeech().then((payload) => {
          if (!cancelled) setPhrases(indexPhrases(payload));
        }),
      () => {},
    );

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  return { alerts, phrases };
}
