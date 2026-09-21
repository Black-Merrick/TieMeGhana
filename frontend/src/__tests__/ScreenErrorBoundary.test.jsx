import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ScreenErrorBoundary from "../components/ScreenErrorBoundary.jsx";

let broken;
function Screen() {
  if (broken) throw new Error("the screen fell over");
  return <p data-testid="fine">All good</p>;
}

beforeEach(() => {
  broken = false;
  // React logs a caught render error; the noise hides real ones.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("a screen that fails", () => {
  it("shows a message instead of a blank page", () => {
    broken = true;
    render(
      <ScreenErrorBoundary>
        <Screen />
      </ScreenErrorBoundary>,
    );

    expect(screen.getByTestId("screen-error")).toBeInTheDocument();
    expect(screen.queryByTestId("fine")).not.toBeInTheDocument();
  });

  it("keeps what went wrong on screen, so a report of it says what it was", () => {
    broken = true;
    render(
      <ScreenErrorBoundary>
        <Screen />
      </ScreenErrorBoundary>,
    );

    expect(screen.getByTestId("screen-error-message")).toHaveTextContent(
      "Error: the screen fell over",
    );
  });

  it("says the visit is still going when it is", () => {
    broken = true;
    render(
      <ScreenErrorBoundary keepsVisit>
        <Screen />
      </ScreenErrorBoundary>,
    );

    expect(screen.getByTestId("screen-error")).toHaveTextContent(/visit is still going/i);
  });

  it("tries again on request", async () => {
    broken = true;
    render(
      <ScreenErrorBoundary>
        <Screen />
      </ScreenErrorBoundary>,
    );
    broken = false;

    await userEvent.click(screen.getByTestId("screen-error-retry"));

    expect(screen.getByTestId("fine")).toBeInTheDocument();
  });

  it("offers a way back, and takes it", async () => {
    broken = true;
    const onBack = vi.fn();
    render(
      <ScreenErrorBoundary onBack={onBack} backLabel="Leave emergency mode">
        <Screen />
      </ScreenErrorBoundary>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Leave emergency mode" }));

    expect(onBack).toHaveBeenCalled();
  });

  it("starts fresh when another screen is opened", () => {
    broken = true;
    const { rerender } = render(
      <ScreenErrorBoundary resetKey="emergency">
        <Screen />
      </ScreenErrorBoundary>,
    );
    expect(screen.getByTestId("screen-error")).toBeInTheDocument();

    broken = false;
    rerender(
      <ScreenErrorBoundary resetKey="main">
        <Screen />
      </ScreenErrorBoundary>,
    );

    expect(screen.getByTestId("fine")).toBeInTheDocument();
  });

  it("does nothing while nothing has failed", () => {
    render(
      <ScreenErrorBoundary>
        <Screen />
      </ScreenErrorBoundary>,
    );

    expect(screen.getByTestId("fine")).toBeInTheDocument();
    expect(screen.queryByTestId("screen-error")).not.toBeInTheDocument();
  });
});
