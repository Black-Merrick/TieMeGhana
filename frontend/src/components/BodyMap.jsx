import { VibrationPattern, vibrate } from "../feedback/vibration.js";

/**
 * A tappable outline of a human body, SRS FR 5.2.
 *
 * Section 4.5 is specific about why this is a drawing rather than a list:
 * "The body map looks like an actual outline of a human body, so tapping the
 * stomach or the head feels like pointing, not like operating a menu."
 *
 * That matters more in an emergency than anywhere else in the app. A patient
 * in distress, or a first responder who has never seen this before, does not
 * read a menu. They point.
 *
 * It also needs no footage at all, which is what makes Emergency Triage usable
 * before a single clip is filmed. The patient is pointing at a picture of a
 * body, not choosing between sign videos.
 */

// Each region is its own shape so the whole area is the tap target, per
// section 4.5's requirement that options visibly invite a tap. Ordered head
// downwards, matching the body location set the rest of the app uses.
const REGIONS = [
  { id: "HEAD", label: "Head", shape: <circle cx="100" cy="34" r="27" /> },
  { id: "THROAT", label: "Throat", shape: <rect x="88" y="61" width="24" height="16" rx="6" /> },
  {
    id: "CHEST",
    label: "Chest",
    shape: <rect x="61" y="77" width="78" height="60" rx="14" />,
  },
  {
    id: "STOMACH",
    label: "Stomach",
    shape: <rect x="66" y="139" width="68" height="50" rx="12" />,
  },
  {
    id: "WAIST",
    label: "Waist",
    shape: <rect x="70" y="191" width="60" height="28" rx="10" />,
  },
  {
    id: "ARM",
    label: "Arm",
    shape: (
      <>
        <rect x="35" y="82" width="23" height="125" rx="11" />
        <rect x="142" y="82" width="23" height="125" rx="11" />
      </>
    ),
  },
  {
    id: "HAND",
    label: "Hand",
    shape: (
      <>
        <circle cx="46" cy="222" r="15" />
        <circle cx="154" cy="222" r="15" />
      </>
    ),
  },
  {
    id: "LEG",
    label: "Leg",
    shape: (
      <>
        <rect x="73" y="221" width="25" height="140" rx="12" />
        <rect x="102" y="221" width="25" height="140" rx="12" />
      </>
    ),
  },
  {
    id: "FOOT",
    label: "Foot",
    shape: (
      <>
        <ellipse cx="85" cy="374" rx="17" ry="12" />
        <ellipse cx="115" cy="374" rx="17" ry="12" />
      </>
    ),
  },
];

export default function BodyMap({ onChoose, chosenId = null, disabled = false }) {
  const choose = (region) => {
    if (disabled) return;

    // A standard tap, not an emergency alert. Pointing at where it hurts is
    // ordinary input, so it gets the ordinary confirmation pulse from the
    // vocabulary in SRS section 6.
    vibrate(VibrationPattern.TAP_SELECTION);
    onChoose(region);
  };

  return (
    <svg
      className="body"
      viewBox="0 0 200 395"
      role="group"
      aria-label="Where does it hurt"
      data-testid="body-map"
    >
      {REGIONS.map((region) => (
        <g
          key={region.id}
          className={
            chosenId === region.id ? "body__part body__part--chosen" : "body__part"
          }
          // SVG shapes are not natively focusable or clickable, so the role,
          // the label and the key handling are all explicit. Without them the
          // map would be unusable with a keyboard or a screen reader.
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-label={region.label}
          aria-pressed={chosenId === region.id}
          onClick={() => choose(region)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              choose(region);
            }
          }}
          data-testid={`body-part-${region.id}`}
        >
          {region.shape}
        </g>
      ))}
    </svg>
  );
}
