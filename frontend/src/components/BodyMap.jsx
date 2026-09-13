import { useId } from "react";

import { VibrationPattern, vibrate } from "../feedback/vibration.js";
import {
  ARM_PATHS,
  CLIPS,
  DETAIL_MARKS,
  EAR_PATHS,
  FACE_MARKS,
  FACE_PATH,
  FACE_REGIONS,
  FACE_VIEW_BOX,
  REGIONS,
  TRUNK_PATH,
  VIEW_BOX,
} from "./bodySilhouette.js";

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
 * Two figures, not one. The face is drawn enlarged beside the body because an
 * eye on a full length figure is about fifteen pixels across on a phone, which
 * is far below what a person in distress can hit. Printed anatomical charts
 * enlarge the head for the same reason.
 */
export default function BodyMap({ onChoose, chosenId = null, disabled = false }) {
  const chosen =
    [...REGIONS, ...FACE_REGIONS].find((region) => region.id === chosenId) ?? null;

  // Ids per instance. Two maps on one page sharing a clip path id would have
  // the second silently reuse the first one's clip.
  const base = useId();
  const clipId = (name) => `${base}-${name}`;

  const choose = (region) => {
    if (disabled) return;

    // A standard tap, not an emergency alert. Pointing at where it hurts is
    // ordinary input, so it gets the ordinary confirmation pulse from the
    // vocabulary in SRS section 6.
    vibrate(VibrationPattern.TAP_SELECTION);
    onChoose(region);
  };

  const regionGroup = (region) => (
    <g
      key={`${region.clip}-${region.id}`}
      className={
        chosenId === region.id ? "body__part body__part--chosen" : "body__part"
      }
      clipPath={`url(#${clipId(region.clip)})`}
      // SVG shapes are not natively focusable or clickable, so the role, the
      // label and the key handling are all explicit. Without them the map
      // would be unusable with a keyboard or a screen reader.
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
      {/* Arms, hands, eyes and ears come in pairs, so a region can own more
          than one shape. Either side of the body says the same thing. */}
      {region.outlines.map((points, index) => (
        <polygon key={index} points={points} />
      ))}
    </g>
  );

  return (
    <div className="body">
      <div className="body__figure-wrap body__figure-wrap--face">
        <p className="body__caption">Head</p>
        <svg
          className="body__face"
          viewBox={`0 0 ${FACE_VIEW_BOX.width} ${FACE_VIEW_BOX.height}`}
          role="group"
          aria-label="Point to the part of the face"
          data-testid="face-map"
        >
          <defs>
            <clipPath id={clipId(CLIPS.FACE)}>
              <path d={FACE_PATH} />
              {EAR_PATHS.map((ear) => (
                <path key={ear} d={ear} />
              ))}
            </clipPath>
          </defs>

          <path className="body__fill" d={FACE_PATH} />
          {EAR_PATHS.map((ear) => (
            <path key={ear} className="body__fill" d={ear} />
          ))}

          {FACE_REGIONS.map(regionGroup)}

          <path className="body__outline" d={FACE_PATH} />
          {EAR_PATHS.map((ear) => (
            <path key={ear} className="body__outline" d={ear} />
          ))}

          {/* Drawn features, so the head reads as a face. The tap areas above
              are rectangles, which are easier to hit than an eye's real shape
              and need not match it. */}
          <g className="body__detail">
            {FACE_MARKS.map((mark, index) =>
              mark.kind === "pupil" ? (
                <circle
                  key={index}
                  cx={mark.cx}
                  cy={mark.cy}
                  r={mark.r}
                  className="body__pupil"
                />
              ) : (
                <path
                  key={index}
                  d={mark.d}
                  className={mark.kind === "eye" ? "body__eye" : undefined}
                />
              ),
            )}
          </g>
        </svg>
      </div>

      <div className="body__figure-wrap body__figure-wrap--body">
        <p className="body__caption">Body</p>
        <svg
          className="body__figure"
          viewBox={`0 0 ${VIEW_BOX.width} ${VIEW_BOX.height}`}
          role="group"
          aria-label="Point to where it hurts"
          data-testid="body-map"
        >
          <defs>
            {/* Two clips rather than one. The trunk and the arms are separate
                outlines, so a chest band clipped to the trunk cannot bleed out
                along the arms hanging beside it, which is exactly what a single
                figure wide clip used to do. */}
            <clipPath id={clipId(CLIPS.TRUNK)}>
              <path d={TRUNK_PATH} />
            </clipPath>
            <clipPath id={clipId(CLIPS.ARMS)}>
              {ARM_PATHS.map((arm) => (
                <path key={arm} d={arm} />
              ))}
            </clipPath>
          </defs>

          {/* The untouched figure. One tone across trunk and arms, so it reads
              as a body rather than as parts waiting to be coloured in. */}
          <path className="body__fill" d={TRUNK_PATH} />
          {ARM_PATHS.map((arm) => (
            <path key={arm} className="body__fill" d={arm} />
          ))}

          {REGIONS.map(regionGroup)}

          {/* Contour and interior marks last, so a selected region is tinted
              underneath them and the body keeps its edges. Neither takes taps:
              they sit over the regions and would otherwise swallow them. */}
          <path className="body__outline" d={TRUNK_PATH} />
          {ARM_PATHS.map((arm) => (
            <path key={arm} className="body__outline" d={arm} />
          ))}
          <g className="body__detail">
            {DETAIL_MARKS.map((mark) => (
              <path key={mark} d={mark} />
            ))}
          </g>
        </svg>
      </div>

      {/* Read by the clinician, and announced to a screen reader. The patient
          has the tinted region and the spoken output; this is confirmation for
          whoever is treating them that the tap landed where they think. */}
      <p className="body__chosen" aria-live="polite" data-testid="body-chosen">
        {chosen ? chosen.label : ""}
      </p>
    </div>
  );
}
