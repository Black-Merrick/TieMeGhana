/**
 * What the patient sees while their answer is being spoken aloud.
 *
 * SRS section 4.2 requires feedback for every action, and this is the action
 * with the least natural feedback in the whole app: a Deaf patient cannot hear
 * their own answer leave the device. So it is shown rather than implied, with a
 * mouth that moves, a wave, and the words that are being said.
 *
 * It covers the screen on purpose. Tapping a second body part while the first
 * is still being spoken would queue two answers the doctor hears back to back
 * with no idea which came from which tap, and in triage that is a wrong answer
 * rather than a clumsy one. Blocking input for the couple of seconds it takes
 * is the cheapest way to make one tap mean one answer.
 *
 * There is still a way out. An audio element that stalls would otherwise trap
 * the patient behind a dialog with no dismiss, which in an emergency is worse
 * than the ambiguity it prevents, so Stop is always available.
 */
export default function SpeakingOverlay({ text, status, onStop }) {
  const preparing = status === "working";

  return (
    <div className="talk" data-testid="speaking-overlay">
      <div
        className="talk__card"
        role="dialog"
        aria-modal="true"
        aria-label="Speaking to the doctor"
      >
        <TalkingFace />

        <p className="talk__status">
          <span className="wave" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
          {preparing ? "Preparing your answer" : "Speaking to the doctor"}
        </p>

        {/* The words themselves, read by whoever is treating the patient and
            announced to a screen reader. Quoted so it is clear this is what is
            being said rather than an instruction. */}
        {text ? (
          <p className="talk__text" aria-live="polite" data-testid="speaking-text">
            &ldquo;{text}&rdquo;
          </p>
        ) : null}

        <button
          type="button"
          className="talk__stop"
          onClick={onStop}
          data-testid="stop-speaking"
        >
          Stop
        </button>
      </div>
    </div>
  );
}

/**
 * A face with a moving mouth.
 *
 * The mouth is scaled rather than morphed between shapes, because CSS cannot
 * interpolate one path into another and a script driven mouth would be a
 * timing loop to keep in step with audio it cannot read. Open and shut at
 * speaking pace is all this has to convey: that sound is coming out.
 */
function TalkingFace() {
  return (
    <svg
      className="talk__face"
      viewBox="0 0 120 120"
      role="img"
      aria-label="A face speaking"
      data-testid="talking-face"
    >
      <circle className="talk__head" cx="60" cy="60" r="46" />

      {/* Ears, so the head reads as a head at this size. */}
      <ellipse className="talk__head" cx="13" cy="60" rx="7" ry="11" />
      <ellipse className="talk__head" cx="107" cy="60" rx="7" ry="11" />

      <circle className="talk__eye" cx="44" cy="48" r="4.5" />
      <circle className="talk__eye" cx="76" cy="48" r="4.5" />
      <path className="talk__brow" d="M36 38q8-5 16-1" />
      <path className="talk__brow" d="M84 38q-8-5-16-1" />
      <path className="talk__nose" d="M60 56v10q-4 4-7 1" />

      {/* The mouth. Its own group so the scaling has a stable origin. */}
      <g className="talk__mouth">
        <ellipse cx="60" cy="86" rx="15" ry="9" />
      </g>
    </svg>
  );
}
