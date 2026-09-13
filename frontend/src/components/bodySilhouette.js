/**
 * The human figure used by the body map, SRS FR 5.2 and section 4.5.
 *
 * Section 4.5 asks for "an actual outline of a human body, so tapping the
 * stomach or the head feels like pointing, not like operating a menu". A figure
 * assembled from rounded rectangles does not do that: it reads as a toy, and a
 * patient in pain should not have to work out that a box means their chest.
 *
 * The outlines are kept here as tables of anatomical points rather than as path
 * strings, for two reasons:
 *
 * - They can be read and tuned. Moving a shoulder in means changing one number,
 *   where in a path of bezier control points it means changing six and
 *   guessing which.
 * - They cannot be asymmetric. Only the right half of the body is written down
 *   and the left is its mirror, so the figure cannot drift lopsided.
 *
 * Coordinates are in a 200 by 480 viewBox for the body and 200 by 230 for the
 * face, centre line x = 100.
 *
 * The figure is three closed outlines, not one, and that is the whole reason
 * this file was restructured: see CLIPS below.
 */

const CENTRE = 100;

export const VIEW_BOX = { width: 200, height: 480 };
export const FACE_VIEW_BOX = { width: 200, height: 230 };

/**
 * The trunk, from crown to crotch, arms excluded.
 *
 * The arms are separate outlines rather than part of this one. With a single
 * outline every region had to be clipped to the whole figure, so the fill of a
 * chest band bled out along the arms hanging beside it: tapping the chest lit
 * up the arms as well, because the arm shapes drawn over the top are
 * transparent and the band showed straight through them.
 *
 * Splitting the figure means a band can be clipped to the trunk alone and an
 * arm to the arms alone, so a region can only ever colour the part it names.
 */
const TRUNK_HALF = [
  // Skull and face.
  [100, 10],
  [111, 11],
  [119, 19],
  [122, 31],
  [122, 43],
  [118, 55],
  [112, 63],
  [109, 69],

  // Neck.
  [109, 76],
  [111, 82],

  // Trapezius, and then in to the armpit. The shoulder cap itself belongs to
  // the arm outline, not to this one, and that is a highlighting decision as
  // much as an anatomical one: a trunk that reached out to the full width of
  // the shoulder meant the chest band painted the shoulders too, so tapping
  // the chest lit up an area the patient had not pointed at. The arm outline
  // overlaps this edge, so the union still reads as one shoulder.
  [117, 84],
  [124, 90],
  [128, 100],
  [130, 110],
  [131, 120],

  // Ribs, narrowing to the waist.
  [129, 130],
  [126, 142],
  [122, 158],
  [119, 172],
  [118, 184],

  // Hip.
  [121, 198],
  [126, 212],
  [129, 226],

  // Outside of the thigh, down past the knee.
  [130, 240],
  [129, 262],
  [127, 286],
  [125, 310],
  [123, 332],
  [121, 350],

  // Calf and ankle.
  [120, 368],
  [119, 388],
  [117, 408],
  [114, 430],
  [113, 446],

  // Foot.
  [115, 458],
  [120, 466],
  [121, 472],
  [116, 476],
  [107, 476],
  [103, 473],
  [102, 460],
  [102, 446],

  // Up the inside of the leg.
  [103, 424],
  [104, 400],
  [104, 376],
  [104, 352],
  [103, 326],
  [102, 300],
  [101, 276],

  // Crotch, on the centre line, where the mirror takes over.
  [100, 262],
];

/**
 * One arm, shoulder cap to fingertips and back up to the armpit.
 *
 * A closed loop of its own, mirrored for the other side. Its top overlaps the
 * trunk's shoulder so there is no gap, and its inner edge keeps a few
 * millimetres of daylight from the waist, which is what an arm hanging at rest
 * actually does.
 */
const ARM_RIGHT_OUTLINE = [
  // Shoulder cap, tucked under the trapezius.
  [126, 88],
  [139, 93],
  [148, 101],
  [152, 113],

  // Outside of the upper arm, down to the elbow.
  [153, 130],
  [152, 148],
  [150, 166],
  [149, 184],

  // Outside of the forearm, down to the wrist.
  [148, 202],
  [148, 220],
  [148, 236],
  [147, 246],

  // Hand, hanging closed at the hip.
  [150, 254],
  [151, 266],
  [149, 278],
  [144, 284],
  [138, 282],
  [135, 272],
  [135, 260],
  [135, 250],

  // Back up the inside of the arm to the armpit.
  [134, 240],
  [134, 224],
  [134, 206],
  [134, 188],
  [134, 168],
  [134, 148],
  [133, 132],
  [132, 120],
  [130, 110],
  [128, 98],
];

