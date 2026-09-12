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

export default function PatientReply({ onReply, busy = false }) {
  const [sourceLanguage, setSourceLanguage] = useState("tw");
  const [reply, setReply] = useState("");
  const [emptyWarning, setEmptyWarning] = useState(false);

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
    <form className="reply" onSubmit={handleSubmit}>
      <h2 className="reply__title">Your reply</h2>

      <fieldset className="consultation__languages" data-testid="reply-language">
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

      <label className="consultation__field" htmlFor="patient-reply">
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

      <button type="submit" className="consultation__send" disabled={busy}>
        Speak to the doctor
      </button>
    </form>
  );
}
