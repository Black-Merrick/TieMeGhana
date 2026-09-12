import CaptionResult from "./CaptionResult.jsx";
import DoctorUtteranceForm from "./DoctorUtteranceForm.jsx";
import useCaption from "../hooks/useCaption.js";

/**
 * The literate patient's path, SRS FR 1.1 to FR 1.7 and FR 2.3.
 *
 * The doctor types or speaks, and the patient reads the Twi caption alongside
 * the GhSL video. A patient on this path can read, so free captioning is
 * appropriate here and only here.
 */
export default function DoctorConsultation() {
  const { result, status, send } = useCaption();

  return (
    <section className="consultation">
      <DoctorUtteranceForm onSend={send} busy={status === "working"} />

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
