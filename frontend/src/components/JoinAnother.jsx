/** The way out of an ended consultation, and into the code box for the next. */
export default function JoinAnother({ onLeave }) {
  return (
    <div className="pairing__actions">
      <button
        type="button"
        className="pairing__primary"
        onClick={onLeave}
        data-testid="join-another"
      >
        Join another consultation
      </button>
    </div>
  );
}
