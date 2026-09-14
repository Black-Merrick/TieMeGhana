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
  placeholder = "Where does it hurt? Type your clinical instructions or question here...",
  title = "Message for the patient",
  children = null,
  outputLanguage = null,
  onOutputLanguageChange = null,
}) {
  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [message, setMessage] = useState("");
  const [emptyWarning, setEmptyWarning] = useState(false);
  const recorder = useAudioRecorder();

  const isRecording = recorder.status === "recording";

  const handleSubmit = async (event) => {
    event.preventDefault();

    const text = message.trim();
    if (!text) {
      // Doing nothing silently is the worst response here. Mid consultation
      // the doctor would reasonably assume the message went to the patient and
      // carry on waiting for an answer that is never coming.
      setEmptyWarning(true);
      return;
    }

    setEmptyWarning(false);
    await onSend({ sourceLanguage, text });
    setMessage("");
  };

  const handleChange = (event) => {
    setMessage(event.target.value);
    // Cleared as soon as they start typing, so the warning never lingers to
    // contradict what is on screen.
    if (emptyWarning) setEmptyWarning(false);
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
    <div className="panel">
      {/* The chip, the heading and the language control on one row. The
          language is set once and then stopped being looked at, so it belongs
          beside the title rather than above the box as a bordered group of
          its own. */}
      <div className="panel__header">
        <span className="role role--doctor">Doctor</span>
        <h2 className="panel__title">{title}</h2>

        <fieldset
          className="consultation__languages panel__aside"
          data-testid="doctor-language"
        >
          <legend className="consultation__legend">I speak</legend>
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

        {/* FR 3.4, the language the patient's answers are spoken aloud in.
            Beside the doctor's own input language rather than up in the top
            bar: they are the two halves of one decision, made once at the
            start of the visit, and section 4.1 asks for them to be on screen
            rather than in a menu, which this still is. */}
        {onOutputLanguageChange ? (
          <fieldset
            className="consultation__languages"
            data-testid="output-language"
          >
            <legend className="consultation__legend">Speak in</legend>
            {LANGUAGES.map((language) => (
              <label key={language.value} className="consultation__language">
                <input
                  type="radio"
                  name="output-language"
                  value={language.value}
                  checked={outputLanguage === language.value}
                  onChange={() => onOutputLanguageChange(language.value)}
                />
                {language.label}
              </label>
            ))}
          </fieldset>
        ) : null}
      </div>

      <form className="consultation__form" onSubmit={handleSubmit}>
        {/* Kept as the field's own label rather than leaning on the panel
            heading, because a screen reader reads the label, not the card it
            sits in. Visually hidden: the heading above says the same thing.

            The wording does not follow the heading. This is the same control
            on both paths, and section 4.4 asks for consistency, so its
            accessible name stays put while the heading above it says what this
            particular screen is for. */}
        <label className="visually-hidden" htmlFor="doctor-message">
          Message for the patient
        </label>
        <textarea
          id="doctor-message"
          className={
            emptyWarning
              ? "consultation__input consultation__input--invalid"
              : "consultation__input"
          }
          rows={3}
          value={message}
          onChange={handleChange}
          placeholder={placeholder}
          aria-invalid={emptyWarning}
          aria-describedby={emptyWarning ? "doctor-message-warning" : undefined}
        />

        {emptyWarning ? (
          <p
            id="doctor-message-warning"
            className="consultation__warning"
            role="alert"
            data-testid="empty-message-warning"
          >
            {recorder.isSupported
              ? "Type a message, or tap Speak to patient, before sending."
              : "Type a message before sending."}
          </p>
        ) : null}

        <div className="consultation__actions">
          <button
            type="submit"
            className="consultation__send"
            disabled={busy || isRecording}
          >
            <span className="btn__icon" aria-hidden="true">
              <SendIcon />
            </span>
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
              <span className="btn__icon" aria-hidden="true">
                <MicIcon />
              </span>
              {isRecording ? "Stop and send" : "Speak to patient"}
            </button>
          ) : null}
        </div>
      </form>

      {/* Anything the caller wants under the box, such as the "ask where it
          hurts" action on the guided path. */}
      {children}

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
    </div>
  );
}

/* Inline so a control cannot lose its mark on a slow connection. */
function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d="M2.5 10 17 3.5 13.5 17 9.5 11.5 2.5 10Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect
        x="7.6"
        y="2.2"
        width="4.8"
        height="9"
        rx="2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M4.8 9.4a5.2 5.2 0 0 0 10.4 0M10 14.6v3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
