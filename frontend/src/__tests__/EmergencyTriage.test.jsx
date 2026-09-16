import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EmergencyTriage from "../components/EmergencyTriage.jsx";
import { fetchCriticalAlerts, fetchEmergencySpeech } from "../api/clips.js";
import { speakResponse } from "../api/speech.js";
import { readTranscript } from "../transcript/transcript.js";

vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchCriticalAlerts: vi.fn(),
    fetchEmergencySpeech: vi.fn(),
  };
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

/**
 * A spoken response with audio that can actually be played.
 *
 * The empty `audio_base64` this used to carry made `audioUrlFrom` throw, so
 * the hook went straight to "failed" and no triage test ever reached the
 * playing state at all. A fixture whose default is the broken case is the
 * mirror of the problem recorded in ADR 022: it quietly excuses the code from
 * the path it spends its life on.
 */
function speech(text) {
  return {
    text,
    source_language: "en",
    output_language: "tw",
    translated_text: text,
    audio_url: null,
    audio_base64: btoa("RIFFWAVE"),
    audio_media_type: "audio/wav",
    language_provider: "stub",
  };
}

/**
 * The fixed vocabulary, as the server serves it.
 *
 * Emergency mode has no free text, so every phrase it can say is translated
 * once on the server rather than at the moment of a tap. Nothing here is
 * reviewed, which is the real state: the Twi is machine output and is served
 * so it can be corrected, never so it can be spoken.
 */
const PHRASES = {
  phrases: [
    { key: "CANNOT_BREATHE", en: "I cannot breathe", tw: "Mintumi nhome", tw_reviewed: false },
    { key: "PREGNANCY", en: "I am pregnant", tw: "Menyinsɛn", tw_reviewed: false },
    { key: "HEAD", en: "I have a headache", tw: "Me ti pae me", tw_reviewed: false },
    { key: "STOMACH", en: "I have a stomachache", tw: "Me yafunu mu yɛ me ya", tw_reviewed: false },
    { key: "PAIN_4", en: "I have severe pain", tw: "Mete yea kɛse", tw_reviewed: false },
  ],
  pending_review: ["CANNOT_BREATHE", "PREGNANCY", "HEAD", "STOMACH", "PAIN_4"],
};

