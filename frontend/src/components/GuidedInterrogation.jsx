import { useEffect, useState } from "react";

import { WHERE_DOES_IT_HURT, fetchBodyLocations } from "../api/clips.js";
import useCaption from "../hooks/useCaption.js";
import AnswerOptionGrid from "./AnswerOptionGrid.jsx";
import CaptionResult from "./CaptionResult.jsx";
import DoctorUtteranceForm from "./DoctorUtteranceForm.jsx";
import SpokenResponse from "./SpokenResponse.jsx";
import TranscriptView from "./TranscriptView.jsx";
import YesNoChoice from "./YesNoChoice.jsx";
import useSpokenResponse from "../hooks/useSpokenResponse.js";
import useTranscript from "../hooks/useTranscript.js";
import {
  loadCurrentExchange,
  saveCurrentExchange,
} from "../consultation/currentExchange.js";
import { Direction } from "../transcript/transcript.js";

/**
 * Guided Interrogation Mode, SRS FR 2.4 to FR 2.7.
 *
 * The path for a patient fluent in GhSL who does not read print. The doctor
 * asks in their own words, exactly as they would for a patient who reads, and
 * the question is played to the patient as a stitched GhSL video. The
 * difference is entirely on the patient's side: they answer yes or no, by
 * tapping or by nodding for the doctor to confirm, rather than typing.
 *
 * Asking freely rather than picking from a fixed bank is a deliberate
 * departure from FR 2.4, recorded as ADR 023. "Where does it hurt" is the one
 * question that cannot be answered yes or no, so it has its own action which
 * shows the body locations for the patient to point to.
 *
 * Two things are deliberately absent. The patient is never shown a text input,
 * per section 4.3. And there is no camera based gesture detection, per FR 2.6:
 * a nod is observed by the doctor in person and confirmed by them here.
 */

const ANSWERED_BY = { PATIENT: "patient", DOCTOR: "doctor" };

