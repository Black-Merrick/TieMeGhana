/**
 * Whether the hospital system is reachable, SRS section 4.1.
 *
 * Shown as signal bars rather than as a sentence. The sentence was accurate and
 * took a third of the bar on a phone, and on a screen this dense the thing that
 * is true almost all the time should be the quietest thing on it.
 *
 * What the words were doing has to survive the change, and two properties carry
 * it. The state is distinguished by shape, not colour: three bars filled, one
 * bar filled, or bars struck through. And the wording is still there, as the
 * accessible name and as the tooltip, so a screen reader reads exactly what it
 * read before and a doctor unsure of the icon can hover it.
 */

const LABELS = {
  checking: "Checking connection to the hospital system",
  connected: "Connected to the hospital system",
  offline: "Offline, cached content only",
};

export default function ConnectionStatus({ state }) {
  const label = LABELS[state] ?? LABELS.checking;

  return (
    <span
      className={`signal signal--${state}`}
      role="img"
      aria-label={label}
      title={label}
      data-testid="connection-status"
      data-state={state}
    >
      <svg viewBox="0 0 22 18" aria-hidden="true" focusable="false">
        {/* Three bars, shortest first. Which of them are filled is the state,
            so the distinction holds in greyscale and for a colour blind
            reader. */}
        <rect className="signal__bar signal__bar--1" x="1" y="11" width="4" height="6" rx="1.4" />
        <rect className="signal__bar signal__bar--2" x="8" y="6.5" width="4" height="10.5" rx="1.4" />
        <rect className="signal__bar signal__bar--3" x="15" y="1" width="4" height="16" rx="1.4" />

        {/* Struck through when offline. A slash is the one signal convention
            that reads the same everywhere, and it is a shape rather than a
            colour. */}
        {state === "offline" ? (
          <path
            className="signal__slash"
            d="M2 16.5 20 2"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        ) : null}
      </svg>
    </span>
  );
}
