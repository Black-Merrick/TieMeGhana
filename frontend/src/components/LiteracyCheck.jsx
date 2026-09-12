import { useEffect, useState } from "react";

import { LITERACY_PROMPT_GLOSS, fetchClipByGloss } from "../api/clips.js";
import { singleClipSequence } from "../signs/sequence.js";
import { LiteracyPath, saveLiteracyPath } from "../visit/visit.js";
import SignSequencePlayer from "./SignSequencePlayer.jsx";
import YesNoChoice from "./YesNoChoice.jsx";

/**
 * The literacy check, SRS FR 2.1 to FR 2.3.
 *
 * This is the first screen a patient sees and the most important branch in the
 * app. Fluency in GhSL does not imply fluency in written English, so assuming
 * either path would make the app unusable for exactly the people it exists to
 * serve.
 *
 * The question is asked in sign video with no text at all, and answered with
 * the shared Yes and No icons. Nothing on this screen requires reading, which
 * is the whole point: a patient who cannot read must be able to answer the
 * question about whether they can read.
 */
export default function LiteracyCheck({ onDecided }) {
  const [promptClip, setPromptClip] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;

    fetchClipByGloss(LITERACY_PROMPT_GLOSS)
      .then((clip) => {
        if (cancelled) return;
        setPromptClip(clip);
        setStatus("ready");
      })
      .catch(() => {
        // The clip is missing, unfilmed, or not yet approved. The question
        // cannot be asked in GhSL, which is reported rather than hidden,
        // because the alternative is acting on an answer to a question the
        // patient was never actually asked.
        if (!cancelled) setStatus("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const choose = (canReadAndWrite) => {
    const path = canReadAndWrite ? LiteracyPath.LITERATE : LiteracyPath.GUIDED;

    // Saved before the parent routes, so a reload mid consultation does not
    // ask the patient the same question twice. FR 2.2.
    saveLiteracyPath(path);
    onDecided(path);
  };

  return (
    <section className="literacy" data-testid="literacy-check">
      {status === "loading" ? (
        <p className="literacy__loading" data-testid="literacy-loading">
          <span className="consultation__pulse" aria-hidden="true" />
        </p>
      ) : null}

      {status === "ready" ? (
        <SignSequencePlayer sequence={singleClipSequence(promptClip)} />
      ) : null}

      {/* Staff facing, not patient facing. Until the prompt is filmed the app
          cannot ask the question itself, so it says so rather than pretending
          the patient understood a blank screen. */}
      {status === "unavailable" ? (
        <p className="literacy__unavailable" data-testid="literacy-unavailable">
          The sign video for this question has not been filmed and approved
          yet. Ask the patient in person whether they can read and write, then
          tap their answer.
        </p>
      ) : null}

      {status !== "loading" ? <YesNoChoice onChoose={choose} /> : null}
    </section>
  );
}
