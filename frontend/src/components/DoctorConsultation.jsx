import CaptionResult from "./CaptionResult.jsx";
import DoctorUtteranceForm from "./DoctorUtteranceForm.jsx";
import PatientReply from "./PatientReply.jsx";
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
      caption: caption.caption,
    });
  };

  /** FR 4.1 and FR 3.1, the patient's typed reply, spoken and recorded. */
  const replyToDoctor = async ({ text, sourceLanguage }) => {
    const said = await spoken.speak({ text, sourceLanguage, outputLanguage });
    // Recorded as what the patient wrote, not the translation, because the
    // record is theirs and should read back in their own words.
    if (said) transcript.record({ direction: Direction.TO_DOCTOR, text });
  };

  /* FR 3.1 and 3.4. The patient types or taps, and their answer is spoken
     aloud in whichever language the hearing listener set for this visit.
     Built once and placed wherever the stage needs it, so the two phases
     cannot drift into two different reply forms. */
  const patientReply = (
    <PatientReply
      busy={spoken.status === "working" || spoken.status === "playing"}
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
      {spoken.status === "working" || spoken.status === "playing" ? (
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

/**
 * Answers a patient can tap instead of typing, FR 3.1.
 *
 * Typing is still the general case, because a patient on this path reads and
 * writes. These are the handful of answers frequent enough that typing them
 * again is friction rather than expression, and each one goes through exactly
 * the same path as a typed reply: spoken aloud, then recorded in the
 * transcript as the patient's own words. Nothing is said on their behalf that
 * they did not tap.
 *
 * Deliberately short. A long list becomes a menu to read, which is the thing
 * this is meant to save them from.
 */
const QUICK_REPLIES = [
  { mark: "\u{1F44D}", text: "Yes", twi: "Aane" },
  { mark: "\u{1F44E}", text: "No", twi: "Daabi" },
  { mark: "\u{26A1}", text: "The pain is severe" },
  { mark: "\u{1F48A}", text: "I have taken the medicine" },
  { mark: "\u{1F501}", text: "Please show that again" },
];

function QuickReplies({ onChoose, busy }) {
  return (
    <div className="quick" role="group" aria-label="Quick answers">
      {QUICK_REPLIES.map((reply) => (
        <button
          key={reply.text}
          type="button"
          className="quick__option"
          onClick={() => onChoose(reply.text)}
          disabled={busy}
          data-testid={`quick-reply-${reply.text.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <span aria-hidden="true">{reply.mark}</span>
          {reply.text}
          {reply.twi ? (
            <span className="quick__twi" lang="tw">
              / {reply.twi}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
