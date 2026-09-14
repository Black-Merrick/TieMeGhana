import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GuidedInterrogation from "../components/GuidedInterrogation.jsx";
import { captionUtterance } from "../api/consultation.js";
import { fetchBodyLocations } from "../api/clips.js";
import { speakResponse } from "../api/speech.js";

vi.mock("../api/consultation.js", () => ({ captionUtterance: vi.fn() }));
vi.mock("../api/speech.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, speakResponse: vi.fn() };
});
vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchBodyLocations: vi.fn() };
});

/**
 * Guided Interrogation, FR 2.4 to 2.7, as redesigned in ADR 023.
 *
 * The doctor asks in their own words, exactly as for a patient who reads. The
 * difference is entirely on the patient's side: yes or no rather than typing.
 */

function caption(overrides = {}) {
  return {
    source_language: "en",
    transcript: "Did you vomit?",
    caption: "Wo foee?",
    caption_language: "tw",
    sign_lookup_text: "Did you vomit?",
    transcript_source: "typed",
    translation_applied: true,
    language_provider: "khaya",
    sequence: {
      source_text: "Did you vomit?",
      segments: [
        {
          token: "vomit",
          match: "gloss",
          clips: [
            { gloss: "VOMIT", video_url: "/media/clips/vomit.webm", duration_ms: 800 },
          ],
        },
      ],
      total_duration_ms: 800,
      fingerspelled_tokens: [],
      unavailable_tokens: [],
      omitted_tokens: [],
      blocking_tokens: [],
      back_translation: ["HEAD"],
      is_safe_to_show: true,
      needs_confirmation: false,
    },
    ...overrides,
  };
}

function bodyLocation(gloss, label, isPlayable = true) {
  return {
    id: gloss,
    english_text: label,
    is_playable: isPlayable,
    clip: isPlayable
      ? {
          gloss,
          video_url: `/media/clips/${gloss.toLowerCase()}.webm`,
          duration_ms: 800,
        }
      : null,
  };
}

const filmedLocations = [
  bodyLocation("HEAD", "Head"),
  bodyLocation("STOMACH", "Stomach"),
];

