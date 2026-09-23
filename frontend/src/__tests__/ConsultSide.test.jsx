import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ConsultSide from "../components/ConsultSide.jsx";

/**
 * Whose half of the screen this is, on the one device both people are using.
 *
 * SRS section 4.1 asks for the state of the consultation to be permanently
 * visible rather than inferred, and on a shared device the most basic piece of
 * that state is physical: which half is mine. The role chips inside the cards
 * said it, but they are small and they scroll away.
 */

describe("marking the two halves", () => {
  it("names the doctor's half and says what it is for", () => {
    render(<ConsultSide side="doctor" />);

    const side = screen.getByTestId("side-doctor");
    expect(side).toHaveTextContent(/doctor/i);
    expect(side).toHaveTextContent(/type or speak here/i);
  });

  it("names the patient's half and says to turn the screen", () => {
    render(<ConsultSide side="patient" />);

    const side = screen.getByTestId("side-patient");
    expect(side).toHaveTextContent(/patient/i);
    expect(side).toHaveTextContent(/turn the screen/i);
  });

  it("tells them apart by shape as well as by colour", () => {
    // Colour alone fails in bright sunlight on a ward, and for a colour blind
    // clinician. The doctor's mark is filled and the patient's is outlined.
    const doctor = render(<ConsultSide side="doctor" />).container;
    const patient = render(<ConsultSide side="patient" />).container;

    expect(doctor.querySelector(".side--doctor .side__mark")).not.toBeNull();
    expect(patient.querySelector(".side--patient .side__mark")).not.toBeNull();
  });

  it("is decoration to a screen reader, which reads the words instead", () => {
    const { container } = render(<ConsultSide side="doctor" />);

    expect(container.querySelector(".side__mark")).toHaveAttribute("aria-hidden", "true");
  });
});
