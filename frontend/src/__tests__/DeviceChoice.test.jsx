import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import DeviceChoice from "../components/DeviceChoice.jsx";

describe("the first question of a visit", () => {
  it("asks whether the patient has their own phone", () => {
    render(<DeviceChoice onChosen={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: /have their own phone/i }),
    ).toBeInTheDocument();
  });

  it("offers a yes and a no", () => {
    render(<DeviceChoice onChosen={vi.fn()} />);

    expect(screen.getByTestId("choice-yes")).toBeInTheDocument();
    expect(screen.getByTestId("choice-no")).toBeInTheDocument();
  });

  it("chooses pairing on yes", async () => {
    const onChosen = vi.fn();
    render(<DeviceChoice onChosen={onChosen} />);

    await userEvent.click(screen.getByTestId("choice-yes"));

    expect(onChosen).toHaveBeenCalledWith("paired");
  });

  it("chooses the shared device on no", async () => {
    const onChosen = vi.fn();
    render(<DeviceChoice onChosen={onChosen} />);

    await userEvent.click(screen.getByTestId("choice-no"));

    expect(onChosen).toHaveBeenCalledWith("shared");
  });

  it("is a question for the doctor, so it does not pretend to be patient facing", () => {
    // The literacy check plays a sign video and prints Twi because the patient
    // is being asked. This one is about equipment in the room.
    render(<DeviceChoice onChosen={vi.fn()} />);

    expect(document.querySelector("video")).toBeNull();
  });

  it("offers a patient who landed here a way to join instead", async () => {
    const onJoinInstead = vi.fn();
    render(<DeviceChoice onChosen={vi.fn()} onJoinInstead={onJoinInstead} />);

    await userEvent.click(screen.getByTestId("join-instead"));

    expect(onJoinInstead).toHaveBeenCalled();
  });

  it("does not offer it where nothing can be done with it", () => {
    render(<DeviceChoice onChosen={vi.fn()} />);

    expect(screen.queryByTestId("join-instead")).not.toBeInTheDocument();
  });
});
