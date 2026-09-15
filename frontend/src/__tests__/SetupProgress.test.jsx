/**
 * The first open, when the device is being stocked with sign videos.
 *
 * The downloading already happened. What was missing was any sign of it: a
 * clinician opening the app for the first time on a hospital connection saw a
 * finished looking screen, tapped a question, and waited, with nothing to say
 * the app was still fetching the very videos that wait was about. Work
 * happening invisibly is indistinguishable from an app that is simply slow.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SetupProgress from "../components/SetupProgress.jsx";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("while the videos are downloading", () => {
  it("says what is happening and how far along it is", () => {
    render(<SetupProgress progress={{ total: 8, completed: 3, done: false }} />);

    const setup = screen.getByTestId("setup-progress");
    expect(setup).toHaveAttribute("data-state", "working");
    expect(setup).toHaveTextContent(/setting up this device/i);
    expect(setup).toHaveTextContent("3 of 8");
  });

  it("says why it is worth waiting for rather than just Loading", () => {
    // A spinner says the app is busy. This has to say what the user gets at
    // the end of it, or there is no reason to leave the device alone.
    render(<SetupProgress progress={{ total: 8, completed: 1, done: false }} />);

    expect(screen.getByTestId("setup-progress")).toHaveTextContent(
      /play instantly/i,
    );
  });

  it("says the app can be used straight away", () => {
    // Otherwise somebody waits for the bar before starting work, which is
    // exactly the delay this was meant to remove.
    render(<SetupProgress progress={{ total: 8, completed: 1, done: false }} />);

    expect(screen.getByTestId("setup-progress")).toHaveTextContent(
      /start using the app now/i,
    );
  });

  it("exposes the progress to assistive technology", () => {
    render(<SetupProgress progress={{ total: 8, completed: 2, done: false }} />);

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "8");
  });

  it("announces politely, never interrupting something clinical", () => {
    render(<SetupProgress progress={{ total: 4, completed: 1, done: false }} />);

    const setup = screen.getByTestId("setup-progress");
    expect(setup).toHaveAttribute("role", "status");
    expect(setup).toHaveAttribute("aria-live", "polite");
  });
});

describe("when it finishes", () => {
  it("confirms the device is ready to use offline", () => {
    render(<SetupProgress progress={{ total: 8, completed: 8, done: true }} />);

    const setup = screen.getByTestId("setup-progress");
    expect(setup).toHaveAttribute("data-state", "done");
    expect(setup).toHaveTextContent(/ready to use offline/i);
  });

  it("counts one video correctly rather than saying 1 videos", () => {
    render(<SetupProgress progress={{ total: 1, completed: 1, done: true }} />);

    expect(screen.getByTestId("setup-progress")).toHaveTextContent(
      /1 sign video is saved/i,
    );
  });

  it("takes itself off the screen shortly afterwards", async () => {
    render(<SetupProgress progress={{ total: 8, completed: 8, done: true }} />);
    expect(screen.getByTestId("setup-progress")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    await waitFor(() =>
      expect(screen.queryByTestId("setup-progress")).not.toBeInTheDocument(),
    );
  });
});

describe("when there is nothing to announce", () => {
  it("shows nothing before the warm up has reported anything", () => {
    render(<SetupProgress progress={null} />);

    expect(screen.queryByTestId("setup-progress")).not.toBeInTheDocument();
  });

  it("shows nothing on a return visit, when every clip is already cached", () => {
    // The warm up reports a total of zero once it finds nothing missing.
    // Telling somebody their app is ready every time they open it is noise,
    // and noise is what teaches people to ignore this corner of the screen.
    render(<SetupProgress progress={{ total: 0, completed: 0, done: true }} />);

    expect(screen.queryByTestId("setup-progress")).not.toBeInTheDocument();
  });
});