beforeEach(() => {
  // The transcript persists on the device now, so it has to be cleared between
  // tests or one consultation's record leaks into the next.
  localStorage.clear();
  captionUtterance.mockResolvedValue(caption());
  fetchBodyLocations.mockResolvedValue(filmedLocations);
  speakResponse.mockResolvedValue({
    spoken_text: "Yes",
    language_provider: "khaya",
    audio_base64: btoa("RIFFWAVE"),
    audio_media_type: "audio/wav",
  });
  vi.stubGlobal(
    "Audio",
    class {
      play() {
        return Promise.resolve();
      }
    },
  );
  vi.stubGlobal("URL", {
    ...globalThis.URL,
    createObjectURL: () => "blob:spoken",
    revokeObjectURL: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.clearAllMocks();
});

/**
 * Play the sign video through to its end.
 *
 * The answers replace the video once the patient has watched it, so a test
 * that wants to answer has to watch first. jsdom does not play media, so the
 * ended event is dispatched directly, which is what a real browser fires.
 */
async function watchQuestion() {
  let video = null;
  try {
    video = await waitFor(() => {
      const element = document.querySelector("video");
      if (!element) throw new Error("no sign video on screen");
      return element;
    });
  } catch {
    // No video, which is the case for a refused sentence and for one still
    // behind the confirmation gate. Nothing to watch, and nothing to assert
    // here: those cases have their own tests.
    return;
  }

  fireEvent.ended(video);

  // The answers replace the video after a short settle, so waiting for the
  // event alone would race the swap.
  await waitFor(() =>
    expect(screen.getByTestId("stage-answers")).toBeInTheDocument(),
  );
}

async function askFreely(
  text = "Did you vomit?",
  outputLanguage = "en",
  { watch = true } = {},
) {
  const user = userEvent.setup();
  render(<GuidedInterrogation outputLanguage={outputLanguage} />);
  await user.type(screen.getByLabelText(/message for the patient/i), text);
  await user.click(screen.getByRole("button", { name: /ask the patient/i }));

  // The patient watches the question before answering it, so the answers
  // replace the video only once it has played. Every test that goes on to
  // answer needs that to have happened.
  if (watch) await watchQuestion();

  return user;
}

describe("asking in the doctor's own words", () => {
  it("offers no fixed question bank", async () => {
    // ADR 023 replaced the bank. The doctor asks whatever the consultation
    // needs, so a preset list would only get in the way.
    render(<GuidedInterrogation outputLanguage="en" />);

    expect(screen.getByLabelText(/message for the patient/i)).toBeInTheDocument();
    expect(screen.queryByText(/clinical question bank/i)).not.toBeInTheDocument();
  });

  it("sends the typed question through the same pipeline as a caption", async () => {
    await askFreely("Did you vomit?");

    await waitFor(() => {
      expect(captionUtterance).toHaveBeenCalledWith({
        sourceLanguage: "en",
        text: "Did you vomit?",
      });
    });
  });

  it("plays the question to the patient as a stitched sign video", async () => {
    // FR 2.4. The patient sees GhSL, stitched from the clip library, not the
    // English the doctor typed. Left unwatched: once it has played the answers
    // take its place, which is what the next tests are about.
    await askFreely("Did you vomit?", "en", { watch: false });

    await waitFor(() => {
      expect(screen.getByTestId("sign-video")).toHaveAttribute(
        "src",
        "/media/clips/vomit.webm",
      );
    });
  });

  it("offers the doctor a microphone as well as typing", async () => {
    // FR 1.2. The doctor's side is identical on both paths, so speaking works
    // here too rather than only for a patient who reads.
    render(<GuidedInterrogation outputLanguage="en" />);

    expect(
      screen.queryByTestId("microphone-button") ??
        screen.getByTestId("microphone-unsupported"),
    ).toBeInTheDocument();
  });

  it("reports a language failure rather than leaving the doctor waiting", async () => {
    captionUtterance.mockRejectedValue(new Error("offline"));
    await askFreely();

    await waitFor(() => {
      expect(screen.getByTestId("caption-error")).toBeInTheDocument();
    });
  });
});

describe("the patient answering yes or no", () => {
  it("asks for yes or no after the question has played", async () => {
    await askFreely();

    await waitFor(() => {
      expect(screen.getByTestId("choice-yes")).toBeInTheDocument();
    });
    expect(screen.getByTestId("choice-no")).toBeInTheDocument();
  });

  it("needs no typing from the patient", async () => {
    // Section 4.3. The patient is never asked to type.
    //
    // This used to assert that the answer buttons carried no text, which was
    // a proxy for the requirement rather than the requirement, and it broke
    // when the buttons gained labels under ADR 047. What it should have
    // checked all along: the only place to type on this screen is the
    // doctor's, and the patient answers by tapping.
    await askFreely();

    await waitFor(() => screen.getByTestId("choice-yes"));

    const typeable = [
      ...document.querySelectorAll("textarea, input[type='text'], [contenteditable='true']"),
    ];
    expect(typeable).toHaveLength(1);
    expect(typeable[0]).toBe(screen.getByLabelText(/message for the patient/i));

    expect(screen.getByTestId("choice-yes").tagName).toBe("BUTTON");
    expect(screen.getByTestId("choice-no").tagName).toBe("BUTTON");
  });

  it("tells the doctor a nod counts, and that their tap is what is recorded", async () => {
    // FR 2.6 and FR 2.7. No camera based gesture detection: the doctor
    // observes the patient and taps what they saw.
    await askFreely();

    await waitFor(() => {
      expect(screen.getByTestId("nod-instruction")).toBeInTheDocument();
    });
  });

  it("uses no camera", async () => {
    // Asserted directly, because adding gesture detection later would change a
    // stated design decision rather than improve on it.
    await askFreely();

    await waitFor(() => screen.getByTestId("choice-yes"));
    expect(navigator.mediaDevices).toBeUndefined();
  });

  it("records the question alongside the answer", async () => {
    const user = await askFreely();

    await waitFor(() => screen.getByTestId("choice-yes"));
    await user.click(screen.getByTestId("choice-yes"));

    await waitFor(() => {
      expect(screen.getByTestId("transcript")).toHaveTextContent(
        "Did you vomit?",
      );
    });
    expect(screen.getByTestId("transcript")).toHaveTextContent("Yes");
  });

  it("records a no the same way", async () => {
    const user = await askFreely();

    await waitFor(() => screen.getByTestId("choice-no"));
    await user.click(screen.getByTestId("choice-no"));

    await waitFor(() => {
      expect(screen.getByTestId("transcript")).toHaveTextContent("No");
    });
  });

  it("attributes the answer to the doctor's confirmation", async () => {
    // FR 2.7. What is logged is what the doctor confirmed, so the record can
    // never imply the patient tapped something they never touched.
    const user = await askFreely();

    await waitFor(() => screen.getByTestId("choice-yes"));
    await user.click(screen.getByTestId("choice-yes"));

    await waitFor(() => {
      expect(screen.getByTestId("transcript")).toHaveTextContent(
        "confirmed by the doctor",
      );
    });
  });

  it("clears the question once answered, ready for the next one", async () => {
    const user = await askFreely();

    await waitFor(() => screen.getByTestId("choice-yes"));
    await user.click(screen.getByTestId("choice-yes"));

    await waitFor(() => {
      expect(screen.queryByTestId("choice-yes")).not.toBeInTheDocument();
    });
  });
});

describe("asking where it hurts", () => {
  it("asks the one question a patient cannot answer yes or no", async () => {
    const user = userEvent.setup();
    render(<GuidedInterrogation outputLanguage="en" />);

    await user.click(screen.getByTestId("ask-where-it-hurts"));
    await watchQuestion();

    await waitFor(() => {
      expect(captionUtterance).toHaveBeenCalledWith({
        sourceLanguage: "en",
        text: "Where does it hurt?",
      });
    });
  });

  it("shows the body locations instead of yes or no", async () => {
    // FR 2.5. The answer tells the doctor where to focus for the rest of the
    // consultation, which yes or no cannot.
    const user = userEvent.setup();
    render(<GuidedInterrogation outputLanguage="en" />);

    await user.click(screen.getByTestId("ask-where-it-hurts"));
    await watchQuestion();

    await waitFor(() => {
      expect(screen.getByTestId("answer-option-HEAD")).toBeInTheDocument();
    });
    expect(screen.getByTestId("answer-option-STOMACH")).toBeInTheDocument();
    expect(screen.queryByTestId("choice-yes")).not.toBeInTheDocument();
  });

  it("records the location the patient tapped as their own answer", async () => {
    const user = userEvent.setup();
    render(<GuidedInterrogation outputLanguage="en" />);

    await user.click(screen.getByTestId("ask-where-it-hurts"));
    await watchQuestion();
    await waitFor(() => screen.getByTestId("answer-option-STOMACH"));
    await user.click(screen.getByTestId("answer-option-STOMACH"));

    await waitFor(() => {
      expect(screen.getByTestId("transcript")).toHaveTextContent("Stomach");
    });
    expect(screen.getByTestId("transcript")).toHaveTextContent(
      "tapped by the patient",
    );
  });

  it("withholds the grid when some locations are not filmed", async () => {
    // The clinical safety property. A patient offered three body parts when
    // their pain is in a fourth taps the nearest available one, and that wrong
    // answer looks exactly like a right one. ADR 022.
    fetchBodyLocations.mockResolvedValue([
      bodyLocation("HEAD", "Head", true),
      bodyLocation("STOMACH", "Stomach", false),
    ]);
    const user = userEvent.setup();
    render(<GuidedInterrogation outputLanguage="en" />);

    await user.click(screen.getByTestId("ask-where-it-hurts"));
    await watchQuestion();

    await waitFor(() => {
      expect(screen.getByTestId("incomplete-locations")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("answer-option-HEAD")).not.toBeInTheDocument();
  });

  it("goes back to yes or no for the next ordinary question", async () => {
    const user = userEvent.setup();
    render(<GuidedInterrogation outputLanguage="en" />);

    await user.click(screen.getByTestId("ask-where-it-hurts"));
    await watchQuestion();
    await waitFor(() => screen.getByTestId("answer-option-HEAD"));

    await user.type(screen.getByLabelText(/message for the patient/i), "Fever?");
    await user.click(screen.getByRole("button", { name: /ask the patient/i }));
    await watchQuestion();

    await waitFor(() => {
      expect(screen.getByTestId("choice-yes")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("answer-option-HEAD")).not.toBeInTheDocument();
  });

  it("does not ask for a location when the question never reached the patient", async () => {
    // Asking someone to point at a place after showing them nothing would
    // record an answer to a question they were never asked.
    captionUtterance.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<GuidedInterrogation outputLanguage="en" />);

    await user.click(screen.getByTestId("ask-where-it-hurts"));
    await watchQuestion();

    await waitFor(() => {
      expect(screen.getByTestId("caption-error")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("answer-option-HEAD")).not.toBeInTheDocument();
  });

  it("still works when the body locations cannot be loaded", async () => {
    // Every other question is unaffected, so this degrades rather than
    // blocking the whole mode.
    fetchBodyLocations.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<GuidedInterrogation outputLanguage="en" />);

    await user.click(screen.getByTestId("ask-where-it-hurts"));
    await watchQuestion();

    await waitFor(() => {
      expect(screen.getByTestId("incomplete-locations")).toBeInTheDocument();
    });
  });
});

describe("the consultation log", () => {
  it("shows nothing before the first exchange", () => {
    render(<GuidedInterrogation outputLanguage="en" />);

    expect(screen.queryByTestId("transcript")).not.toBeInTheDocument();
  });

  it("says the record is kept on this device and nowhere else", async () => {
    // FR 4.2 and NFR 4. The patient has to be able to see that, because it is
    // the reason they would use this rather than bring a relative to interpret.
    const user = await askFreely();

    await waitFor(() => screen.getByTestId("choice-yes"));
    await user.click(screen.getByTestId("choice-yes"));

    await waitFor(() => {
      expect(screen.getByTestId("transcript-privacy")).toBeInTheDocument();
    });
  });

  it("records the question as well as the answer, both directions", async () => {
    // FR 4.1 requires both directions, so a record showing only answers would
    // not say what the patient was actually asked.
    const user = await askFreely();

    await waitFor(() => screen.getByTestId("choice-yes"));
    await user.click(screen.getByTestId("choice-yes"));

    await waitFor(() => {
      const list = screen.getByTestId("transcript-list");
      expect(list).toHaveTextContent("Did you vomit?");
      expect(list).toHaveTextContent("Yes");
    });
  });
});


describe("speaking the patient's answer aloud", () => {
  it("speaks a tapped yes to the hearing listener", async () => {
    // FR 3.5, the property this whole sprint turns on. The doctor's hands are
    // on the patient rather than the screen, so a tapped answer has to be
    // audible without them looking.
    const user = await askFreely();

    await waitFor(() => screen.getByTestId("choice-yes"));
    await user.click(screen.getByTestId("choice-yes"));

    await waitFor(() => {
      expect(speakResponse).toHaveBeenCalledWith({
        text: "Yes",
        sourceLanguage: "en",
        outputLanguage: "en",
      });
    });
  });

  it("speaks in the language set for this visit", async () => {
    // FR 3.4. Set once by the doctor or nurse and applied to every response,
    // so a Twi speaking nurse hears Twi without changing anything per answer.
    const user = await askFreely("Fever?", "tw");

    await waitFor(() => screen.getByTestId("choice-no"));
    await user.click(screen.getByTestId("choice-no"));

    await waitFor(() => {
      expect(speakResponse).toHaveBeenCalledWith({
        text: "No",
        sourceLanguage: "en",
        outputLanguage: "tw",
      });
    });
  });

  it("speaks a tapped body location too", async () => {
    const user = userEvent.setup();
    render(<GuidedInterrogation outputLanguage="en" />);

    await user.click(screen.getByTestId("ask-where-it-hurts"));
    await watchQuestion();
    await waitFor(() => screen.getByTestId("answer-option-STOMACH"));
    await user.click(screen.getByTestId("answer-option-STOMACH"));

    await waitFor(() => {
      expect(speakResponse).toHaveBeenCalledWith({
        text: "Stomach",
        sourceLanguage: "en",
        outputLanguage: "en",
      });
    });
  });

  it("confirms on screen that the answer was spoken", async () => {
    // Section 4.2. The patient cannot hear it, so they need to see it.
    const user = await askFreely();

    await waitFor(() => screen.getByTestId("choice-yes"));
    await user.click(screen.getByTestId("choice-yes"));

    await waitFor(() => {
      expect(screen.getByTestId("spoken-response")).toBeInTheDocument();
    });
  });
});


describe("surviving a page reload", () => {
  it("puts the question back on screen", async () => {
    // ADR 032. A reload is ordinary on a hospital device, and the patient may
    // not have finished watching the sign video.
    const user = await askFreely("Did you vomit?");
    await waitFor(() => screen.getByTestId("choice-yes"));

    // Unmount and mount again, which is what a reload does to the component.
    cleanup();
    render(<GuidedInterrogation outputLanguage="en" />);

    expect(screen.getByTestId("caption")).toHaveTextContent("Wo foee?");
    expect(user).toBeDefined();
  });

  it("still offers the answer, rather than asking the question again", async () => {
    await askFreely();
    await waitFor(() => screen.getByTestId("choice-yes"));

    cleanup();
    render(<GuidedInterrogation outputLanguage="en" />);
    await watchQuestion();

    expect(screen.getByTestId("choice-yes")).toBeInTheDocument();
  });

  it("keeps the transcript of everything already said", async () => {
    const user = await askFreely();
    await waitFor(() => screen.getByTestId("choice-yes"));
    await user.click(screen.getByTestId("choice-yes"));
    await waitFor(() => screen.getByTestId("transcript"));

    cleanup();
    render(<GuidedInterrogation outputLanguage="en" />);

    expect(screen.getByTestId("transcript-list")).toHaveTextContent("Did you vomit?");
    expect(screen.getByTestId("transcript-list")).toHaveTextContent("Yes");
  });

  it("remembers that a body location was expected", async () => {
    // Otherwise the patient is dropped back to a yes or no they were never
    // asked, against a question that wanted a place.
    const user = userEvent.setup();
    render(<GuidedInterrogation outputLanguage="en" />);
    await user.click(screen.getByTestId("ask-where-it-hurts"));
    await watchQuestion();
    await waitFor(() => screen.getByTestId("answer-option-HEAD"));

    cleanup();
    render(<GuidedInterrogation outputLanguage="en" />);
    await watchQuestion();

    await waitFor(() => {
      expect(screen.getByTestId("answer-option-HEAD")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("choice-yes")).not.toBeInTheDocument();
  });

  it("starts clean once the question has been answered", async () => {
    // An answered question should not reappear on the next reload, or the
    // doctor would think it was still waiting.
    const user = await askFreely();
    await waitFor(() => screen.getByTestId("choice-yes"));
    await user.click(screen.getByTestId("choice-yes"));

    cleanup();
    render(<GuidedInterrogation outputLanguage="en" />);

    expect(screen.queryByTestId("caption")).not.toBeInTheDocument();
    expect(screen.queryByTestId("choice-yes")).not.toBeInTheDocument();
  });
});

describe("the safety gate, ADR 033", () => {
  function refused(blocking) {
    const c = caption();
    c.sequence.blocking_tokens = blocking;
    c.sequence.is_safe_to_show = false;
    return c;
  }

  it("never asks the patient to answer a refused question", async () => {
    // The patient never saw it, so there is nothing for them to answer, and a
    // Yes recorded against a question that was not asked would be worse than
    // no record at all.
    captionUtterance.mockResolvedValue(refused(["no"]));
    await askFreely("no pain");

    await waitFor(() => {
      expect(screen.getByTestId("utterance-refused")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("choice-yes")).not.toBeInTheDocument();
  });

  it("never records a refused question as asked", async () => {
    captionUtterance.mockResolvedValue(refused(["no"]));
    await askFreely("no pain");

    await waitFor(() => screen.getByTestId("utterance-refused"));
    expect(screen.queryByTestId("transcript")).not.toBeInTheDocument();
  });

  it("holds the answer back until the doctor has checked the sentence", async () => {
    const c = caption();
    c.sequence.omitted_tokens = ["the"];
    c.sequence.needs_confirmation = true;
    captionUtterance.mockResolvedValue(c);
    const user = await askFreely("the pain");

    await waitFor(() => {
      expect(screen.getByTestId("utterance-confirm")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("choice-yes")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("confirm-show"));
    await watchQuestion();

    await waitFor(() => {
      expect(screen.getByTestId("choice-yes")).toBeInTheDocument();
    });
  });

  it("records the question only once it has been shown", async () => {
    const c = caption();
    c.sequence.omitted_tokens = ["the"];
    c.sequence.needs_confirmation = true;
    captionUtterance.mockResolvedValue(c);
    const user = await askFreely("the pain");

    await waitFor(() => screen.getByTestId("confirm-show"));
    expect(screen.queryByTestId("transcript")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("confirm-show"));

    await waitFor(() => {
      expect(screen.getByTestId("transcript-list")).toHaveTextContent(
        "Did you vomit?",
      );
    });
  });

  it("records a shown question exactly once", async () => {
    // The callback's identity changes every render, so without a guard the
    // effect would fire repeatedly and write the question again each time.
    await askFreely();

    await waitFor(() => screen.getByTestId("transcript-list"));
    const entries = screen.getAllByRole("listitem");

    expect(entries).toHaveLength(1);
  });

  it("shows a fully signed question with no confirmation step", async () => {
    // Friction where there is no risk would train the doctor to tap through
    // the confirmation without reading it.
    await askFreely();

    await waitFor(() => {
      expect(screen.getByTestId("caption")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("utterance-confirm")).not.toBeInTheDocument();
  });
});

describe("the answers take the video's place", () => {
  it("withholds the answers until the patient has watched the question", async () => {
    // A Deaf patient learns the question from the sign video. Offering Yes and
    // No before it has played invites a tap on a question not yet understood.
    await askFreely("Did you vomit?", "en", { watch: false });

    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    expect(screen.queryByTestId("choice-yes")).not.toBeInTheDocument();
  });

  it("puts them where the video was, not below it", async () => {
    // The reason this moved. A Yes the patient has to scroll to find is a Yes
    // they may not find, and the doctor cannot see what they are looking at.
    await askFreely();

    await waitFor(() => {
      expect(screen.getByTestId("stage-answers")).toBeInTheDocument();
    });
    expect(screen.getByTestId("stage-answers")).toContainElement(
      screen.getByTestId("choice-yes"),
    );
    // The video is gone, so nothing competes with the answer for the space.
    expect(document.querySelector("video")).toBeNull();
  });

  it("keeps the caption on screen while they answer", async () => {
    // The caption is the question. Removing it with the video would leave the
    // patient choosing between Yes and No with nothing to answer.
    await askFreely();

    await waitFor(() => screen.getByTestId("stage-answers"));
    expect(screen.getByTestId("caption")).toBeInTheDocument();
  });

  it("lets the question be played again", async () => {
    // A sign seen once may not have been understood, and a patient who cannot
    // ask for a repeat will guess.
    const user = await askFreely();

    await waitFor(() => screen.getByTestId("replay-question"));
    await user.click(screen.getByTestId("replay-question"));

    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    expect(screen.queryByTestId("choice-yes")).not.toBeInTheDocument();
  });

  it("offers the answers when there is no video to wait for", async () => {
    // Every word resolved to an omission, so the sentence is safe to show and
    // answerable but no video will ever fire an ended event. Waiting for one
    // would leave the patient with no way to answer at all.
    const c = caption();
    c.sequence.segments = [];
    captionUtterance.mockResolvedValue(c);

    await askFreely("Did you vomit?", "en", { watch: false });

    await waitFor(() => {
      expect(screen.getByTestId("choice-yes")).toBeInTheDocument();
    });
    // Nothing to replay, so nothing offers to.
    expect(screen.queryByTestId("replay-question")).not.toBeInTheDocument();
  });

  it("starts the next question unwatched", async () => {
    // Otherwise the answers would already be on screen for a question the
    // patient has not seen.
    const user = await askFreely();
    await waitFor(() => screen.getByTestId("choice-yes"));

    await user.click(screen.getByTestId("choice-yes"));
    await user.type(screen.getByLabelText(/message for the patient/i), "Fever?");
    await user.click(screen.getByRole("button", { name: /ask the patient/i }));

    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    expect(screen.queryByTestId("choice-yes")).not.toBeInTheDocument();
  });
});
