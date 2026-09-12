/**
 * What the patient sees while their answer is being spoken, SRS section 4.2.
 *
 * A Deaf patient cannot hear whether their answer actually reached the doctor,
 * so the confirmation has to be visual as well as physical. The waveform runs
 * while audio plays and resolves into a completed state when it finishes,
 * which is exactly what section 4.2 asks for. The vibration side lives in
 * useSpokenResponse, per the vocabulary in section 6.
 */
export default function SpokenResponse({ status, result }) {
  if (status === "idle") return null;

  return (
    <div className="spoken" data-testid="spoken-response">
      {status === "working" ? (
        <p className="consultation__working" data-testid="spoken-preparing">
          <span className="consultation__pulse" aria-hidden="true" />
          Preparing the spoken answer
        </p>
      ) : null}

      {status === "playing" ? (
        <p className="spoken__playing" data-testid="spoken-playing">
          <Waveform />
          Speaking your answer to the doctor
        </p>
      ) : null}

      {status === "spoken" ? (
        <p className="spoken__done" data-testid="spoken-done">
          <span className="spoken__tick" aria-hidden="true">
            ✓
          </span>
          Your answer was spoken aloud
        </p>
      ) : null}

      {status === "failed" ? (
        <p className="consultation__error" role="alert" data-testid="spoken-error">
          The answer could not be spoken aloud. Show this screen to the doctor
          instead.
        </p>
      ) : null}

      {/* What was actually said, so the doctor can check it even if they were
          not listening, and so the patient can see it was their answer. */}
      {result?.spoken_text ? (
        <p className="spoken__text" data-testid="spoken-text">
          “{result.spoken_text}”
        </p>
      ) : null}

      {/* ADR 011. Stub audio is silence, so presenting it as speech would be
          the worst kind of overclaim: everyone would assume the doctor heard. */}
      {result?.language_provider === "stub" ? (
        <p className="result__warning" data-testid="spoken-stub-warning">
          Development language service. That audio was{" "}
          <strong>silence, not speech</strong>. Nobody heard the answer. Switch
          to the Khaya provider for real Twi and English speech.
        </p>
      ) : null}
    </div>
  );
}

/**
 * An animated waveform, per section 4.2.
 *
 * Inline SVG with a CSS animation rather than a spinner, because it should read
 * as sound happening rather than as the app being busy. Honours a reduced
 * motion preference in the stylesheet.
 */
function Waveform() {
  return (
    <svg
      className="spoken__wave"
      viewBox="0 0 48 24"
      aria-hidden="true"
      focusable="false"
    >
      {[0, 1, 2, 3, 4].map((bar) => (
        <rect
          key={bar}
          className={`spoken__bar spoken__bar--${bar}`}
          x={bar * 10 + 2}
          y="6"
          width="5"
          height="12"
          rx="2.5"
        />
      ))}
    </svg>
  );
}
