import { Waveform } from "./SpokenResponse.jsx";

/**
 * What the patient's own phone shows about the answer they just gave.
 *
 * SRS section 4.2: a Deaf patient cannot hear whether their answer reached the
 * doctor, so every stage of it has to be visible, on the device in their hand.
 * On the shared device the doctor's screen and the patient's are the same
 * screen, so its confirmation is already in front of them. With two devices
 * the answer is spoken on the other one, and without this the phone showed a
 * disabled button and nothing else. See ADR 053.
 *
 * `status` is the doctor's device's own report, sent back as it changes:
 * working, playing, spoken, stopped or failed. `text` is what the patient
 * wrote or tapped, shown back to them in their own words so it is clear which
 * answer this is about.
 */
export default function SentReplyStatus({ status, text }) {
  if (status === "idle" || !text) return null;

  return (
    <div className="sent" data-testid="sent-reply" data-status={status}>
      {status === "working" ? (
        <p className="consultation__working" data-testid="sent-reply-working">
          <span className="consultation__pulse" aria-hidden="true" />
          Sending your answer to the doctor
        </p>
      ) : null}

      {status === "playing" ? (
        <p className="spoken__playing" data-testid="sent-reply-playing">
          <Waveform />
          The doctor&apos;s device is speaking your answer
        </p>
      ) : null}

      {status === "spoken" ? (
        <p className="spoken__done" data-testid="sent-reply-spoken">
          <span className="spoken__tick" aria-hidden="true">
            ✓
          </span>
          Your answer was spoken to the doctor
        </p>
      ) : null}

      {status === "stopped" ? (
        <p className="spoken__stopped" data-testid="sent-reply-stopped">
          The doctor stopped it before the whole answer was said. Tap
          &ldquo;Say it again&rdquo; to repeat it.
        </p>
      ) : null}

      {status === "blocked" ? (
        <p className="spoken__stopped" role="status" data-testid="sent-reply-blocked">
          The doctor&apos;s device needs a touch before it can speak your
          answer. Show this screen to the doctor.
        </p>
      ) : null}

      {status === "failed" ? (
        <p className="consultation__error" role="alert" data-testid="sent-reply-failed">
          Your answer could not be spoken aloud. Show this screen to the
          doctor instead.
        </p>
      ) : null}

      <p className="spoken__text" data-testid="sent-reply-text">
        &ldquo;{text}&rdquo;
      </p>
    </div>
  );
}
