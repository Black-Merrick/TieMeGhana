/**
 * The human outline used by the body map, SRS FR 5.2 and section 4.5.
 *
 * Section 4.5 asks for "an actual outline of a human body, so tapping the
 * stomach or the head feels like pointing, not like operating a menu". A figure
 * assembled from rounded rectangles does not do that: it reads as a toy, and a
 * patient in pain should not have to work out that a box means their chest.
 *
 * So the figure is one continuous contour. It is kept here as a table of
 * anatomical points rather than as a path string, for two reasons:
 *
 * - It can be read and tuned. Moving a shoulder in means changing one number,
 *   where in a path string of bezier control points it means changing six and
 *   guessing which.
 * - It cannot be asymmetric. Only the right half is written down and the left
 *   is its mirror, so the figure cannot drift lopsided through an edit.
 *
 * Coordinates are in a 200 by 480 viewBox, centre line x = 100, measured to
 * roughly eight head heights, which is what a standing adult reads as.
 */

/** Centre line of the figure. Mirroring is about this. */
const CENTRE = 100;

export const VIEW_BOX = { width: 200, height: 480 };

/**
 * The right half of the contour, head crown to crotch, in order.
 *
 * Read down the list and you are walking the edge of a body: over the skull,
 * down the jaw, out along the trapezius, around the shoulder, down the outside
 * of the arm, around the hand, back up the inside of the arm to the armpit,
 * down the ribs, in at the waist, out over the hip, down the leg, around the
 * foot, and up the inside of the thigh to the crotch.
 *
 * The arm keeps a few millimetres of daylight between its inner edge and the
 * waist. That is what a real arm hanging at rest does, and it also keeps the
 * contour a simple closed loop: were the arm to cross into the hip the path
 * would self intersect and render as a hole.
 */
const RIGHT_HALF = [
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

  // Trapezius out to the shoulder.
  [118, 85],
  [128, 89],

  // Deltoid, the roundest part of the figure and the one that most decides
  // whether it reads as a person.
  [139, 94],
  [147, 103],
  [150, 114],

  // Outside of the upper arm, down to the elbow.
  [151, 130],
  [150, 148],
  [148, 166],
  [148, 184],

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
  [127, 104],

  // Ribs, narrowing to the waist.
  [124, 116],
  [122, 130],
  [121, 144],
  [119, 158],
  [118, 172],
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

/** Reflect a point across the centre line. */
function mirror([x, y]) {
  return [2 * CENTRE - x, y];
}

/**
 * Close the half outline into a full symmetric loop.
 *
 * The crown and the crotch sit on the centre line and are their own mirror
 * image, so they are walked once rather than twice. Duplicating them would put
 * two identical points side by side, which flattens the curve through them and
 * leaves a visible crease at the top of the head.
 */
function mirrored(half) {
  return half.concat(half.slice(1, -1).reverse().map(mirror));
}

const round = (value) => Math.round(value * 10) / 10;

/**
 * Smooth a closed point loop into a bezier path, Catmull-Rom style.
 *
 * Each point gets its tangent from its two neighbours, so the curve passes
 * through every point given while staying continuous across all of them. That
 * is what makes the contour read as flesh rather than as a polygon, and it is
 * why the table above can be sparse: twenty points down a leg would be wasted
 * where six and a smooth interpolation do the same job.
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

    const c1x = x1 + (x2 - x0) / 6;
    const c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = y2 - (y3 - y1) / 6;

    path += ` C ${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(x2)} ${round(y2)}`;
  }

  return `${path} Z`;
}

/** The whole figure, as one closed path. Computed once at module load. */
export const SILHOUETTE = smoothClosedPath(mirrored(RIGHT_HALF));

/**
 * Faint interior marks: collarbones, sternum, and navel.
 *
 * Purely to make the figure read as a body rather than as a shadow. They are
 * not tappable and carry no meaning, which is why they are separate from the
 * regions below.
 */
export const DETAIL_MARKS = [
  "M 84 96 Q 92 101 99 99",
  "M 116 96 Q 108 101 101 99",
  "M 100 104 L 100 118",
  "M 88 130 Q 94 136 100 135",
  "M 112 130 Q 106 136 100 135",
  "M 100 176 Q 103 179 100 182",
];

/**
 * The tappable regions, in paint order.
 *
 * Every region is clipped to the contour, so a region only ever covers the part
 * of the body that is actually there. That is what lets the trunk be described
 * as simple horizontal bands: a band across the chest becomes chest shaped when
 * the clip is applied.
 *
 * Order matters, because a later region wins the tap where two overlap. The
 * arms and hands are drawn last and their inner edges are copied from the
 * contour table, so the boundary between an arm and the ribs it hangs beside is
 * exactly the gap between them, not an approximation.
 *
 * The nine ids are fixed: they are the glosses the rest of the app looks body
 * location clips up by, so renaming one here silently stops a sign resolving.
 */
const ARM_RIGHT = [
  // Down the inner edge of the arm, from the armpit to the wrist.
  [127, 104],
  [130, 110],
  [132, 120],
  [133, 132],
  [134, 148],
  [134, 168],
  [134, 188],
  [134, 206],
  [134, 224],
  [134, 240],
  [134, 246],
  // Out past the edge of the figure, and back over the top of the shoulder.
  [200, 246],
  [200, 86],
  [140, 86],
];

const HAND_RIGHT = [
  [132, 246],
  [200, 246],
  [200, 298],
  [132, 298],
];

const band = (top, bottom) => [
  [0, top],
  [VIEW_BOX.width, top],
  [VIEW_BOX.width, bottom],
  [0, bottom],
];

const polygon = (points) => points.map(([x, y]) => `${x},${y}`).join(" ");

export const REGIONS = [
  { id: "HEAD", label: "Head", shapes: [band(0, 74)] },
  { id: "THROAT", label: "Throat", shapes: [band(74, 92)] },
  { id: "CHEST", label: "Chest", shapes: [band(92, 156)] },
  { id: "STOMACH", label: "Stomach", shapes: [band(156, 194)] },
  { id: "WAIST", label: "Waist", shapes: [band(194, 250)] },
  { id: "LEG", label: "Leg", shapes: [band(250, 452)] },
  { id: "FOOT", label: "Foot", shapes: [band(452, VIEW_BOX.height)] },
  { id: "ARM", label: "Arm", shapes: [ARM_RIGHT, ARM_RIGHT.map(mirror)] },
  { id: "HAND", label: "Hand", shapes: [HAND_RIGHT, HAND_RIGHT.map(mirror)] },
].map((region) => ({
  ...region,
  outlines: region.shapes.map(polygon),
}));