/**
 * The face, enlarged, FR 5.2.
 *
 * An eye on the full figure is about fifteen pixels across on a phone, which
 * is far below anything a person in distress can hit. Eyes, ears, nose and
 * mouth therefore get their own enlarged head rather than being crammed onto
 * the body, which is what printed anatomical charts do for the same reason.
 */
const FACE_HALF = [
  [100, 12],
  [122, 14],
  [138, 26],
  [147, 48],
  [150, 74],
  [151, 100],
  [148, 128],
  [140, 158],
  [128, 184],
  [114, 202],
  [104, 210],
  [100, 212],
];

/** Reflect a point across the centre line. */
function mirror([x, y]) {
  return [2 * CENTRE - x, y];
}

/**
 * Close a half outline into a full symmetric loop.
 *
 * The points on the centre line are their own mirror image, so they are walked
 * once rather than twice. Duplicating them would put two identical points side
 * by side, which flattens the curve through them and leaves a visible crease.
 */
function mirrored(half) {
  return half.concat(half.slice(1, -1).reverse().map(mirror));
}

const round = (value) => Math.round(value * 10) / 10;

/**
 * Smooth a closed point loop into a bezier path, Catmull-Rom style.
 *
 * Each point takes its tangent from its two neighbours, so the curve passes
 * through every point given while staying continuous across all of them. That
 * is what makes the outline read as flesh rather than as a polygon, and it is
 * why the tables above can be sparse.
 */
function smoothClosedPath(points) {
  const count = points.length;
  const at = (index) => points[(index + count) % count];

  let path = `M ${round(points[0][0])} ${round(points[0][1])}`;

  for (let i = 0; i < count; i += 1) {
    const [x0, y0] = at(i - 1);
    const [x1, y1] = at(i);
    const [x2, y2] = at(i + 1);
    const [x3, y3] = at(i + 2);

    path += ` C ${round(x1 + (x2 - x0) / 6)} ${round(y1 + (y2 - y0) / 6)}`;
    path += ` ${round(x2 - (x3 - x1) / 6)} ${round(y2 - (y3 - y1) / 6)}`;
    path += ` ${round(x2)} ${round(y2)}`;
  }

  return `${path} Z`;
}

export const TRUNK_PATH = smoothClosedPath(mirrored(TRUNK_HALF));
export const ARM_PATHS = [
  smoothClosedPath(ARM_RIGHT_OUTLINE),
  smoothClosedPath(ARM_RIGHT_OUTLINE.map(mirror)),
];
export const FACE_PATH = smoothClosedPath(mirrored(FACE_HALF));

/** Ears, outside the face outline, so they are drawn and clipped with it. */
export const EAR_PATHS = [
  "M 151 92 C 166 86 172 100 168 116 C 165 130 156 136 149 132 Z",
  "M 49 92 C 34 86 28 100 32 116 C 35 130 44 136 51 132 Z",
];

/**
 * Faint interior marks: collarbones, sternum and navel.
 *
 * To make the figure read as a body rather than a shadow. Not tappable and
 * carrying no meaning, which is why they are separate from the regions.
 */
export const DETAIL_MARKS = [
  "M 84 96 Q 92 101 99 99",
  "M 116 96 Q 108 101 101 99",
  "M 100 104 L 100 118",
  "M 88 130 Q 94 136 100 135",
  "M 112 130 Q 106 136 100 135",
  "M 100 176 Q 103 179 100 182",
];

/** Which outline a region is allowed to colour. See TRUNK_HALF's comment. */
export const CLIPS = { TRUNK: "trunk", ARMS: "arms", FACE: "face" };

const band = (top, bottom) => [
  [0, top],
  [VIEW_BOX.width, top],
  [VIEW_BOX.width, bottom],
  [0, bottom],
];

const polygon = (points) => points.map(([x, y]) => `${x},${y}`).join(" ");

const ARM_REGION = [
  [120, 84],
  [200, 84],
  [200, 248],
  [134, 248],
  [134, 188],
  [133, 132],
  [130, 110],
];

const HAND_REGION = [
  [132, 248],
  [200, 248],
  [200, 300],
  [132, 300],
];

