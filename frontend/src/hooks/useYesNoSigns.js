import { useEffect, useState } from "react";

import { fetchClipByGloss } from "../api/clips.js";

/**
 * The GhSL clips for YES and NO, for the buttons that offer them.
 *
 * The app asks a patient to answer yes or no in several places, and until the
 * signs were filmed those buttons carried a drawn tick and cross. A drawing is
 * a convention somebody has to already share; the sign is the patient's own
 * language, and FR 2.1 is explicit that the literacy check must be able to ask
 * its question without relying on text at all. So where the footage exists the
 * buttons show it, and where it does not they keep the drawing. See ADR 059.
 *
 * Fetched once for the session and shared, because these two clips are on
 * screen in the literacy check, in every guided question, and on the patient's
 * own phone, and re-requesting them at each of those is a request per screen on
 * a connection that has none to spare.
 *
 * A clip that is missing, unfilmed or unapproved is a 404, and is kept as null
 * rather than retried: the buttons work without it, and the review gate saying
 * no is an answer, not a failure.
 */
let pending = null;

export function forgetYesNoSigns() {
  pending = null;
}

function loadYesNoSigns() {
  if (pending) return pending;

  const one = (gloss) => fetchClipByGloss(gloss).catch(() => null);
  pending = Promise.all([one("YES"), one("NO")]).then(([yes, no]) => ({ yes, no }));
  return pending;
}

export default function useYesNoSigns({ enabled = true } = {}) {
  const [signs, setSigns] = useState({ yes: null, no: null });

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    loadYesNoSigns().then((loaded) => {
      if (!cancelled) setSigns(loaded);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return signs;
}
