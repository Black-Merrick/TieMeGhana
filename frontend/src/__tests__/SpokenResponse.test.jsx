import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import SpokenResponse from "../components/SpokenResponse.jsx";

/**
 * SRS section 4.2. A Deaf patient cannot hear whether their answer reached the
 * doctor, so the confirmation has to be visible as well as felt.
 */

const spoken = {
  spoken_text: "My head hurts",
  language_provider: "khaya",
};

describe("SpokenResponse", () => {
  it("shows nothing before anything has been said", () => {
    render(<SpokenResponse status="idle" result={null} />);

    expect(screen.queryByTestId("spoken-response")).not.toBeInTheDocument();
  });

  it("shows an animated waveform while the answer is being spoken", () => {
    render(<SpokenResponse status="playing" result={spoken} />);

    expect(screen.getByTestId("spoken-playing")).toBeInTheDocument();
  });

  it("resolves into a completed state when speech finishes", () => {
    // Section 4.2 asks for exactly this transition, so the patient knows the
    // answer finished rather than being cut off.
    render(<SpokenResponse status="spoken" result={spoken} />);

    expect(screen.getByTestId("spoken-done")).toBeInTheDocument();
    expect(screen.queryByTestId("spoken-playing")).not.toBeInTheDocument();
  });

  it("shows what was actually spoken", () => {
    // So the doctor can check it even if they were not listening, and the
    // patient can see it was their answer that went out.
    render(<SpokenResponse status="spoken" result={spoken} />);

    expect(screen.getByTestId("spoken-text")).toHaveTextContent("My head hurts");
  });

  it("tells the patient to show the screen when speech failed", () => {
    render(<SpokenResponse status="failed" result={null} />);

    expect(screen.getByTestId("spoken-error")).toBeInTheDocument();
  });

  it("warns that stub audio was silence, not speech", () => {
    // ADR 011, and the worst possible overclaim to leave unmarked: everyone
    // would assume the doctor heard the answer.
    render(
      <SpokenResponse
        status="spoken"
        result={{ ...spoken, language_provider: "stub" }}
      />,
    );

    expect(screen.getByTestId("spoken-stub-warning")).toHaveTextContent(
      /silence, not speech/i,
    );
  });

  it("shows no warning when real speech was produced", () => {
    render(<SpokenResponse status="spoken" result={spoken} />);

    expect(screen.queryByTestId("spoken-stub-warning")).not.toBeInTheDocument();
  });
});

describe("when the browser is holding the sound back", () => {
  it("says so, and is not the failure message", () => {
    render(<SpokenResponse status="blocked" result={null} />);

    expect(screen.getByTestId("spoken-blocked")).toBeInTheDocument();
    expect(screen.queryByTestId("spoken-error")).not.toBeInTheDocument();
  });

  it("offers a button to play it when there is a way to", async () => {
    const onPlay = vi.fn();
    render(<SpokenResponse status="blocked" result={null} onPlay={onPlay} />);

    await userEvent.click(screen.getByTestId("spoken-play"));

    expect(onPlay).toHaveBeenCalled();
  });

  it("offers no button where there is nothing to call", () => {
    render(<SpokenResponse status="blocked" result={null} />);

    expect(screen.queryByTestId("spoken-play")).not.toBeInTheDocument();
  });
});
