import { useState } from "react";

import useAudioRecorder from "../hooks/useAudioRecorder.js";

/**
 * How the doctor says something, by typing or speaking, FR 1.1 and FR 1.2.
 *
 * Shared by both interaction paths. A patient who reads gets captions back, a
 * patient in Guided Interrogation gets the same words as a stitched GhSL video
 * and answers yes or no, but the doctor's side is identical either way, so it
 * lives here once. Section 4.4, Consistency.
 */

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "tw", label: "Twi" },
];

export default function DoctorUtteranceForm({
  onSend,
  busy = false,
  sendLabel = "Send to patient",
  placeholder = "Where does it hurt?",
}) {
  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [message, setMessage] = useState("");
  const recorder = useAudioRecorder();

  const isRecording = recorder.status === "recording";

  const handleSubmit = async (event) => {
    event.preventDefault();

    const text = message.trim();
    if (!text) return;

    await onSend({ sourceLanguage, text });
    setMessage("");
  };

  const handleMicrophone = async () => {
    if (isRecording) {
      const audio = await recorder.stop();
      // No audio means the doctor tapped stop immediately. Sending an empty
      // recording would spend a metered transcription call for nothing.
      if (audio) await onSend({ sourceLanguage, audio });
      return;
    }

    await recorder.start();
  };

  return (
    <>
      <form className="consultation__form" onSubmit={handleSubmit}>
        <fieldset className="consultation__languages" data-testid="doctor-language">
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
          placeholder={placeholder}
        />

        <div className="consultation__actions">
          <button
            type="submit"
            className="consultation__send"
            disabled={busy || isRecording}
          >
            {sendLabel}
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
              disabled={busy}
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
          The recording could not be completed on this device. Type the message
          instead.
        </p>
      ) : null}

      {/* SRS 4.2, Feedback. The doctor must be able to see the microphone is
          live, since nothing else on screen would tell them. */}
      {isRecording ? (
        <p className="consultation__working" data-testid="recording-indicator">
          <span className="consultation__pulse" aria-hidden="true" />
          Recording. Speak now, then tap Stop and send.
        </p>
      ) : null}
    </>
  );
}
