import { useId } from "react";

import { VibrationPattern, vibrate } from "../feedback/vibration.js";
import { DETAIL_MARKS, REGIONS, SILHOUETTE, VIEW_BOX } from "./bodySilhouette.js";

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
 *
 * The figure itself lives in `bodySilhouette.js`. It is one continuous contour,
 * and every region here is clipped to it, so a region can only ever cover the
 * part of the body that is actually there. A horizontal band across the chest
 * comes out chest shaped.
 */
export default function BodyMap({ onChoose, chosenId = null, disabled = false }) {
  // An id per instance. Two maps on one page sharing a clip path id would have
  // the second silently reuse the first one's clip.
  const clipId = `${useId()}-body`;

  const choose = (region) => {
    if (disabled) return;

    // A standard tap, not an emergency alert. Pointing at where it hurts is
    // ordinary input, so it gets the ordinary confirmation pulse from the
    // vocabulary in SRS section 6.
    vibrate(VibrationPattern.TAP_SELECTION);
    onChoose(region);
  };

  const chosen = REGIONS.find((region) => region.id === chosenId) ?? null;

  return (
    <figure className="body">
      <svg
        className="body__figure"
        viewBox={`0 0 ${VIEW_BOX.width} ${VIEW_BOX.height}`}
        role="group"
        aria-label="Where does it hurt"
        data-testid="body-map"
      >
        <defs>
          <clipPath id={clipId}>
            <path d={SILHOUETTE} />
          </clipPath>
        </defs>

        {/* The body itself, so an untouched figure reads as one shape rather
            than as nine tiles waiting to be coloured in. */}
        <path className="body__fill" d={SILHOUETTE} />

        <g clipPath={`url(#${clipId})`}>
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
              {/* Arms and hands come in pairs, so a region can own more than
                  one shape. Either side of the body says the same thing. */}
              {region.outlines.map((points, index) => (
                <polygon key={index} points={points} />
              ))}
            </g>
          ))}
        </g>

        {/* Contour and interior marks last, so a selected region is tinted
            underneath them and the body keeps its edges. Neither takes taps:
            they sit over the regions and would otherwise swallow them. */}
        <path className="body__outline" d={SILHOUETTE} />
        <g className="body__detail">
          {DETAIL_MARKS.map((mark) => (
            <path key={mark} d={mark} />
          ))}
        </g>
      </svg>

      {/* Read by the clinician, and announced to a screen reader. The patient
          has the tinted region and the spoken output; this is confirmation for
          whoever is treating them that the tap landed where they think. */}
      <figcaption className="body__chosen" aria-live="polite" data-testid="body-chosen">
        {chosen ? chosen.label : ""}
      </figcaption>
    </figure>
  );
}