beforeEach(() => {
  localStorage.clear();
  fetchCriticalAlerts.mockResolvedValue(ALERTS);
  fetchEmergencySpeech.mockResolvedValue(PHRASES);
  speakResponse.mockImplementation(async ({ text }) => speech(text));
  vi.stubGlobal("navigator", { ...navigator, vibrate: vi.fn() });
  vi.stubGlobal("URL", {
    ...globalThis.URL,
    createObjectURL: () => "blob:spoken",
    revokeObjectURL: () => {},
  });

  // Plays and finishes at once. jsdom does not implement media playback, so
  // without this every test sat permanently mid speech, which since the
  // speaking overlay arrived means permanently unable to tap anything.
  vi.stubGlobal(
    "Audio",
    class {
      play() {
        this.onplay?.();
        this.onended?.();
        return Promise.resolve();
      }
    },
  );
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
        expect.objectContaining({ text: "I cannot breathe", outputLanguage: "tw" }),
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
  it("speaks what the patient would say, not the label on the button", async () => {
    // "Pain in the stomach" is not how anybody says this, and a bare label is
    // worse input to a translator: asked for "Waist" the service returned
    // "Waist a ɔyɛ ɔkwasea". Sentences fixed every one of those.
    renderTriage();

    await userEvent.click(screen.getByTestId("body-part-STOMACH"));

    await waitFor(() => {
      expect(speakResponse).toHaveBeenCalledWith(
        expect.objectContaining({ text: "I have a stomachache" }),
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
        expect.objectContaining({ text: "I have a headache" }),
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
      // The record says what they told the clinician rather than where they
      // pointed, because that is what a record is read for afterwards.
      expect(texts).toContain("I have severe pain");
      expect(texts).toContain("I have a headache");
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
  it("keeps the body region ids the rest of the app looks clips up by", async () => {
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

  it("offers the face parts a full length figure cannot", async () => {
    // An eye on the body figure is around fifteen pixels across on a phone,
    // which a patient in distress cannot hit, so the face is drawn enlarged
    // with its own regions.
    renderTriage();
    await settle();

    for (const id of ["FACE", "EYE", "EAR", "NOSE", "MOUTH"]) {
      expect(screen.getByTestId(`body-part-${id}`)).toBeInTheDocument();
    }
  });

  it("does not let a trunk region colour the arms", async () => {
    // The bug this structure exists to prevent: with one figure wide clip, the
    // chest band was clipped to the whole silhouette, so its fill ran out
    // along the arms and tapping the chest lit up the arms as well. Asserted
    // on the clips rather than on pixels, because that is the thing that stops
    // it: a region can only paint inside the outline it is clipped to.
    renderTriage();
    await settle();

    const clipOf = (id) =>
      screen.getByTestId(`body-part-${id}`).getAttribute("clip-path");

    for (const trunk of ["CHEST", "STOMACH", "WAIST", "LEG"]) {
      expect(clipOf(trunk)).toBe(clipOf("HEAD"));
      expect(clipOf(trunk)).not.toBe(clipOf("ARM"));
    }
    expect(clipOf("HAND")).toBe(clipOf("ARM"));
  });

  it("gives no two regions the same name", async () => {
    // Two controls called "Head" pointing at different drawings is how a
    // clinician ends up unsure which one the patient tapped.
    renderTriage();
    await settle();

    const names = [
      ...document.querySelectorAll(".body__part"),
    ].map((part) => part.getAttribute("aria-label"));

    expect(new Set(names).size).toBe(names.length);
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

describe("telling the patient they are being heard", () => {
  /** An audio element that starts and never finishes, so speech stays live. */
  function stillSpeaking() {
    vi.stubGlobal(
      "Audio",
      class {
        play() {
          this.onplay?.();
          return Promise.resolve();
        }
      },
    );
  }

  it("shows a speaking face, a wave and the words, over everything", async () => {
    // The patient has no way to hear whether anything was said, and a cue they
    // have to scroll to find is a cue that arrives too late.
    stillSpeaking();
    renderTriage();

    await userEvent.click(screen.getByTestId("pain-level-5"));

    await waitFor(() => {
      expect(screen.getByTestId("speaking-overlay")).toBeInTheDocument();
    });

    const overlay = screen.getByTestId("speaking-overlay");
    expect(overlay.querySelector(".wave")).not.toBeNull();
    expect(screen.getByTestId("talking-face")).toBeInTheDocument();
    expect(screen.getByTestId("speaking-text")).toHaveTextContent("Worst pain");
  });

  it("takes no further taps until it has finished", async () => {
    // One tap has to mean one answer. Two queued underneath each other reach
    // the doctor as two sentences with nothing to say which tap produced
    // which, and in triage that is a wrong answer rather than a clumsy one.
    stillSpeaking();
    renderTriage();

    await userEvent.click(screen.getByTestId("pain-level-5"));
    await waitFor(() => screen.getByTestId("speaking-overlay"));

    speakResponse.mockClear();
    await userEvent.click(screen.getByTestId("body-part-CHEST"));

    expect(speakResponse).not.toHaveBeenCalled();
    expect(screen.getByTestId("body-chosen")).toHaveTextContent("");
  });

  it("can always be stopped, so a stalled answer cannot trap the patient", async () => {
    // An audio element that stalls would otherwise leave a dialog with no way
    // out, which in an emergency is worse than the ambiguity it prevents.
    stillSpeaking();
    renderTriage();

    await userEvent.click(screen.getByTestId("pain-level-5"));
    await waitFor(() => screen.getByTestId("stop-speaking"));

    await userEvent.click(screen.getByTestId("stop-speaking"));

    await waitFor(() => {
      expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument();
    });
    // Reported as stopped, not as spoken: part of an answer reaching the
    // doctor is not the same as all of it, and the patient cannot hear the
    // difference.
    expect(screen.getByTestId("spoken-stopped")).toBeInTheDocument();
  });

  it("puts what was said at the top, not below the fold", async () => {
    renderTriage();

    await userEvent.click(screen.getByTestId("pain-level-4"));

    await waitFor(() => {
      expect(screen.getByTestId("spoken-response")).toBeInTheDocument();
    });
    expect(document.querySelector(".triage__spoken")).toContainElement(
      screen.getByTestId("spoken-response"),
    );
  });

  it("lets a selection be said again for a doctor who missed it", async () => {
    vi.stubGlobal(
      "Audio",
      class {
        play() {
          this.onplay?.();
          this.onended?.();
          return Promise.resolve();
        }
      },
    );

    renderTriage();
    await userEvent.click(screen.getByTestId("body-part-CHEST"));

    await waitFor(() => {
      expect(screen.getByTestId("replay-answer")).toBeInTheDocument();
    });

    speakResponse.mockClear();
    await userEvent.click(screen.getByTestId("replay-answer"));

    // Replayed from the response already in hand, so repeating costs no
    // further metered Khaya credit. ADR 015.
    expect(speakResponse).not.toHaveBeenCalled();
  });

  it("offers nothing to replay before anything has been said", async () => {
    renderTriage();
    await settle();

    expect(screen.queryByTestId("replay-answer")).not.toBeInTheDocument();
  });
});

describe("the two figures", () => {
  it("puts the head and the body side by side", async () => {
    // The head is enlarged so an eye can be hit at all; the body is the larger
    // of the two because most of what a patient points at is on it.
    renderTriage();
    await settle();

    expect(screen.getByTestId("face-map")).toBeInTheDocument();
    expect(screen.getByTestId("body-map")).toBeInTheDocument();
    expect(document.querySelectorAll(".body__figure-wrap")).toHaveLength(2);
  });
});

describe("the page not moving under the patient", () => {
  it("keeps the spoken strip on screen before anything is said", async () => {
    // It used to appear only after a tap, which pushed the alerts and the body
    // map down the page at the exact moment the patient had a finger on them.
    renderTriage();
    await settle();

    expect(screen.getByTestId("triage-ready")).toBeInTheDocument();
    expect(document.querySelector(".triage__spoken")).not.toBeNull();
  });

  it("replaces the instruction in place once something is said", async () => {
    renderTriage();
    await settle();

    await userEvent.click(screen.getByTestId("pain-level-3"));

    await waitFor(() => {
      expect(screen.getByTestId("spoken-response")).toBeInTheDocument();
    });
    // Same strip, different contents: the instruction is gone rather than
    // pushed down by the confirmation.
    expect(screen.queryByTestId("triage-ready")).not.toBeInTheDocument();
    expect(document.querySelector(".triage__spoken")).toContainElement(
      screen.getByTestId("spoken-response"),
    );
  });

  it("keeps the development notice out of that strip", async () => {
    // Three lines saying the same thing after every tap is the one thing that
    // would change the strip's height. It says itself once, at the foot.
    renderTriage();
    await settle();

    await userEvent.click(screen.getByTestId("pain-level-3"));

    await waitFor(() => {
      expect(screen.getByTestId("spoken-stub-warning")).toBeInTheDocument();
    });
    expect(document.querySelector(".triage__spoken")).not.toContainElement(
      screen.getByTestId("spoken-stub-warning"),
    );
  });

  it("says it once however many answers are given", async () => {
    renderTriage();
    await settle();

    await userEvent.click(screen.getByTestId("pain-level-3"));
    await waitFor(() => screen.getByTestId("spoken-stub-warning"));
    await userEvent.click(screen.getByTestId("body-part-CHEST"));

    await waitFor(() => {
      expect(screen.getByTestId("body-chosen")).toHaveTextContent("Chest");
    });
    expect(screen.getAllByTestId("spoken-stub-warning")).toHaveLength(1);
  });
});

describe("choosing the voice answers are read in, FR 5.5", () => {
  /**
   * Emergency can be the first screen anyone opens: it is reachable before a
   * visit exists and before anyone has chosen anything. The control was
   * missing here while the consultation screen had one, so a Twi speaking
   * responder heard every tap read out in English with no way to change it.
   */

  it("offers the choice on screen rather than in a menu", async () => {
    // Section 4.1, and here more than anywhere: this has to be usable in
    // seconds by someone who has never seen the app.
    renderTriage({ onOutputLanguageChange: () => {} });
    await settle();

    const voice = screen.getByTestId("triage-voice");
    expect(voice).toHaveTextContent("English");
    expect(voice).toHaveTextContent("Twi");
  });

  it("shows which voice is currently selected", async () => {
    renderTriage({ outputLanguage: "tw", onOutputLanguageChange: () => {} });
    await settle();

    expect(screen.getByRole("radio", { name: "Twi" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "English" })).not.toBeChecked();
  });

  it("reports a change so it outlasts the screen", async () => {
    // The choice belongs to the visit, not to this component, or leaving and
    // re-entering emergency would silently reset the responder's language.
    const onOutputLanguageChange = vi.fn();
    renderTriage({ outputLanguage: "en", onOutputLanguageChange });
    await settle();

    await userEvent.click(screen.getByRole("radio", { name: "Twi" }));

    expect(onOutputLanguageChange).toHaveBeenCalledWith("tw");
  });

  it("speaks a tapped answer in the chosen voice", async () => {
    // The point of the control. A tap that is spoken in the wrong language is
    // an answer nobody in the room receives.
    renderTriage({ outputLanguage: "tw", onOutputLanguageChange: () => {} });
    await settle();

    await userEvent.click(screen.getByRole("button", { name: /cannot breathe/i }));

    await waitFor(() =>
      expect(speakResponse).toHaveBeenCalledWith(
        expect.objectContaining({ outputLanguage: "tw" }),
      ),
    );
  });

  it("does not offer a mixed voice", async () => {
    // There is no mixed voice to pick, so offering one would mean choosing
    // behind the responder's back.
    renderTriage({ onOutputLanguageChange: () => {} });
    await settle();

    expect(screen.getByTestId("triage-voice")).not.toHaveTextContent("Both");
  });
});

describe("speaking a tap without translating it first", () => {
  /**
   * Emergency mode's vocabulary is fixed, so it is translated once on the
   * server rather than at the moment of a tap. Translating live cost two calls
   * to a metered service and about five seconds, measured, between a patient
   * touching "cannot breathe" and a clinician hearing it.
   */

  it("sends the language the text is already in, so nothing is translated", async () => {
    // The mechanism. Passing "en" as the source for English text means the
    // server has nothing to translate and goes straight to speech: one call
    // rather than two.
    renderTriage({ outputLanguage: "en" });
    await settle();

    await userEvent.click(screen.getByTestId("body-part-HEAD"));

    await waitFor(() => {
      expect(speakResponse).toHaveBeenCalledWith(
        expect.objectContaining({ text: "I have a headache", sourceLanguage: "en" }),
      );
    });
  });

  it("speaks English when the Twi has not been reviewed", async () => {
    // The safety gate. Asked for "Waist" the translator returned "Waist a ɔyɛ
    // ɔkwasea", and two pain levels came back identical. Reading either to a
    // clinician during triage is worse than reading English.
    renderTriage({ outputLanguage: "tw" });
    await settle();

    await userEvent.click(screen.getByTestId("body-part-HEAD"));

    await waitFor(() => {
      expect(speakResponse).toHaveBeenCalledWith(
        expect.objectContaining({ text: "I have a headache", sourceLanguage: "en" }),
      );
    });
  });

  it("speaks the reviewed Twi once somebody has checked it", async () => {
    fetchEmergencySpeech.mockResolvedValue({
      phrases: [
        { key: "HEAD", en: "I have a headache", tw: "Me ti pae me", tw_reviewed: true },
      ],
      pending_review: [],
    });

    renderTriage({ outputLanguage: "tw" });
    await settle();

    await userEvent.click(screen.getByTestId("body-part-HEAD"));

    await waitFor(() => {
      expect(speakResponse).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Me ti pae me", sourceLanguage: "tw" }),
      );
    });
  });

  it("says once why answers are being read in English", async () => {
    // A responder who asked for Twi and keeps hearing English needs to know
    // why, and the honest answer is that nobody has checked the translations.
    renderTriage({ outputLanguage: "tw" });
    await settle();

    await waitFor(() =>
      expect(screen.getByTestId("twi-pending-review")).toBeInTheDocument(),
    );
  });

  it("stays quiet about it when English was asked for", async () => {
    renderTriage({ outputLanguage: "en" });
    await settle();

    expect(screen.queryByTestId("twi-pending-review")).not.toBeInTheDocument();
  });

  it("still speaks when the vocabulary cannot be fetched", async () => {
    // Offline, or the request failed. Every tap falls back to the label, which
    // is how emergency mode behaved before any of this existed.
    fetchEmergencySpeech.mockRejectedValue(new Error("offline"));

    renderTriage({ outputLanguage: "tw" });
    await settle();

    await userEvent.click(screen.getByTestId("body-part-HEAD"));

    await waitFor(() => expect(speakResponse).toHaveBeenCalled());
  });
});
