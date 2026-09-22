import { useEffect, useState } from "react";

import { WHERE_DOES_IT_HURT } from "../api/clips.js";
import useCaption from "../hooks/useCaption.js";
import {
  clearLastQuestion,
  loadLastQuestion,
  saveLastQuestion,
} from "../pairing/lastQuestion.js";
import CaptionProblem from "./CaptionProblem.jsx";
import CaptionResult from "./CaptionResult.jsx";
import DoctorUtteranceForm from "./DoctorUtteranceForm.jsx";
import SpeakingOverlay from "./SpeakingOverlay.jsx";
import SpokenResponse from "./SpokenResponse.jsx";
import TranscriptView from "./TranscriptView.jsx";
import YesNoChoice from "./YesNoChoice.jsx";
import useSpeakingReports from "../hooks/useSpeakingReports.js";
import useSpokenResponse from "../hooks/useSpokenResponse.js";
import useTranscript from "../hooks/useTranscript.js";
import {
  loadCurrentExchange,
  saveCurrentExchange,
} from "../consultation/currentExchange.js";
import { Direction } from "../transcript/transcript.js";

/**
 * The doctor's half of Guided Interrogation, on its own device.
 *
 * Everything here is identical to the single device path in
 * GuidedInterrogation.jsx, and deliberately so: the same `useCaption`, the
 * same ADR 033 safety gate, the same FR 2.7 reasoning for who answers what.
 * Two things change. `questionShown` also broadcasts the result to the
 * patient's device once it has cleared the gate, never before, so the
 * patient's screen can never show anything this device has not already
 * decided is safe. And a Yes/No question keeps its buttons here, because
 * FR 2.7 is specific that the doctor can record what they personally
 * observed, a nod or a shake of the head, which no device across the room can
 * stand in for.
 *
 * The patient can also tap Yes or No on their own phone. That is their own
 * direct answer, like the body location, and is recorded as the patient's
 * (`answeredBy`), so the record still says who said what. Whichever comes
 * first is the answer: the other device is told the question has been
 * answered, and a tap that arrives after that is not recorded.
 */

const ANSWERED_BY = { PATIENT: "patient", DOCTOR: "doctor" };

/** What a phone may answer a Yes/No question with. Nothing else is believed. */
const YES_NO = new Set(["Yes", "No"]);

/**
 * A name for one question, so an answer can say which question it is for.
 * Without it a tap on a Yes/No the doctor had already answered, or on one
 * from before a reload, would be recorded against whatever came next.
 */
