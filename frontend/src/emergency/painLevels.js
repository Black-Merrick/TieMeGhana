/** The pain scale's five levels, SRS FR 5.1. Data only, so it can be shared. */

// Level, the clinician's wording, and how the mouth is drawn. Severity is
// carried by the mouth's shape as well as by colour, so it survives for a
// colour blind patient and in bright sunlight on a phone screen.
export const PAIN_LEVELS = [
  { level: 1, label: "No pain", mouth: "M 34 62 Q 50 74 66 62" },
  { level: 2, label: "A little pain", mouth: "M 34 64 Q 50 70 66 64" },
  { level: 3, label: "Moderate pain", mouth: "M 34 66 L 66 66" },
  { level: 4, label: "Severe pain", mouth: "M 34 70 Q 50 60 66 70" },
  { level: 5, label: "Worst pain", mouth: "M 34 74 Q 50 56 66 74" },
];
