import { useEffect, useState } from "react";

import AnswerOptionGrid from "./AnswerOptionGrid.jsx";
import CaptionProblem from "./CaptionProblem.jsx";
import { CaptionStage } from "./CaptionResult.jsx";
import JoinAnother from "./JoinAnother.jsx";
import SentReplyStatus from "./SentReplyStatus.jsx";
import SpeakingOverlay from "./SpeakingOverlay.jsx";
import TranscriptView from "./TranscriptView.jsx";
import useSpeechFeedback from "../hooks/useSpeechFeedback.js";
import useTranscript from "../hooks/useTranscript.js";
import { fetchBodyLocations } from "../api/clips.js";
import { Direction } from "../transcript/transcript.js";

/**
 * The patient's half of Guided Interrogation, on their own device.
 *
 * No `useCaption`, no `DoctorUtteranceForm`, and no ADR 033 gate: everything
 * shown here already cleared the doctor's device before it was sent, so
 * there is nothing left for this screen to check. What it does keep is its
 * own independent copy of FR 4.2: it records what it shows and what it sends
 * back to its own device's storage, the same as the single device path
 * does, just fed by the network instead of a local API call.
 *
 * A Yes/No question is answered on the doctor's device, per FR 2.7 (see
 * GuidedInterrogationHost). This screen shows a notice instead of buttons
 * for those. "Where does it hurt" is answered here, exactly as it always
 * was the patient's own direct tap.
 */
export default function GuidedInterrogationGuest({
  channel,
  offline = false,
  forceEnded = false,
  onLeave = null,
}) {
  const transcript = useTranscript();
  const [result, setResult] = useState(null);
  const [awaitingLocation, setAwaitingLocation] = useState(false);
  const [bodyLocations, setBodyLocations] = useState(null);
  const [ended, setEnded] = useState(false);
  // Following the tapped location while the doctor's device speaks it. See
  // useSpeechFeedback.
  const speech = useSpeechFeedback(channel);

  useEffect(() => {
    fetchBodyLocations()
      .then(setBodyLocations)
      .catch(() => setBodyLocations([]));
  }, []);

  useEffect(() => {
    const message = channel.lastMessage;
    if (!message) return;

    if (message.type === "question") {
      speech.reset();
      setResult(message.result);
      setAwaitingLocation(Boolean(message.awaitingLocation));
      // Not for one sent again after a reconnect: this phone already has it in
      // its own record, and would otherwise show the same question twice.
      if (message.resent) return;
      transcript.record({
        direction: Direction.TO_PATIENT,
        text: message.result.transcript,
        caption: message.result.caption,
      });
    } else if (message.type === "ended") {
      setEnded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.lastMessage]);

  const chooseLocation = (location) => {
    transcript.record({
      direction: Direction.TO_DOCTOR,
      text: location.english_text,
      answeredBy: "patient",
    });
    speech.begin(location.english_text);
    channel.send({
      type: "answer",
      value: location.english_text,
      answeredBy: "patient",
    });
    setResult(null);
    setAwaitingLocation(false);
  };

  if (ended || forceEnded) {
    return (
      <section className="consult consult--guest">
        <div className="pairing pairing--card" data-testid="pairing-ended">
          <h2 className="pairing__title">This consultation has ended</h2>
          <p className="pairing__hint" role="status">
            {transcript.entries.length > 0
              ? "You can close this page. Your record of it is below, and stays on this phone until you delete it."
              : "You can close this page."}
          </p>
          {onLeave ? <JoinAnother onLeave={onLeave} /> : null}
        </div>
        {/* Still here after it ends. This is the patient's own phone, so
            nothing clears the record for them the way starting a new patient
            does on the shared device, and a record they can neither see nor
            delete is the one thing this app must not leave behind. */}
        <TranscriptView
          entries={transcript.entries}
          onDiscard={transcript.discard}
          onOwnPhone
        />
      </section>
    );
  }

  return (
    <section className="consult consult--guest">
      {/* The talking face, as on the doctor's device: the patient cannot hear
          their answer being spoken, so it is shown. */}
      {speech.busy ? (
        <SpeakingOverlay text={speech.text} status={speech.status} onStop={speech.stop} />
      ) : null}

      <div className="consult__patient">
        {result?.caption_problem ? (
          <CaptionProblem problem={result.caption_problem} />
        ) : null}

        {/* Locked while the phone is finding the doctor's device again: a
            location tapped now would be queued for a connection that is not
            there. Still shown, so the patient keeps their place. */}
        <div className="offline-lock" inert={offline}>
        {result ? (
          <CaptionStage
            result={result}
            answers={
              awaitingLocation ? (
                <BodyLocationAnswer
                  locations={bodyLocations}
                  onChoose={chooseLocation}
                />
              ) : (
                <WaitingOnDoctorConfirmation />
              )
            }
          />
        ) : (
          <div className="stage" data-testid="stage-idle">
            <div className="stage__bar">
              <span className="stage__chip">
                <span className="shell__dot" aria-hidden="true" />
                Sign video
              </span>
              <span className="stage__room">Ghanaian Sign Language</span>
            </div>
            <p className="stage__empty">
              Waiting for the doctor to ask a question.
            </p>
          </div>
        )}
        </div>

        <SentReplyStatus status={speech.status} text={speech.text} />

        <TranscriptView
          entries={transcript.entries}
          onDiscard={transcript.discard}
          onOwnPhone
        />
      </div>
    </section>
  );
}

/** Mirrors GuidedInterrogation.jsx's own, since a body location grid needs
    to behave identically wherever it is shown, per SRS section 4.4. */
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

function WaitingOnDoctorConfirmation() {
  return (
    <p
      className="asking__instruction"
      data-testid="waiting-on-doctor-confirmation"
    >
      The doctor is confirming what they observed.
    </p>
  );
}