export default function GuidedInterrogation({ outputLanguage }) {
  const { result, status, send, clear } = useCaption();
  const spoken = useSpokenResponse();
  const transcript = useTranscript();
  // The utterance the patient has actually seen. Identity rather than a
  // boolean, so a new question is never inherited as already shown.
  const [shownFor, setShownFor] = useState(null);
  const [bodyLocations, setBodyLocations] = useState(null);

  // Restored with the question, so a reload part way through "where does it
  // hurt" does not drop the patient back to a yes or no they were not asked.
  const [awaitingLocation, setAwaitingLocation] = useState(
    () => loadCurrentExchange()?.awaitingLocation ?? false,
  );

  /** Remember whether a body location is expected, across a reload. */
  const expectLocation = (expected) => {
    setAwaitingLocation(expected);
    saveCurrentExchange({ awaitingLocation: expected });
  };

  useEffect(() => {
    let cancelled = false;

    fetchBodyLocations()
      .then((locations) => {
        if (!cancelled) setBodyLocations(locations);
      })
      .catch(() => {
        // The body location grid is unavailable, but every other question
        // still works, so this degrades rather than blocking the mode.
        if (!cancelled) setBodyLocations([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Record an answer against the question that produced it.
   *
   * `answeredBy` is part of the record because FR 2.7 is specific: for a yes
   * or no question it is the doctor's confirmation of what they observed that
   * gets logged, not a reading of the patient's head movement. Keeping the
   * distinction in the data means the transcript can never imply the patient
   * tapped something they never touched.
   */
  const recordAnswer = (answerText, answeredBy) => {
    // FR 3.5. A tapped answer is spoken aloud too, not just a typed one,
    // because the doctor's hands are on the patient rather than the screen and
    // they may not be looking when the patient answers.
    spoken.speak({
      text: answerText,
      sourceLanguage: "en",
      outputLanguage,
    });

    // FR 4.1. `answeredBy` is kept because FR 2.7 is specific: for a yes or no
    // question it is the doctor's confirmation of what they observed that gets
    // logged, so the record can never imply the patient tapped something they
    // never touched.
    transcript.record({
      direction: Direction.TO_DOCTOR,
      text: answerText,
      answeredBy,
    });

    expectLocation(false);
    clear();
  };

  const askWhereItHurts = async () => {
    const caption = await send({
      sourceLanguage: "en",
      text: WHERE_DOES_IT_HURT,
    });
    // Only switch to the location grid if the question actually reached the
    // patient. Otherwise they would be asked to point at nothing.
    expectLocation(caption !== null);
  };

  const askFreely = async (payload) => {
    expectLocation(false);
    await send(payload);
  };

  /**
   * A question the patient has now seen, FR 4.1.
   *
   * Recorded when it is shown rather than when it is captioned. A sentence
   * refused by the safety gate, or one still waiting for the doctor to check
   * it, was never asked, and a record claiming otherwise would be worse than
   * no record. See ADR 033.
   */
  const questionShown = (caption) => {
    setShownFor(caption);
    transcript.record({
      direction: Direction.TO_PATIENT,
      text: caption.transcript,
      caption: caption.caption,
    });
  };

  return (
    <section className="guided">
      <DoctorUtteranceForm
        onSend={askFreely}
        busy={status === "working"}
        sendLabel="Ask the patient"
        placeholder="Did you vomit?"
      />

      {/* The one question a patient cannot answer yes or no, so it has its own
          action. Their answer tells the doctor where to focus next. */}
      <button
        type="button"
        className="guided__where"
        onClick={askWhereItHurts}
        disabled={status === "working"}
        data-testid="ask-where-it-hurts"
      >
        Ask where it hurts
      </button>

      {status === "working" ? (
        <p className="consultation__working" data-testid="working-indicator">
          <span className="consultation__pulse" aria-hidden="true" />
          Translating and finding signs
        </p>
      ) : null}

      {status === "failed" ? (
        <p className="consultation__error" data-testid="caption-error" role="alert">
          Could not reach the language service. Try again, or ask the patient in
          person.
        </p>
      ) : null}

      {result ? (
        <>
          <CaptionResult result={result} onShown={questionShown} />

          {/* Answers appear only once the patient has actually seen the
              question. A refused sentence is never answerable. */}
          {shownFor !== result ? null : awaitingLocation ? (
            <BodyLocationAnswer
              locations={bodyLocations}
              onChoose={(location) =>
                recordAnswer(location.english_text, ANSWERED_BY.PATIENT)
              }
            />
          ) : (
            <YesNoAnswer
              onChoose={(yes) =>
                recordAnswer(yes ? "Yes" : "No", ANSWERED_BY.DOCTOR)
              }
            />
          )}
        </>
      ) : null}

      <SpokenResponse status={spoken.status} result={spoken.result} />

      <TranscriptView
        entries={transcript.entries}
        onDiscard={transcript.discard}
      />
    </section>
  );
}

/** FR 2.6 and FR 2.7, the patient nods or taps and the doctor confirms. */
function YesNoAnswer({ onChoose }) {
  return (
    <div className="answer">
      <p className="asking__instruction" data-testid="nod-instruction">
        The patient can tap Yes or No, or nod or shake their head. If they nod,
        tap what you saw. Either way, what is tapped here is what gets recorded.
      </p>
      <YesNoChoice onChoose={onChoose} />
    </div>
  );
}

/** FR 2.5, the body locations a patient points to after "where does it hurt". */
function BodyLocationAnswer({ locations, onChoose }) {
  if (locations === null) {
    return (
      <p className="consultation__working" data-testid="locations-loading">
        <span className="consultation__pulse" aria-hidden="true" />
        Loading body locations
      </p>
    );
  }

  const complete =
    locations.length > 0 && locations.every((location) => location.is_playable);

  if (!complete) {
    // A partial grid is worse than no grid. A patient offered three body parts
    // when their pain is in a fourth taps the nearest available one, and that
    // wrong answer looks exactly like a right one. See ADR 022.
    return (
      <p className="asking__gap" data-testid="incomplete-locations" role="alert">
        Not every body location has been filmed yet, so the grid is not shown.
        Showing part of it would push the patient towards whichever place is
        merely closest. Ask them to point to it in person instead.
      </p>
    );
  }

  return <AnswerOptionGrid options={locations} onChoose={onChoose} />;
}
