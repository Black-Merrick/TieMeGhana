import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EmergencyTriage from "../components/EmergencyTriage.jsx";
import { fetchCriticalAlerts } from "../api/clips.js";
import { speakResponse } from "../api/speech.js";
import { readTranscript } from "../transcript/transcript.js";

vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchCriticalAlerts: vi.fn() };
});
vi.mock("../api/speech.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, speakResponse: vi.fn() };
});

/**
 * Emergency Visual Triage Mode, SRS FR 5.1 to FR 5.5.
 *
 * The mode that has to work when nothing else does: no interpreter, no time,
 * no literacy answer, and possibly no filmed footage. These tests hold that
 * line, because it is the one part of the app whose failure mode is a patient
 * who cannot say they cannot breathe.
 */

function alert(id, english, icon, isPlayable = false) {
  return {
    id,
    english_text: english,
    icon,
    is_playable: isPlayable,
    clip: isPlayable
      ? {
          gloss: id,
          video_url: `/media/clips/${id.toLowerCase()}.webm`,
          duration_ms: 900,
        }
      : null,
  };
}

const ALERTS = [
  alert("CANNOT_BREATHE", "Cannot breathe", "breathing"),
  alert("PREGNANCY", "Pregnant", "pregnancy"),
];

function speech(text) {
  return {
    text,
    source_language: "en",
    output_language: "tw",
    translated_text: text,
    audio_url: null,
    audio_base64: "",
    language_provider: "stub",
  };
}

