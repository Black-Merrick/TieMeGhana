import { useEffect, useState } from "react";

import { fetchQuestions } from "../api/questions.js";
import AnswerOptionGrid from "./AnswerOptionGrid.jsx";
import SignSequencePlayer from "./SignSequencePlayer.jsx";
import YesNoChoice from "./YesNoChoice.jsx";

/**
 * Guided Interrogation Mode, SRS FR 2.4 to FR 2.7.
 *
 * The path for a patient fluent in GhSL who does not read print. The doctor
 * picks a question from the fixed, pre reviewed bank, the app plays it as a
 * sign video, and the patient answers by tapping a sign video or by nodding.
 *
 * Two things are deliberately absent. There is no free text input anywhere,
 * per section 4.3, which structurally prevents a situation the patient cannot
 * handle. And there is no camera based gesture detection, per FR 2.6: a nod is
 * observed by the doctor in person and confirmed by them on this screen.
 */

const ANSWERED_BY = { PATIENT: "patient", DOCTOR: "doctor" };

export default function GuidedInterrogation() {
  const [questions, setQuestions] = useState([]);
  const [status, setStatus] = useState("loading");
  const [asking, setAsking] = useState(null);
  const [exchanges, setExchanges] = useState([]);

  useEffect(() => {
    let cancelled = false;

    fetchQuestions()
      .then((bank) => {
        if (cancelled) return;
        setQuestions(bank);
        setStatus(bank.length > 0 ? "ready" : "empty");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Record an answer and close the question.
   *
   * `answeredBy` is part of the record because FR 2.7 is specific about it: for
   * a yes or no question it is the doctor's confirmation of what they observed
   * that gets logged, not a reading of the patient's head movement. Keeping
   * that distinction in the data means the transcript cannot later imply the
   * patient tapped something they never touched.
   */
  const recordAnswer = (question, answerText, answeredBy) => {
    setExchanges((previous) => [
      ...previous,
      {
        id: `${question.id}-${previous.length}`,
        question: question.english_text,
        answer: answerText,
        answeredBy,
        at: new Date().toISOString(),
      },
    ]);
    setAsking(null);
  };

  if (status === "loading") {
    return (
      <p className="consultation__working" data-testid="guided-loading">
        <span className="consultation__pulse" aria-hidden="true" />
        Loading the question bank
      </p>
    );
  }

  if (status === "failed") {
    return (
      <p className="consultation__error" role="alert" data-testid="guided-error">
        Could not load the question bank. Check the connection and try again.
      </p>
    );
  }

  if (status === "empty") {
    // Every question needs its GhSL prompt filmed and approved before it can
    // be asked, so an empty bank is the expected state before filming.
    return (
      <p className="consultation__note" data-testid="guided-empty">
        No questions are askable yet. Each one needs its sign video filmed and
        approved by a GhSL consultant first. Ask the patient in person for now.
      </p>
    );
  }

  return (
    <section className="guided">
      {asking ? (
        <AskingQuestion
          question={asking}
          onAnswer={recordAnswer}
          onCancel={() => setAsking(null)}
        />
      ) : (
        <QuestionBank questions={questions} onAsk={setAsking} />
      )}

      {exchanges.length > 0 ? <ExchangeLog exchanges={exchanges} /> : null}
    </section>
  );
}

/** The doctor's view of the bank, grouped the way a clinical checklist is. */
function QuestionBank({ questions, onAsk }) {
  const categories = [...new Set(questions.map((q) => q.category || "other"))];

  return (
    <div className="bank">
      <h2 className="bank__title">Clinical question bank</h2>

      {categories.map((category) => (
        <div key={category} className="bank__group">
          <h3 className="bank__category">{category}</h3>
          <ul className="bank__list">
            {questions
              .filter((q) => (q.category || "other") === category)
              .map((question) => (
                <li key={question.id}>
                  <button
                    type="button"
                    className="bank__question"
                    onClick={() => onAsk(question)}
                    data-testid={`ask-question-${question.id}`}
                  >
                    {question.english_text}
                    {/* The question is stitched from word clips, so coverage
                        grows as footage is filmed. A question with nothing to
                        show is marked rather than hidden, so the doctor can
                        see the gap instead of a bank that looks small. */}
                    {question.is_playable === false ? (
                      <span
                        className="bank__gap"
                        data-testid={`no-signs-${question.id}`}
                      >
                        no signs filmed yet
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** One question being asked, and however the patient answers it. */
function AskingQuestion({ question, onAnswer, onCancel }) {
  const isYesNo = question.question_type === "yes_no";

  return (
    <div className="asking" data-testid="asking-question">
      <p className="asking__doctor-text">{question.english_text}</p>

      {/* What the patient actually sees: the question stitched together from
          the word clips in the library, the same way a caption is. */}
      <SignSequencePlayer sequence={question.prompt_sequence} />

      {/* Coverage, so the doctor knows whether the patient saw the question or
          a row of spelled out letters. */}
      {question.prompt_sequence?.unavailable_tokens?.length > 0 ? (
        <p className="asking__gap" data-testid="asking-gap">
          Not signed:{" "}
          <strong>{question.prompt_sequence.unavailable_tokens.join(", ")}</strong>
          . Ask this question in person instead.
        </p>
      ) : null}

      {isYesNo ? (
        <>
          {/* FR 2.6. The instruction to nod is carried by the sign video
              above. This line is for the doctor, who does the observing. */}
          <p className="asking__instruction" data-testid="nod-instruction">
            Watch the patient nod or shake their head, then tap what you saw.
            This confirmation is what gets recorded.
          </p>
          <YesNoChoice
            onChoose={(yes) =>
              onAnswer(question, yes ? "Yes" : "No", ANSWERED_BY.DOCTOR)
            }
          />
        </>
      ) : (
        <AnswerOptionGrid
          options={question.options}
          onChoose={(option) =>
            onAnswer(question, option.english_text, ANSWERED_BY.PATIENT)
          }
        />
      )}

      <button
        type="button"
        className="asking__cancel"
        onClick={onCancel}
        data-testid="cancel-question"
      >
        Back to the question bank
      </button>
    </div>
  );
}

/**
 * Answers recorded so far this consultation.
 *
 * Held in memory for now. FR 4.1 to 4.3 make this a durable transcript on the
 * patient's own device, which is the next sprint, so the shape here already
 * matches what that will persist: direction, text, and a timestamp.
 */
function ExchangeLog({ exchanges }) {
  return (
    <div className="log" data-testid="exchange-log">
      <h2 className="log__title">This consultation</h2>
      <ol className="log__list">
        {exchanges.map((exchange) => (
          <li key={exchange.id} className="log__entry">
            <span className="log__question">{exchange.question}</span>
            <span className="log__answer">{exchange.answer}</span>
            <span className="log__by">
              {exchange.answeredBy === ANSWERED_BY.DOCTOR
                ? "confirmed by the doctor"
                : "tapped by the patient"}
            </span>
          </li>
        ))}
      </ol>
      <p className="log__warning" data-testid="log-not-saved">
        Not saved yet. The durable transcript on the patient&apos;s own device
        arrives with FR 4.1 to 4.3.
      </p>
    </div>
  );
}
