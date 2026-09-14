import { useState } from "react";

/**
 * How a patient who reads and writes answers back, SRS FR 3.1.
 *
 * Only ever rendered on the literate path. A patient in Guided Interrogation
 * is never shown this, per section 4.3, because a text field is exactly the
 * situation they cannot handle.
 *
 * The patient chooses the language they are writing in. The hearing listener's
 * language is separate and set once per visit, FR 3.4, so a patient writing
 * Twi is still understood by a doctor who only speaks English.
 */

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "tw", label: "Twi" },
];

export default function PatientReply({
  onReply,
  busy = false,
  children = null,
  // "idle" | "working" | "playing" | "spoken" | "failed", from
  // useSpokenResponse. The button is the only place a Deaf patient can see
  // that their answer is being said out loud, so it reports the whole cycle
  // rather than just going disabled.
  speakStatus = "idle",
  onReplay = null,
}) {
  const [sourceLanguage, setSourceLanguage] = useState("tw");
  const [reply, setReply] = useState("");
  const [emptyWarning, setEmptyWarning] = useState(false);

  // Covers both halves of the wait: the request to the language service, then
  // the audio actually playing. From the patient's side it is one action.
  const speaking = speakStatus === "working" || speakStatus === "playing";

  const handleSubmit = async (event) => {
    event.preventDefault();

    const text = reply.trim();
    if (!text) {
      // A Deaf patient cannot hear whether anything was spoken, so a silent
      // no op would leave them believing they had answered the doctor.
      setEmptyWarning(true);
      return;
    }

    setEmptyWarning(false);
    await onReply({ text, sourceLanguage });
    setReply("");
  };

  return (
    <div className="panel">
      <div className="panel__header">
        <span className="role role--patient">Patient</span>
        <h2 className="panel__title">Your reply</h2>

        <fieldset
          className="consultation__languages panel__aside"
          data-testid="reply-language"
        >
          <legend className="consultation__legend">I am writing in</legend>
          {LANGUAGES.map((language) => (
            <label key={language.value} className="consultation__language">
              <input
                type="radio"
                name="reply-language"
                value={language.value}
                checked={sourceLanguage === language.value}
                onChange={() => setSourceLanguage(language.value)}
              />
              {language.label}
            </label>
          ))}
        </fieldset>
      </div>

      {/* Quick answers, above the box rather than below it: for a patient who
          would rather tap than type, the box is the fallback. */}
      {children}

      <form className="reply" onSubmit={handleSubmit}>
        <label className="visually-hidden" htmlFor="patient-reply">
        Type your answer
      </label>
      <textarea
        id="patient-reply"
        className={
          emptyWarning
            ? "consultation__input consultation__input--invalid"
            : "consultation__input"
        }
        rows={3}
        value={reply}
        /* Names the quick answers above as well as the box, because a patient
           who can tap one should not have to work out that typing is optional.
           Placeholder rather than a label: the visible heading and the hidden
           label already name the field, and this says what to do with it. */
        placeholder="Type your answer here, or tap one of the answers above..."
        onChange={(event) => {
          setReply(event.target.value);
          if (emptyWarning) setEmptyWarning(false);
        }}
        aria-invalid={emptyWarning}
        aria-describedby={emptyWarning ? "patient-reply-warning" : undefined}
      />

      {emptyWarning ? (
        <p
          id="patient-reply-warning"
          className="consultation__warning"
          role="alert"
          data-testid="empty-reply-warning"
        >
          Type your answer before sending it to the doctor.
        </p>
      ) : null}

        <button
          type="submit"
          className="consultation__send"
          disabled={busy}
          data-testid="speak-to-doctor"
        >
          {speaking ? (
            <>
              {/* The wave is inside the button because that is where the
                  patient's attention already is, and because it is the same
                  control they pressed: a separate indicator elsewhere on the
                  screen asks them to look for confirmation. */}
              <Wave />
              {speakStatus === "working" ? "Preparing" : "Speaking"}
            </>
          ) : (
            <>
              <span className="btn__icon" aria-hidden="true">
                <SpeakerIcon />
              </span>
              Speak to the doctor
            </>
          )}
        </button>

        {/* The doctor may simply not have been listening, and the patient has
            no way to tell that from having been understood. Offered as soon as
            there is something to repeat, and it costs no further translation:
            it replays the audio already in hand. */}
        {onReplay && !speaking ? (
          <button
            type="button"
            className="stage__replay"
            onClick={onReplay}
            data-testid="replay-answer"
          >
            Say it again for the doctor
          </button>
        ) : null}
      </form>
    </div>
  );
}

/**
 * A sound wave, for an event the patient cannot hear.
 *
 * Bars rather than a spinner: a spinner means "waiting", and this means "your
 * voice is going out now", which is a different thing to tell someone. Drawn
 * with elements rather than an animated image so it cannot fail to load, and
 * it flattens to a static shape under a reduced motion preference.
 */
function Wave() {
  return (
    <span className="wave" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

/* Inline so the control cannot lose its mark on a slow connection. */
function SpeakerIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d="M3 7.6h2.6L10 4.2v11.6L5.6 12.4H3V7.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M13 7.4a3.6 3.6 0 0 1 0 5.2M15.3 5.2a6.8 6.8 0 0 1 0 9.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
