import CaptionProblem from "./CaptionProblem.jsx";
import CaptionResult from "./CaptionResult.jsx";
import DoctorUtteranceForm from "./DoctorUtteranceForm.jsx";
import PatientReply from "./PatientReply.jsx";
import QuickReplies from "./QuickReplies.jsx";
import SpeakingOverlay from "./SpeakingOverlay.jsx";
import SpokenResponse from "./SpokenResponse.jsx";
import TranscriptView from "./TranscriptView.jsx";
import useCaption from "../hooks/useCaption.js";
import useSpokenResponse from "../hooks/useSpokenResponse.js";
import useTranscript from "../hooks/useTranscript.js";
import { Direction } from "../transcript/transcript.js";

/**
 * The literate patient's path, SRS FR 1.1 to FR 1.7 and FR 2.3.
 *
 * The doctor types or speaks, and the patient reads the Twi caption alongside
 * the GhSL video. A patient on this path can read, so free captioning is
 * appropriate here and only here.
 */
export default function DoctorConsultation({ outputLanguage, onOutputLanguageChange }) {
  const { result, status, send } = useCaption();
  const spoken = useSpokenResponse();
  const transcript = useTranscript();

  /**
   * FR 4.1, the doctor's side of the exchange.
   *
   * Recorded when the patient is actually shown it rather than when it is
   * captioned, because a sentence the safety gate refused was never said to
   * them. See ADR 033.
   */
  const messageShown = (caption) => {
    transcript.record({
      direction: Direction.TO_PATIENT,
      text: caption.transcript,
      language: caption.source_language,
      // The Twi the patient actually read. Kept under the same names the
      // patient's own lines use, so the record can be shown in either language
      // without the view having to know which side of the conversation a line
      // came from.
      translation: caption.caption,
      translationLanguage: caption.caption_language,
      caption: caption.caption,
    });
  };

  /** FR 4.1 and FR 3.1, the patient's typed reply, spoken and recorded. */
  const replyToDoctor = async ({ text, sourceLanguage }) => {
    const said = await spoken.speak({ text, sourceLanguage, outputLanguage });
    if (!said) return;

    // Their own words first, because the record is theirs. The translation the
    // doctor heard is kept beside it rather than instead of it, so the record
    // reads back in either language.
    //
    // It costs nothing to keep: the service produced it a moment ago to speak
    // it. Translating the record later would mean sending a whole
    // consultation to a third party, which is the one thing this app promises
    // never to do, so the moment it is created is the only chance to have it.
    transcript.record({
      direction: Direction.TO_DOCTOR,
      text,
      language: sourceLanguage,
      translation: said.translation_applied ? said.spoken_text : undefined,
      translationLanguage: said.translation_applied ? said.output_language : undefined,
    });
  };

  /* FR 3.1 and 3.4. The patient types or taps, and their answer is spoken
     aloud in whichever language the hearing listener set for this visit.
     Built once and placed wherever the stage needs it, so the two phases
     cannot drift into two different reply forms. */
  const patientReply = (
    <PatientReply
      busy={spoken.showing}
      onReply={replyToDoctor}
      speakStatus={spoken.status}
      onReplay={spoken.canReplay ? spoken.replay : null}
    >
      <QuickReplies
        busy={spoken.status === "working"}
        onChoose={(text) => replyToDoctor({ text, sourceLanguage: "en" })}
      />
    </PatientReply>
  );

  return (
    <section className="consult">
      {/* Covers the screen while the patient's answer is being spoken. One tap
          has to mean one answer: a second one queued underneath would reach
          the doctor as two sentences with nothing to say which was which. */}
      {spoken.showing ? (
        <SpeakingOverlay
          text={spoken.result?.spoken_text ?? null}
          status={spoken.status}
          onStop={spoken.stop}
        />
      ) : null}

      {/* Left: everything the two of them type. Right: what the patient
          watches. Split this way because the device is turned towards the
          patient for the video and back for the typing, and on a desk both
          sides need to be visible at once. On a phone they stack, video
          first. */}
      <div className="consult__doctor">
        <DoctorUtteranceForm
          onSend={send}
          busy={status === "working"}
          outputLanguage={outputLanguage}
          onOutputLanguageChange={onOutputLanguageChange}
        />

        <TranscriptView
          entries={transcript.entries}
          onDiscard={transcript.discard}
        />
      </div>

      <div className="consult__patient">
        {status === "working" ? (
          <p className="consultation__working" data-testid="working-indicator">
            <span className="consultation__pulse" aria-hidden="true" />
            Translating and finding signs
          </p>
        ) : null}

        {status === "failed" ? (
          <p
            className="notice notice--danger"
            data-testid="caption-error"
            role="alert"
          >
            Could not reach the language service. Try again, or type the message
            for the patient to read.
          </p>
        ) : null}

        {result?.caption_problem ? (
          <CaptionProblem problem={result.caption_problem} />
        ) : null}

        {result ? (
          /* The reply is handed to the stage rather than rendered in the
             doctor's column, so it appears where the video was as soon as it
             finishes. The patient is already looking there. */
          <CaptionResult
            result={result}
            onShown={messageShown}
            answers={patientReply}
          />
        ) : (
          /* Before the first message there is nothing to watch, so the stage
             holds the reply instead. FR 3.1 lets a patient on this path say
             something unprompted, and a screen that only offers a reply after
             a question would quietly take that away. */
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

        <SpokenResponse status={spoken.status} result={spoken.result} />
      </div>
    </section>
  );
}