beforeEach(() => {
  localStorage.clear();
  fetchCriticalAlerts.mockResolvedValue(ALERTS);
  speakResponse.mockImplementation(async ({ text }) => speech(text));
  vi.stubGlobal("navigator", { ...navigator, vibrate: vi.fn() });
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/**
 * Wait for the alerts request to settle.
 *
 * A test that renders and asserts immediately leaves the fetch in flight, and
 * React warns about the state update landing outside act. The warning is
 * noise, but noise is what hides the next real one.
 */
async function settle() {
  await waitFor(() =>
    expect(screen.queryByTestId("alerts-loading")).not.toBeInTheDocument(),
  );
}

function renderTriage(props = {}) {
  return render(
    <EmergencyTriage outputLanguage="tw" onLeave={() => {}} {...props} />,
  );
}

describe("critical alerts, FR 5.3", () => {
  it("offers the alerts the backend returns", async () => {
    renderTriage();

    await waitFor(() => {
      expect(screen.getByTestId("alert-CANNOT_BREATHE")).toBeInTheDocument();
    });
    expect(screen.getByTestId("alert-PREGNANCY")).toBeInTheDocument();
  });

  it("speaks the alert aloud when it is tapped", async () => {
    // FR 5.5. The doctor's eyes are on the patient, not the screen, so an
    // alert that only appears on screen is an alert nobody receives.
    renderTriage();

    await waitFor(() => screen.getByTestId("alert-CANNOT_BREATHE"));
    await userEvent.click(screen.getByTestId("alert-CANNOT_BREATHE"));

    await waitFor(() => {
      expect(speakResponse).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Cannot breathe", outputLanguage: "tw" }),
      );
    });
  });

  it("uses the emergency vibration pattern, not the ordinary tap", async () => {
    // SRS section 6 gives the highest stakes action in the app its own
    // pattern, so the patient can feel that this was not an ordinary tap.
    renderTriage();

    await waitFor(() => screen.getByTestId("alert-PREGNANCY"));
    await userEvent.click(screen.getByTestId("alert-PREGNANCY"));

    expect(navigator.vibrate).toHaveBeenCalledWith([60, 45, 60, 45, 60]);
  });

  it("still offers an alert whose sign clip has not been filmed", async () => {
    // The opposite of ADR 022, which withholds an unfilmed body location.
    // Deliberate, per ADR 040: an icon a patient half recognises beats having
    // no way at all to say they cannot breathe.
    renderTriage();

    await waitFor(() => screen.getByTestId("alert-CANNOT_BREATHE"));
    expect(screen.getByTestId("alert-CANNOT_BREATHE")).toBeEnabled();
    await userEvent.click(screen.getByTestId("alert-CANNOT_BREATHE"));

    await waitFor(() => expect(speakResponse).toHaveBeenCalled());
  });

  it("makes the card itself the video once the sign is filmed", async () => {
    // FR 5.3. The patient is meant to read the sign, and a sign the size of a
    // postage stamp beside an icon cannot be read, so the clip fills the card
    // and the drawn icon steps aside.
    fetchCriticalAlerts.mockResolvedValue([
      alert("CANNOT_BREATHE", "Cannot breathe", "breathing", true),
    ]);

    renderTriage();

    await waitFor(() => {
      expect(screen.getByTestId("alert-CANNOT_BREATHE")).toBeInTheDocument();
    });

    const card = screen.getByTestId("alert-CANNOT_BREATHE");
    expect(card.querySelector("video")).not.toBeNull();
    expect(card.querySelector(".alerts__icon")).toBeNull();
  });

  it("falls back to the drawn icon while the sign is unfilmed", async () => {
    // The icon is the fallback, not a decoration. On an unfilmed alert it is
    // the only thing the patient has to read, which is what makes offering it
    // at all defensible under ADR 040.
    renderTriage();

    await waitFor(() => screen.getByTestId("alert-CANNOT_BREATHE"));

    const card = screen.getByTestId("alert-CANNOT_BREATHE");
    expect(card.querySelector(".alerts__icon svg")).not.toBeNull();
    expect(card.querySelector("video")).toBeNull();
  });

  it("keeps the pain scale and body map working when alerts cannot load", async () => {
    // Triage degrades rather than failing. Both of those are drawings and need
    // nothing from the server, so an API outage must not take them down too.
    fetchCriticalAlerts.mockRejectedValue(new Error("network down"));

    renderTriage();

    await waitFor(() => {
      expect(screen.getByTestId("alerts-unavailable")).toBeInTheDocument();
    });
    expect(screen.getByTestId("body-map")).toBeInTheDocument();
    expect(screen.getByTestId("pain-scale")).toBeInTheDocument();
  });
});

describe("body map, FR 5.2", () => {
  it("speaks where the pain is when a region is tapped", async () => {
    renderTriage();

    await userEvent.click(screen.getByTestId("body-part-STOMACH"));

    await waitFor(() => {
      expect(speakResponse).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Pain in the stomach" }),
      );
    });
  });

  it("is operable with a keyboard", async () => {
    // The regions are SVG groups, which are neither focusable nor clickable
    // natively. Without the explicit role and key handling the map would be
    // unusable with a keyboard or a screen reader.
    renderTriage();

    const head = screen.getByTestId("body-part-HEAD");
    head.focus();
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(speakResponse).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Pain in the head" }),
      );
    });
  });

  it("marks the chosen region so the patient can see it registered", async () => {
    renderTriage();

    await userEvent.click(screen.getByTestId("body-part-CHEST"));

    expect(screen.getByTestId("body-part-CHEST")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("pain scale, FR 5.1", () => {
  it("offers five levels", async () => {
    renderTriage();
    // Settle the alerts fetch first. Without it React warns about a state
    // update outside act, and a warning nobody reads hides the next real one.
    await waitFor(() => screen.getByTestId("alert-PREGNANCY"));

    for (const level of [1, 2, 3, 4, 5]) {
      expect(screen.getByTestId(`pain-level-${level}`)).toBeInTheDocument();
    }
  });

  it("speaks the severity in words rather than a number", async () => {
    // A number out of context tells the clinician nothing they can act on,
    // and "4" spoken aloud is ambiguous without knowing the scale.
    renderTriage();

    await userEvent.click(screen.getByTestId("pain-level-5"));

    await waitFor(() => {
      expect(speakResponse).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Worst pain" }),
      );
    });
  });

  it("distinguishes severity by mouth shape, not colour alone", async () => {
    // Accessibility, and also sunlight on a phone screen. If colour were the
    // only signal, a colour blind patient could not tell level 2 from level 4.
    renderTriage();
    await waitFor(() => screen.getByTestId("alert-PREGNANCY"));

    const mouths = [...document.querySelectorAll(".pain__mouth")].map((path) =>
      path.getAttribute("d"),
    );

    expect(new Set(mouths).size).toBe(mouths.length);
  });
});

describe("the transcript, FR 4.1", () => {
  it("records every selection so it appears in the consultation record", async () => {
    renderTriage();

    await userEvent.click(screen.getByTestId("pain-level-4"));
    await userEvent.click(screen.getByTestId("body-part-HEAD"));

    await waitFor(() => {
      const texts = readTranscript().map((entry) => entry.text);
      expect(texts).toContain("Severe pain");
      expect(texts).toContain("Pain in the head");
    });
  });
});

describe("no text input anywhere, FR 5.4", () => {
  it("renders no field a responder could be expected to type into", async () => {
    renderTriage();

    await waitFor(() => screen.getByTestId("alert-CANNOT_BREATHE"));

    // FR 5.4 is a hard requirement, not a preference: a first responder who
    // has never seen this app must not be able to get stuck looking for what
    // to type. Asserted structurally so the requirement cannot be undone by a
    // later change that "just adds a note field".
    expect(document.querySelectorAll("input")).toHaveLength(0);
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
    expect(
      document.querySelectorAll("[contenteditable='true']"),
    ).toHaveLength(0);
  });
});

describe("a malformed response", () => {
  it("does not take the drawings down with it", async () => {
    // Found by a test that left fetchCriticalAlerts unmocked, so the health
    // check's payload reached the component. An object where a list was
    // expected threw inside render, which white-screened triage entirely.
    // The pain scale and body map need nothing from the server, so nothing
    // the server returns may remove them.
    fetchCriticalAlerts.mockResolvedValue({ status: "ok" });

    renderTriage();

    await waitFor(() => {
      expect(screen.getByTestId("alerts-unavailable")).toBeInTheDocument();
    });
    expect(screen.getByTestId("body-map")).toBeInTheDocument();
    expect(screen.getByTestId("pain-scale")).toBeInTheDocument();
  });
});

describe("the body outline", () => {
  it("keeps the nine region ids the rest of the app looks clips up by", async () => {
    // These ids are glosses. Renaming one to suit the drawing would silently
    // stop a body location sign resolving, with no error anywhere.
    renderTriage();
    await settle();

    for (const id of [
      "HEAD",
      "THROAT",
      "CHEST",
      "STOMACH",
      "WAIST",
      "ARM",
      "HAND",
      "LEG",
      "FOOT",
    ]) {
      expect(screen.getByTestId(`body-part-${id}`)).toBeInTheDocument();
    }
  });

  it("is symmetric about the centre line", async () => {
    // Only the right half of the figure is written down and the left is its
    // mirror, so the drawing cannot drift lopsided through an edit. Asserted
    // on the arms, which are the only regions with a shape on each side.
    renderTriage();
    await settle();

    const [right, left] = [
      ...screen.getByTestId("body-part-ARM").querySelectorAll("polygon"),
    ].map((shape) =>
      shape
        .getAttribute("points")
        .split(" ")
        .map((pair) => Number(pair.split(",")[0])),
    );

    expect(left).toEqual(right.map((x) => 200 - x));
  });

  it("gives every region a hit area rather than only a visible one", async () => {
    // fill:none would leave a region with no hit area at all, which looks
    // interactive and ignores every tap. The regions are clipped to the body,
    // so this is not something a glance at the screen would catch.
    renderTriage();
    await settle();

    const shapes = [
      ...screen.getByTestId("body-map").querySelectorAll(".body__part polygon"),
    ];

    expect(shapes.length).toBeGreaterThan(0);
    expect(shapes.every((shape) => shape.getAttribute("fill") !== "none")).toBe(
      true,
    );
  });

  it("does not let the contour swallow taps meant for the body", async () => {
    // The outline and the interior marks are painted over the regions so a
    // selection is tinted underneath them. Drawn on top, they would otherwise
    // take every tap that landed on a line.
    renderTriage();
    await settle();

    const map = screen.getByTestId("body-map");

    expect(map.querySelector(".body__outline")).not.toBeNull();
    expect(map.querySelector(".body__part polygon")).not.toBeNull();
  });

  it("names the chosen part for whoever is treating the patient", async () => {
    renderTriage();
    await settle();

    expect(screen.getByTestId("body-chosen")).toHaveTextContent("");
    await userEvent.click(screen.getByTestId("body-part-STOMACH"));

    expect(screen.getByTestId("body-chosen")).toHaveTextContent("Stomach");
  });
});
