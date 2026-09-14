/**
 * The vocabulary a prescription is written in, FR 6.1 and ADR 049.
 *
 * Mirrors `backend/prescriptions/dosing.py`. The server is the authority: it
 * validates every choice and generates the wording, so a form that drifted
 * from this would be caught rather than silently accepted. What is here is the
 * labels a doctor picks from.
 *
 * The reason it is choices rather than two text boxes: a prescription is a
 * dose, a time, a relation to food and sometimes a length of course. Typed
 * free text could be any wording at all, most of which has no chance of
 * resolving to signs, and the doctor found out only after issuing it.
 */

export const AMOUNTS = [
  { value: "HALF", label: "½" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
  { value: "6", label: "6" },
  { value: "8", label: "8" },
  { value: "10", label: "10" },
];

export const UNITS = [
  { value: "TABLET", label: "Tablet" },
  { value: "CAPSULE", label: "Capsule" },
  { value: "SPOON", label: "Spoon" },
  { value: "DROP", label: "Drop" },
  { value: "ML", label: "Millilitre" },
  { value: "INJECTION", label: "Injection" },
  { value: "SACHET", label: "Sachet" },
];

export const TIMES_OF_DAY = [
  { value: "MORNING", label: "Morning" },
  { value: "AFTERNOON", label: "Afternoon" },
  { value: "EVENING", label: "Evening" },
  { value: "NIGHT", label: "Night" },
];

export const FREQUENCIES = [
  { value: "ONCE", label: "Once a day" },
  { value: "TWICE", label: "Twice a day" },
  { value: "THREE_TIMES", label: "Three times a day" },
  { value: "FOUR_TIMES", label: "Four times a day" },
];

export const MEALS = [
  { value: "", label: "Any time" },
  { value: "BEFORE", label: "Before food" },
  { value: "AFTER", label: "After food" },
  { value: "WITH", label: "With food" },
];

const AMOUNT_WORDS = {
  HALF: "half",
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
};

const UNIT_WORDS = {
  TABLET: ["tablet", "tablets"],
  CAPSULE: ["capsule", "capsules"],
  SPOON: ["spoon", "spoons"],
  DROP: ["drop", "drops"],
  ML: ["millilitre", "millilitres"],
  INJECTION: ["injection", "injections"],
  SACHET: ["sachet", "sachets"],
};

/**
 * The sentence the patient will get, shown while the doctor is still choosing.
 *
 * A preview, not the source of truth: the server generates the wording that is
 * actually stored and signed. It exists because a form of separate controls
 * does not read as an instruction, and the doctor should see the sentence they
 * are prescribing before they issue it rather than after.
 */
export function previewInstruction(item) {
  if (!item.amount || !item.unit) return "";

  const [singular, plural] = UNIT_WORDS[item.unit];
  const countsAsPlural = item.amount !== "HALF" && item.amount !== "1";
  const dose = `${AMOUNT_WORDS[item.amount]} ${countsAsPlural ? plural : singular}`;

  const parts = [];

  if (item.times.length > 0) {
    // In the order of the day rather than the order they were ticked.
    const ordered = TIMES_OF_DAY.filter((time) =>
      item.times.includes(time.value),
    ).map((time) => time.label.toLowerCase());
    parts.push(
      ordered.length > 1
        ? `${ordered.slice(0, -1).join(", ")} and ${ordered[ordered.length - 1]}`
        : ordered[0],
    );
  } else if (item.frequencyChoice) {
    parts.push(
      FREQUENCIES.find((one) => one.value === item.frequencyChoice).label.toLowerCase(),
    );
  }

  if (item.meal) {
    parts.push(MEALS.find((one) => one.value === item.meal).label.toLowerCase());
  }

  if (item.days) {
    parts.push(`for ${AMOUNT_WORDS[String(item.days)] ?? item.days} days`);
  }

  return [dose, ...parts].join(", ");
}
