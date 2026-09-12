import { useState } from "react";

import { captionUtterance } from "../api/consultation.js";
import useAudioRecorder from "../hooks/useAudioRecorder.js";
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
  const recorder = useAudioRecorder();

  /**
   * Caption one utterance, however it was captured.
   *
   * Shared by typing and speaking so the two cannot drift apart, and so the
   * selected language is applied identically to both.
   */
  const sendUtterance = async (payload) => {
    setStatus("working");
    setResult(null);

    try {
      setResult(await captionUtterance({ sourceLanguage, ...payload }));
      setStatus("idle");
    } catch {
      // The doctor's next action is to retry or type, so the failure has to be
      // visible on screen. Swallowing it would leave them waiting silently.
      setStatus("failed");
    }
  };

  const handleSend = async (event) => {
    event.preventDefault();

    const text = message.trim();
    if (!text) return;

    await sendUtterance({ text });
  };

  const handleMicrophone = async () => {
    if (recorder.status === "recording") {
      const audio = await recorder.stop();
      // No audio means the doctor tapped stop immediately. Sending an empty
      // recording would spend a transcription call to get nothing back.
      if (audio) await sendUtterance({ audio });
      return;
    }

    await recorder.start();
  };

  const isRecording = recorder.status === "recording";

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

        <div className="consultation__actions">
          <button
            type="submit"
            className="consultation__send"
            disabled={status === "working" || isRecording}
          >
            Send to patient
          </button>

          {recorder.isSupported ? (
            <button
              type="button"
              className={
                isRecording
                  ? "consultation__mic consultation__mic--recording"
                  : "consultation__mic"
              }
              onClick={handleMicrophone}
              disabled={status === "working"}
              data-testid="microphone-button"
            >
              {isRecording ? "Stop and send" : "Speak to patient"}
            </button>
          ) : null}
        </div>
      </form>

      {/* FR 1.2 falls back to typing rather than disappearing, because NFR 6
          targets browsers that differ in microphone support. The two reasons
          are told apart because only one of them is fixable by us. */}
      {recorder.support === "insecure" ? (
        <p className="consultation__note" data-testid="microphone-insecure">
          The microphone needs a secure connection. Open the app over{" "}
          <strong>https</strong>, or on the same machine as the server, to speak.
          Typing works either way.
        </p>
      ) : null}

      {recorder.support === "unsupported" ? (
        <p className="consultation__note" data-testid="microphone-unsupported">
          This browser cannot record audio. Type the message instead.
        </p>
      ) : null}

      {recorder.status === "denied" ? (
        <p className="consultation__note" data-testid="microphone-denied" role="alert">
          Microphone access was refused. Allow it in your browser settings, or
          type the message instead.
        </p>
      ) : null}

      {recorder.status === "failed" ? (
        <p className="consultation__note" data-testid="microphone-failed" role="alert">
          Recording could not start on this device. Type the message instead.
        </p>
      ) : null}

      {/* SRS 4.2, Feedback. The doctor must be able to see that the microphone
          is live, since nothing else on screen would tell them. */}
      {isRecording ? (
        <p className="consultation__working" data-testid="recording-indicator">
          <span className="consultation__pulse" aria-hidden="true" />
          Recording. Speak now, then tap Stop and send.
        </p>
      ) : null}

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
