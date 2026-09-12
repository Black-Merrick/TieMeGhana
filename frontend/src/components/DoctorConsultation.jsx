import { useState } from "react";

import { captionUtterance } from "../api/consultation.js";
import SignSequencePlayer from "./SignSequencePlayer.jsx";

/**
 * The doctor's side of the consultation, SRS FR 1.1 to FR 1.7.
 *
 * Three of the five interaction principles in SRS section 4 shape this screen
 * directly. The language choice stays on screen rather than in a settings menu
 * (4.1 Visibility). The caption and the sign video appear together, never as
 * tabs (4.1 again). A status indicator shows while the pipeline is working, so
 * the doctor is never left wondering whether their action registered
 * (4.2 Feedback).
 */

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "tw", label: "Twi" },
];

export default function DoctorConsultation() {
  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("idle");

  const handleSend = async (event) => {
    event.preventDefault();

    const text = message.trim();
    if (!text) return;

    setStatus("working");
    setResult(null);

    try {
      setResult(await captionUtterance({ sourceLanguage, text }));
      setStatus("idle");
    } catch {
      // The doctor's next action is to retry or type, so the failure has to be
      // visible on screen. Swallowing it would leave them waiting silently.
      setStatus("failed");
    }
  };

  return (
    <section className="consultation">
      <form className="consultation__form" onSubmit={handleSend}>
        <fieldset className="consultation__languages">
          <legend className="consultation__legend">I am speaking</legend>
          {LANGUAGES.map((language) => (
            <label key={language.value} className="consultation__language">
              <input
                type="radio"
                name="source-language"
                value={language.value}
                checked={sourceLanguage === language.value}
                onChange={() => setSourceLanguage(language.value)}
              />
              {language.label}
            </label>
          ))}
        </fieldset>

        <label className="consultation__field" htmlFor="doctor-message">
          Message for the patient
        </label>
        <textarea
          id="doctor-message"
          className="consultation__input"
          rows={3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Where does it hurt?"
        />

        <button
          type="submit"
          className="consultation__send"
          disabled={status === "working"}
        >
          Send to patient
        </button>
      </form>

      {status === "working" ? (
        <p className="consultation__working" data-testid="working-indicator">
          <span className="consultation__pulse" aria-hidden="true" />
          Translating and finding signs
        </p>
      ) : null}

      {status === "failed" ? (
        <p className="consultation__error" data-testid="caption-error" role="alert">
          Could not reach the language service. Try again, or type the message
          for the patient to read.
        </p>
      ) : null}

      {result ? <CaptionResult result={result} /> : null}
    </section>
  );
}

/**
 * The caption and its sign video, shown together.
 *
 * Split out because it has a single job and the form above has another, rather
 * than because it is reused.
 */
function CaptionResult({ result }) {
  const { fingerspelled_tokens: spelled, unavailable_tokens: missing } =
    result.sequence;

  return (
    <div className="result">
      {result.language_provider === "stub" ? (
        <p className="result__warning" data-testid="provider-warning">
          Development language service. This caption was <strong>not</strong>{" "}
          translated into Twi, so it still reads in the language it was typed
          in. Add a Khaya API key for real translation.
        </p>
      ) : null}

      <p className="result__caption" data-testid="caption" lang={result.caption_language}>
        {result.caption}
      </p>

      <SignSequencePlayer sequence={result.sequence} />

      {spelled.length > 0 || missing.length > 0 ? (
        <div className="result__coverage" data-testid="coverage-notice">
          <p>
            {spelled.length > 0 ? (
              <>
                Spelled letter by letter, no sign in the library yet:{" "}
                <strong>{spelled.join(", ")}</strong>.{" "}
              </>
            ) : null}
            {missing.length > 0 ? (
              <>
                Could not be signed at all: <strong>{missing.join(", ")}</strong>
                .
              </>
            ) : null}
          </p>
          {/* Signs are keyed on English glosses, so when one is missing the
              doctor needs to see the English that was actually searched for.
              With Twi input that is a translation, not what they typed. */}
          <p data-testid="lookup-text">
            Signs were looked up from: “{result.sign_lookup_text}”
          </p>
        </div>
      ) : null}
    </div>
  );
}