/**
 * The tappable regions of the body, in paint order.
 *
 * Trunk bands are simple horizontal strips: clipped to the trunk they come out
 * chest shaped, stomach shaped and so on. Arms and hands are clipped to the
 * arms, so neither can colour the other.
 *
 * Regions are not sided, and that is deliberate. A front facing figure puts the
 * patient's left on the viewer's right, and an app that announced "left arm"
 * from a mirrored drawing would be wrong half the time in a setting where being
 * wrong is measured in treatment. "Arm" is what the app says; which arm is
 * something the clinician standing there can see.
 */
const BODY = [
  { id: "HEAD", label: "Head", clip: CLIPS.TRUNK, shapes: [band(0, 74)] },
  { id: "THROAT", label: "Throat", clip: CLIPS.TRUNK, shapes: [band(74, 92)] },
  { id: "CHEST", label: "Chest", clip: CLIPS.TRUNK, shapes: [band(92, 156)] },
  { id: "STOMACH", label: "Stomach", clip: CLIPS.TRUNK, shapes: [band(156, 194)] },
  { id: "WAIST", label: "Waist", clip: CLIPS.TRUNK, shapes: [band(194, 250)] },
  { id: "LEG", label: "Leg", clip: CLIPS.TRUNK, shapes: [band(250, 452)] },
  {
    id: "FOOT",
    label: "Foot",
    clip: CLIPS.TRUNK,
    shapes: [band(452, VIEW_BOX.height)],
  },
  {
    id: "ARM",
    label: "Arm",
    clip: CLIPS.ARMS,
    shapes: [ARM_REGION, ARM_REGION.map(mirror)],
  },
  {
    id: "HAND",
    label: "Hand",
    clip: CLIPS.ARMS,
    shapes: [HAND_REGION, HAND_REGION.map(mirror)],
  },
];

/**
 * The tappable regions of the face, in paint order.
 *
 * The whole head first, then the features over it, so a tap on an eye is an
 * eye rather than the head it sits in.
 */
const FACE = [
  {
    // Not HEAD. The body figure already has a head band, and two controls with
    // the same name pointing at different drawings is how a clinician ends up
    // unsure which one the patient tapped.
    id: "FACE",
    label: "Face",
    clip: CLIPS.FACE,
    shapes: [band(0, FACE_VIEW_BOX.height)],
  },
  {
    id: "EAR",
    label: "Ear",
    clip: CLIPS.FACE,
    shapes: [
      [
        [146, 84],
        [200, 84],
        [200, 140],
        [146, 140],
      ],
      [
        [54, 84],
        [0, 84],
        [0, 140],
        [54, 140],
      ],
    ],
  },
  {
    id: "EYE",
    label: "Eye",
    clip: CLIPS.FACE,
    shapes: [
      [
        [56, 80],
        [90, 80],
        [90, 110],
        [56, 110],
      ],
      [
        [144, 80],
        [110, 80],
        [110, 110],
        [144, 110],
      ],
    ],
  },
  {
    id: "NOSE",
    label: "Nose",
    clip: CLIPS.FACE,
    shapes: [
      [
        [86, 112],
        [114, 112],
        [114, 152],
        [86, 152],
      ],
    ],
  },
  {
    id: "MOUTH",
    label: "Mouth",
    clip: CLIPS.FACE,
    shapes: [
      [
        [70, 158],
        [130, 158],
        [130, 190],
        [70, 190],
      ],
    ],
  },
];

const withOutlines = (regions) =>
  regions.map((region) => ({
    ...region,
    outlines: region.shapes.map(polygon),
  }));

export const REGIONS = withOutlines(BODY);
export const FACE_REGIONS = withOutlines(FACE);

/**
 * Features drawn on the face so it reads as a face.
 *
 * Purely visual: the tap areas above are rectangles, which are easier to hit
 * than an eye's actual shape and do not have to match it.
 */
export const FACE_MARKS = [
  { kind: "eye", d: "M 58 96 Q 73 84 88 96 Q 73 108 58 96 Z" },
  { kind: "eye", d: "M 112 96 Q 127 84 142 96 Q 127 108 112 96 Z" },
  { kind: "pupil", cx: 73, cy: 96, r: 4.5 },
  { kind: "pupil", cx: 127, cy: 96, r: 4.5 },
  { kind: "brow", d: "M 57 80 Q 73 72 89 79" },
  { kind: "brow", d: "M 143 80 Q 127 72 111 79" },
  { kind: "nose", d: "M 100 106 L 100 138 Q 92 145 88 140 M 100 138 Q 108 145 112 140" },
  { kind: "mouth", d: "M 80 170 Q 100 182 120 170" },
];
