import { useEffect, useState } from "react";

import CaptionProblem from "./CaptionProblem.jsx";
import { CaptionStage } from "./CaptionResult.jsx";
import PatientReply from "./PatientReply.jsx";
import QuickReplies from "./QuickReplies.jsx";
import JoinAnother from "./JoinAnother.jsx";
import SentReplyStatus from "./SentReplyStatus.jsx";
import SpeakingOverlay from "./SpeakingOverlay.jsx";
import TranscriptView from "./TranscriptView.jsx";
import useSpeechFeedback from "../hooks/useSpeechFeedback.js";
import useTranscript from "../hooks/useTranscript.js";
import { Direction } from "../transcript/transcript.js";

/**
 * The literate patient's half of a consultation, on their own phone.
 *
 * No `useCaption`, no message box, and no ADR 033 gate. Everything shown here
 * already cleared the doctor's device before it was sent, so this screen has
 * nothing left to check, and the staff facing refusal and confirmation
 * panels never reach it. What it keeps is its own copy of FR 4.2: what it
 * shows and what the patient says are recorded on this phone, the same as on
 * the shared device, just fed by the connection instead of a local request.
 *
 * The patient still types or taps their reply here, but it is not spoken
 * here. It is sent to the doctor's device, which speaks it where the doctor
 * can hear it (FR 3.5), and reports back how that is going so this screen can
 * show the same wave and "say it again" the shared screen does.
 *
 * The reply form is on screen before any question has arrived, as it is on
 * the shared device: FR 3.1 lets a patient on this path say something
 * unprompted. See ADR 053.
 */
export default function DoctorConsultationGuest({
  channel,
  offline = false,
  forceEnded = false,
  onLeave = null,
}) {
  const transcript = useTranscript();
  const [result, setResult] = useState(null);
  const [ended, setEnded] = useState(false);
  // Following the answer while the doctor's device speaks it: what to show,
  // what to feel, and how to stop it. The patient's own words, not the
  // translation, are what it shows back.
  const speech = useSpeechFeedback(channel);

  useEffect(() => {
    const message = channel.lastMessage;
    if (!message) return;

    if (message.type === "question") {
      const caption = message.result;
      setResult(caption);
      speech.reset();
      // The same record the shared screen writes when the patient is shown
      // a message, under the same names, so the saved copy reads the same
      // whichever way the visit was run. Not for one sent again after a
      // reconnect: this phone already has it in its own record, and would
      // otherwise show the same question twice.
      if (message.resent) return;
      transcript.record({
        direction: Direction.TO_PATIENT,
        text: caption.transcript,
        language: caption.source_language,
        translation: caption.caption,
        translationLanguage: caption.caption_language,
        caption: caption.caption,
      });
    } else if (message.type === "ended") {
      setEnded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.lastMessage]);

  /**
   * FR 3.1 and FR 4.1, the patient's reply, sent to be spoken.
   *
   * Recorded here immediately rather than waiting to hear it was spoken, so
   * the patient's own record survives even if the connection drops right
   * after they tap. It carries no translation: whether one was needed is only
   * known on the doctor's device once the service has answered, and that
   * device keeps it in its own copy.
   */
  const replyToDoctor = async ({ text, sourceLanguage }) => {
    transcript.record({
      direction: Direction.TO_DOCTOR,
      text,
      language: sourceLanguage,
    });
    // Assumed working until the doctor's device says otherwise, so a second
    // tap in the moment before its first report arrives is not a second reply.
    speech.begin(text);
    channel.send({ type: "reply", text, sourceLanguage });
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

  const speaking = speech.busy;

  const patientReply = (
    <PatientReply
      busy={speaking}
      onReply={replyToDoctor}
      speakStatus={speech.status}
      feedback={<SentReplyStatus status={speech.status} text={speech.text} />}
      onReplay={
        speech.status === "spoken" || speech.status === "stopped"
          ? speech.replay
          : null
      }
    >
      {/* Disabled while speaking as well as while preparing. On the shared
          device a full screen overlay stops a second tap while the answer
          plays; this phone has no overlay, so the buttons themselves have to
          hold still, or one tap could become two replies. */}
      <QuickReplies
        busy={speaking}
        onChoose={(text) => replyToDoctor({ text, sourceLanguage: "en" })}
      />
    </PatientReply>
  );

  return (
    <section className="consult consult--guest">
      {/* The same talking face the doctor's device shows, and for the same
          reason: the patient cannot hear their answer, so it is shown being
          said. It also stops a second tap landing on top of the first. */}
      {speech.busy ? (
        <SpeakingOverlay text={speech.text} status={speech.status} onStop={speech.stop} />
      ) : null}

      <div className="consult__patient">
        {result?.caption_problem ? (
          <CaptionProblem problem={result.caption_problem} />
        ) : null}

        {/* Locked while the phone is finding the doctor's device again: a reply
            sent now would be queued for a connection that is not there, and
            arrive later, out of turn. Still shown, so the patient keeps their
            place; only the controls stop. */}
        <div className="offline-lock" inert={offline}>
        {result ? (
          <CaptionStage result={result} answers={patientReply} />
        ) : (
          <div className="stage" data-testid="stage-idle">
            <div className="stage__bar">
              <span className="stage__chip">
                <span className="shell__dot" aria-hidden="true" />
                Your reply
              </span>
              <span className="stage__room">Ghanaian Sign Language</span>
            </div>
            <p className="stage__empty stage__empty--compact">
              The doctor&apos;s message will appear here in Ghanaian Sign
              Language. You can also write to them now.
            </p>
            <div className="stage__answers">{patientReply}</div>
          </div>
        )}
        </div>

        <TranscriptView
          entries={transcript.entries}
          onDiscard={transcript.discard}
          onOwnPhone
        />
      </div>
    </section>
  );
}
