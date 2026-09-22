import { useEffect, useState } from "react";

import CaptionProblem from "./CaptionProblem.jsx";
import CaptionResult from "./CaptionResult.jsx";
import DoctorUtteranceForm from "./DoctorUtteranceForm.jsx";
import SpeakingOverlay from "./SpeakingOverlay.jsx";
import { StubNotice } from "./SpokenResponse.jsx";
import TranscriptView from "./TranscriptView.jsx";
import useCaption from "../hooks/useCaption.js";
import { saveLastQuestion } from "../pairing/lastQuestion.js";
import useSpeakingReports from "../hooks/useSpeakingReports.js";
import useSpokenResponse from "../hooks/useSpokenResponse.js";
import useTranscript from "../hooks/useTranscript.js";
import { Direction } from "../transcript/transcript.js";

/**
 * The doctor's half of a literate consultation, on its own device.
 *
 * Identical to the shared device screen in DoctorConsultation.jsx wherever it
 * can be: the same hooks, the same ADR 033 gate, and the same `replyToDoctor`
 * that speaks a reply and then records it. Three things differ.
 *
 * `messageShown` also sends the message to the patient's phone, once it has
 * cleared the gate and never before, so that phone can only ever be shown
 * what this one has already decided is safe.
 *
 * The reply form is not here. The patient writes on their own phone and it
 * arrives as a `reply` message, which runs through the same `replyToDoctor`,
 * so the words are still spoken on this device, where the doctor is
 * listening, per FR 3.5. The audio itself never crosses the connection.
 *
 * And this device reports what it is doing with that reply (`speaking`), so
 * the patient's phone can show the same wave and "say it again" the shared
 * screen does, and can ask for a repeat (`replay`), which plays the audio it
 * already holds without a second translation call, per ADR 015. See ADR 053.
 */

/** Only what `/speak/` accepts is passed on to it, whoever sent it. */
const REPLY_LANGUAGES = new Set(["en", "tw"]);
const MAX_REPLY_LENGTH = 1000;

function acceptableReply(message) {
  return (
    typeof message?.text === "string" &&
    message.text.trim().length > 0 &&
    message.text.length <= MAX_REPLY_LENGTH &&
    REPLY_LANGUAGES.has(message.sourceLanguage)
  );
}

export default function DoctorConsultationHost({
  outputLanguage,
  onOutputLanguageChange,
  channel,
}) {
  const { result, status, send } = useCaption();
  const spoken = useSpokenResponse();
  const transcript = useTranscript();
  // The patient's latest reply as it arrived, in the words they wrote or
  // tapped. Shown in the patient half of this screen, so the doctor can read
  // what they are hearing and see it arrive, instead of only being told that a
  // reply is expected. Cleared when the next message is sent to the patient:
  // it belongs to the turn it answered.
  const [patientReply, setPatientReply] = useState(null);

  /** FR 4.1, the doctor's side of the exchange, and the broadcast point. */
  const messageShown = (caption) => {
    transcript.record({
      direction: Direction.TO_PATIENT,
      text: caption.transcript,
      language: caption.source_language,
      translation: caption.caption,
      translationLanguage: caption.caption_language,
      caption: caption.caption,
    });
    setPatientReply(null);
    const question = { type: "question", result: caption, path: "literate" };
    channel.send(question);
    // Kept, so a phone that reloads is shown it again when it comes back.
    saveLastQuestion(question);
  };

  /** FR 4.1 and FR 3.1, the patient's reply, spoken here and recorded. */
  const replyToDoctor = async ({ text, sourceLanguage }) => {
    const said = await spoken.speak({ text, sourceLanguage, outputLanguage });
    if (!said) return;

    transcript.record({
      direction: Direction.TO_DOCTOR,
      text,
      language: sourceLanguage,
      translation: said.translation_applied ? said.spoken_text : undefined,
      translationLanguage: said.translation_applied ? said.output_language : undefined,
    });
  };

  useEffect(() => {
    const message = channel.lastMessage;
    if (message?.type === "reply" && acceptableReply(message)) {
      setPatientReply({ text: message.text, sourceLanguage: message.sourceLanguage });
      replyToDoctor({ text: message.text, sourceLanguage: message.sourceLanguage });
    } else if (message?.type === "replay" && spoken.canReplay) {
      spoken.replay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.lastMessage]);

  useSpeakingReports(channel, spoken);

  return (
    <section className="consult">
      {spoken.showing ? (
        <SpeakingOverlay
          text={spoken.result?.spoken_text ?? null}
          status={spoken.status}
          onStop={spoken.stop}
        />
      ) : null}

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
          <CaptionResult
            result={result}
            onShown={messageShown}
            answers={<ReplyingOnPatientPhone reply={patientReply} spoken={spoken} />}
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
            <p className="stage__empty stage__empty--compact">
              The message will appear here in Ghanaian Sign Language, and on the
              patient&apos;s phone.
            </p>
            <div className="stage__answers">
              <ReplyingOnPatientPhone reply={patientReply} spoken={spoken} />
            </div>
          </div>
        )}

      </div>
    </section>
  );
}

/**
 * The patient half of this screen, in a paired visit.
 *
 * The reply form is on the patient's own phone, so what belongs here is the
 * reply itself: what they wrote or tapped, in their words, and how it is going
 * as it is spoken on this device. It stays after it has been said, until the
 * next message goes out, so the doctor who looked away can still read it.
 * Before the first reply it says what to expect. See ADR 053.
 *
 * ADR 011 still applies to what is spoken here, so the development service's
 * silence is announced beside it exactly as on the shared screen.
 */
function ReplyingOnPatientPhone({ reply, spoken }) {
  const status = spoken.status;
  const said = spoken.result?.spoken_text;
  const translated = Boolean(said) && spoken.result?.translation_applied && said !== reply?.text;

  return (
    <div className="asking__instruction patient-reply" data-testid="replying-on-patient-phone">
      <p className="patient-reply__lead">
        The patient replies on their own phone. Their answer is spoken here.
      </p>

      {reply ? (
        <div className="patient-reply__body" data-testid="patient-reply">
          <p className="patient-reply__label">
            Patient&apos;s reply
            <span className="patient-reply__language">
              {reply.sourceLanguage === "tw" ? "Twi" : "English"}
            </span>
          </p>
          <p className="patient-reply__text" data-testid="patient-reply-text">
            &ldquo;{reply.text}&rdquo;
          </p>

          {translated ? (
            <p className="patient-reply__said" data-testid="patient-reply-said">
              Spoken as &ldquo;{said}&rdquo;
            </p>
          ) : null}

          <p
            className={`patient-reply__status patient-reply__status--${status}`}
            role="status"
            data-testid="patient-reply-status"
          >
            {REPLY_STATUS[status] ?? ""}
          </p>

          {status === "blocked" ? (
            <button
              type="button"
              className="spoken__play"
              onClick={spoken.replay}
              data-testid="play-patient-reply"
            >
              Play the patient&apos;s answer
            </button>
          ) : null}

          <StubNotice result={spoken.result} />
        </div>
      ) : null}
    </div>
  );
}

/** In the doctor's terms: this device is the one speaking. */
const REPLY_STATUS = {
  working: "Preparing to speak the patient's answer…",
  playing: "Speaking the patient's answer now",
  spoken: "Spoken to you ✓",
  stopped: "Stopped before the whole answer was said",
  blocked:
    "The browser is holding back the sound until this device is touched. Tap the button to hear it.",
  failed:
    "Could not be spoken aloud. Read the reply above, or ask the patient to say it again.",
};
