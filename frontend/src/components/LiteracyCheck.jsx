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
 * The question is asked in sign video and printed beside it, and answered with
 * the shared Yes and No options. The sign video is what a patient who does not
 * read acts on, which is the whole point: a patient who cannot read must be
 * able to answer the question about whether they can read.
 *
 * FR 2.1 asks for "sign video only, no text". The text is here at the team's
 * direction, recorded as ADR 047. The reasoning and the limit of it: the video
 * is the question, the text is a second rendering of the same question for
 * whoever can use it, and neither the answer options nor the routing depend on
 * anyone reading anything.
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
      <p className="literacy__eyebrow">
        <span className="shell__dot shell__dot--connected" aria-hidden="true" />
        Patient literacy check
      </p>

      {/* Printed whether or not the video can be shown, per ADR 047. It is a
          second rendering of the question, never a replacement: a patient who
          does not read still has the sign video and the icons. */}
      <div>
        <h2 className="literacy__question">Can you read and write?</h2>
        <p className="literacy__question-twi" lang="tw">
          Wotumi kan na wokyer&#603;w ade&#603; anaa?
        </p>
      </div>

      {status === "loading" ? (
        <p className="literacy__loading" data-testid="literacy-loading">
          <span className="consultation__pulse" aria-hidden="true" />
        </p>
      ) : null}

      {status === "ready" ? (
        <div className="literacy__video">
          <SignSequencePlayer sequence={singleClipSequence(promptClip)} />
        </div>
      ) : null}

      {/* Staff facing, not patient facing. Until the prompt is filmed the app
          cannot ask the question itself, so it says so rather than pretending
          the patient understood a blank screen. */}
      {status === "unavailable" ? (
        <p
          className="notice notice--warn literacy__unavailable"
          data-testid="literacy-unavailable"
        >
          <span className="notice__icon" aria-hidden="true">
            <InfoIcon />
          </span>
          <span>
            The sign video for this question has not been filmed and approved
            yet. Ask the patient in person whether they can read and write,
            then tap their answer. The printed question above is not a
            substitute: a patient who does not read has not been asked.
          </span>
        </p>
      ) : null}

      {status !== "loading" ? <YesNoChoice onChoose={choose} /> : null}
    </section>
  );
}

/* Inline rather than an icon font, so a notice cannot lose the mark that
   distinguishes it from body text on a slow connection. */
function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 8.8v5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="10" cy="6.2" r="1.05" fill="currentColor" />
    </svg>
  );
}