function newQuestionId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export default function GuidedInterrogationHost({
  outputLanguage,
  onOutputLanguageChange,
  channel,
}) {
  const { result, status, send, clear } = useCaption();
  const spoken = useSpokenResponse();
  const transcript = useTranscript();
  useSpeakingReports(channel, spoken);

  const [shownFor, setShownFor] = useState(null);
  // The question the phone has just been told is answered, so it is sent after
  // the report of the answer being spoken and not on top of it: the connection
  // hands the phone only the newest of two messages that arrive together.
  const [answeredQuestion, setAnsweredQuestion] = useState(null);

  const [awaitingLocation, setAwaitingLocation] = useState(
    () => loadCurrentExchange()?.awaitingLocation ?? false,
  );

  const expectLocation = (expected) => {
    setAwaitingLocation(expected);
    saveCurrentExchange({ awaitingLocation: expected });
  };

  /** FR 2.7: doctor confirmed, or patient answered on their own device. */
  const recordAnswer = (answerText, answeredBy) => {
    spoken.speak({
      text: answerText,
      sourceLanguage: "en",
      outputLanguage,
    });

    transcript.record({
      direction: Direction.TO_DOCTOR,
      text: answerText,
      answeredBy,
    });

    expectLocation(false);
    clear();
    // Answered, so there is nothing to show a returning phone: it would find
    // a question that has already been dealt with waiting for it.
    const answered = loadLastQuestion()?.id ?? null;
    clearLastQuestion();
    if (answered) setAnsweredQuestion({ id: answered });
  };

  // Tells the phone which question has been answered, so it stops offering
  // Yes and No for it. Declared after `useSpeakingReports`, so it goes out after
  // the "working" report the same answer produced.
  useEffect(() => {
    if (!answeredQuestion) return;
    channel.send({ type: "answered", id: answeredQuestion.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answeredQuestion]);

  // The patient's device tapped a body location, or Yes or No, and sent it
  // back. FR 3.5 still applies on two devices: the spoken confirmation has to
  // play where the doctor can hear it, which is here, never on the tapping
  // device.
  useEffect(() => {
    const message = channel.lastMessage;
    if (message?.type !== "answer") return;

    if (message.kind !== "yesno") {
      recordAnswer(message.value, message.answeredBy);
      return;
    }

    // Yes or No is for the question it was tapped on, and only while that
    // question is still open: the one kept for a returning phone, which is
    // cleared the moment the question is answered by either device.
    const open = loadLastQuestion();
    if (open?.id && open.id === message.for && !open.awaitingLocation && YES_NO.has(message.value)) {
      recordAnswer(message.value, ANSWERED_BY.PATIENT);
    } else if (typeof message.for === "string") {
      // Already answered, or not a question this device asked. Said so, so the
      // phone stops waiting for it to be spoken.
      channel.send({ type: "answered", id: message.for, stale: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.lastMessage]);

  const askWhereItHurts = async () => {
    const caption = await send({
      sourceLanguage: "en",
      text: WHERE_DOES_IT_HURT,
    });
    expectLocation(caption !== null);
  };

  const askFreely = async (payload) => {
    expectLocation(false);
    await send(payload);
  };

  /**
   * A question the patient has now seen, FR 4.1, and the broadcast point for
   * two-device mode. Nothing crosses the wire until this fires, which is the
   * same moment the safety gate in CaptionResult has already let the
   * sentence through: the patient's device never needs a gate of its own,
   * because it is never sent anything that has not already cleared one.
   */
  const questionShown = (caption) => {
    setShownFor(caption);
    transcript.record({
      direction: Direction.TO_PATIENT,
      text: caption.transcript,
      caption: caption.caption,
    });
    const question = {
      type: "question",
      result: caption,
      awaitingLocation,
      path: "guided",
      id: newQuestionId(),
    };
    channel.send(question);
    // Kept, so a phone that reloads is shown it again when it comes back.
    saveLastQuestion(question);
  };

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
          onSend={askFreely}
          busy={status === "working"}
          sendLabel="Ask the patient"
          title="Ask the patient"
          outputLanguage={outputLanguage}
          onOutputLanguageChange={onOutputLanguageChange}
          placeholder="Did you vomit? Type a question the patient can answer yes or no."
        >
          <button
            type="button"
            className="guided__where"
            onClick={askWhereItHurts}
            disabled={status === "working"}
            data-testid="ask-where-it-hurts"
          >
            Ask where it hurts
          </button>
        </DoctorUtteranceForm>

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
            Could not reach the language service. Try again, or ask the patient
            in person.
          </p>
        ) : null}

        {result?.caption_problem ? (
          <CaptionProblem problem={result.caption_problem} />
        ) : null}

        {result ? (
          <CaptionResult
            result={result}
            onShown={questionShown}
            answers={
              shownFor !== result ? null : awaitingLocation ? (
                <WaitingOnPatientDevice />
              ) : (
                <YesNoAnswer
                  onChoose={(yes) =>
                    recordAnswer(yes ? "Yes" : "No", ANSWERED_BY.DOCTOR)
                  }
                />
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
              The question will appear here in Ghanaian Sign Language, and the
              patient answers underneath.
            </p>
          </div>
        )}

        <SpokenResponse
          status={spoken.status}
          result={spoken.result}
          onPlay={spoken.replay}
        />
      </div>
    </section>
  );
}

/** FR 2.6 and FR 2.7, the patient nods or taps and the doctor confirms. */
function YesNoAnswer({ onChoose }) {
  return (
    <div className="answer">
      <p className="asking__instruction" data-testid="nod-instruction">
        The patient can tap Yes or No on their own phone, or nod or shake their
        head. If they nod or shake, tap what you saw. Whichever comes first is
        what gets recorded, and the record says who answered.
      </p>
      <YesNoChoice onChoose={onChoose} />
    </div>
  );
}

/** FR 2.5, answered on the patient's own device in two-device mode. */
function WaitingOnPatientDevice() {
  return (
    <p
      className="asking__instruction"
      data-testid="waiting-on-patient-device"
    >
      The patient is choosing where it hurts on their own device.
    </p>
  );
}
