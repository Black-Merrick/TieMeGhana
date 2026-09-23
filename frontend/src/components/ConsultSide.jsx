/**
 * Whose half of the screen this is, on the one device both people are using.
 *
 * SRS section 4.1 asks for the state of the consultation to be permanently
 * visible rather than inferred. On a shared device the most basic piece of that
 * state is physical: this phone or tablet is turned between two people, and
 * each of them needs to know at a glance which half is theirs without reading a
 * card header or being told. The role chips inside the cards said it, but they
 * are small, they scroll away, and one of the two people may not read English.
 *
 * So the division is stated on the surface itself: a heading over each column
 * and a rule down the middle. Two signals rather than one, since colour alone
 * fails in bright sunlight on a hospital ward and for a colour blind clinician.
 *
 * Only for the shared device. In a paired visit the patient's half is on their
 * own phone, so there is no line to draw on this screen and nothing here is
 * rendered. See ADR 061.
 */

const SIDES = {
  doctor: {
    label: "Doctor",
    hint: "Type or speak here. The patient does not read this side.",
  },
  patient: {
    label: "Patient",
    hint: "Turn the screen this way. The sign video and the answers are here.",
  },
};

export default function ConsultSide({ side }) {
  const { label, hint } = SIDES[side];

  return (
    <div className={`side side--${side}`} data-testid={`side-${side}`}>
      <p className="side__label">
        {/* Shape as well as colour: a filled square for the doctor, an open one
            for the patient, so the two are told apart without relying on the
            green and the amber being distinguishable. */}
        <span className="side__mark" aria-hidden="true" />
        {label}
      </p>
      <p className="side__hint">{hint}</p>
    </div>
  );
}
