import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DoctorConsultation from "../components/DoctorConsultation.jsx";
import { captionUtterance } from "../api/consultation.js";
import { speakResponse } from "../api/speech.js";

vi.mock("../api/consultation.js", () => ({ captionUtterance: vi.fn() }));
vi.mock("../api/speech.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, speakResponse: vi.fn() };
});

function captionResponse(overrides = {}) {
  return {
    source_language: "en",
    transcript: "head hurts",
    caption: "head hurts",
    caption_language: "tw",
    sign_lookup_text: "head hurts",
    transcript_source: "typed",
    translation_applied: true,
    language_provider: "khaya",
    sequence: {
      source_text: "head hurts",
      segments: [
        {
          token: "head",
          match: "gloss",
          clips: [
            { gloss: "HEAD", video_url: "/media/clips/head.webm", duration_ms: 900 },
          ],
        },
      ],
      total_duration_ms: 900,
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

beforeEach(() => {
  // The current exchange and the transcript are both kept in localStorage, so
  // without this a test that renders fresh inherits whatever the previous test
  // asked the patient. It was harmless until the reply moved into the stage,
  // where it appears only once the message has been watched: a leaked exchange
  // put a video on screen in a test that had sent nothing.
  localStorage.clear();

  captionUtterance.mockResolvedValue(captionResponse());
  speakResponse.mockResolvedValue({
    spoken_text: "my head hurts",
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
  vi.clearAllMocks();
  localStorage.clear();
});

describe("DoctorConsultation", () => {
  it("shows the input language choice before anything is said", () => {
    // FR 1.1 requires the doctor to pick the language first, and SRS 4.1
    // requires it to be visible rather than buried in a settings menu.
    render(<DoctorConsultation outputLanguage="en" />);

    // Scoped to the doctor's own group. The screen also carries the patient's
    // writing language and the spoken output language, which are three
    // different settings per FR 1.1, FR 3.1 and FR 3.4.
    const group = within(screen.getByTestId("doctor-language"));
    expect(group.getByRole("radio", { name: /english/i })).toBeInTheDocument();
    expect(group.getByRole("radio", { name: /twi/i })).toBeInTheDocument();
  });

  it("sends the typed message in the selected language", async () => {
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.click(
      within(screen.getByTestId("doctor-language")).getByRole("radio", {
        name: /twi/i,
      }),
    );
    await user.type(screen.getByLabelText(/message for the patient/i), "wo tiri");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(captionUtterance).toHaveBeenCalledWith({
        sourceLanguage: "tw",
        text: "wo tiri",
      });
    });
  });

  it("shows the caption and the sign video together, not as separate tabs", async () => {
    // SRS 4.1 is explicit that these appear at the same time, so a patient
    // never has to switch views to follow one sentence.
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "head hurts");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(screen.getByTestId("caption")).toHaveTextContent("head hurts");
    });
    expect(screen.getByTestId("sign-video")).toBeInTheDocument();
  });

  it("warns when the caption came from the development stub", async () => {
    // ADR 011. The stub returns text untranslated, so without this notice the
    // screen would present English as though it were Twi.
    captionUtterance.mockResolvedValue(
      captionResponse({ language_provider: "stub" }),
    );
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "head hurts");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(screen.getByTestId("provider-warning")).toBeInTheDocument();
    });
  });

  it("says speech was not transcribed when the stub handled a recording", async () => {
    // Stronger than the typed case. The stub invents a transcript rather than
    // just leaving it untranslated, so a spoken demo would otherwise show
    // words the doctor never said as though they were heard.
    captionUtterance.mockResolvedValue(
      captionResponse({ language_provider: "stub", transcript_source: "spoken" }),
    );
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "head hurts");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(screen.getByTestId("provider-warning")).toHaveTextContent(
        /not transcribed/i,
      );
    });
  });

  it("shows no provider warning when real translation was used", async () => {
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "head hurts");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(screen.getByTestId("caption")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("provider-warning")).not.toBeInTheDocument();
  });

  it("holds a spelled word behind the gate until the doctor checks it", async () => {
    // ADR 033. A spelled clinical term may not be understood, so the doctor
    // reads back what the patient will see before they see it.
    const response = captionResponse();
    response.sequence.fingerspelled_tokens = ["hurts"];
    response.sequence.needs_confirmation = true;
    captionUtterance.mockResolvedValue(response);
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "head hurts");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(screen.getByTestId("confirm-spelled")).toHaveTextContent("hurts");
    });
    // Nothing is on screen for the patient yet.
    expect(screen.queryByTestId("caption")).not.toBeInTheDocument();
  });

  it("shows the caption once the doctor confirms", async () => {
    const response = captionResponse();
    response.sequence.fingerspelled_tokens = ["hurts"];
    response.sequence.needs_confirmation = true;
    captionUtterance.mockResolvedValue(response);
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "head hurts");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));
    await waitFor(() => screen.getByTestId("confirm-show"));
    await user.click(screen.getByTestId("confirm-show"));

    expect(screen.getByTestId("caption")).toBeInTheDocument();
  });

  it("refuses a sentence with a word that can be neither signed nor spelled", async () => {
    // The patient would see only part of the sentence and might guess at the
    // rest, which ADR 022 already refuses for a partial answer grid.
    const response = captionResponse();
    response.sequence.unavailable_tokens = ["nausea"];
    response.sequence.is_safe_to_show = false;
    captionUtterance.mockResolvedValue(response);
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "nausea");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(screen.getByTestId("refused-missing")).toHaveTextContent("nausea");
    });
    expect(screen.queryByTestId("caption")).not.toBeInTheDocument();
  });

  it("refuses a sentence whose negation has no sign, and says why", async () => {
    // The failure that started this. "no pain" losing "no" means "pain", and
    // the patient answers the opposite question.
    const response = captionResponse();
    response.sequence.blocking_tokens = ["no"];
    response.sequence.is_safe_to_show = false;
    captionUtterance.mockResolvedValue(response);
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "no pain");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(screen.getByTestId("refused-blocking")).toHaveTextContent("no");
    });
    expect(screen.getByTestId("utterance-refused")).toHaveTextContent(
      /change what the sentence means/i,
    );
    expect(screen.queryByTestId("confirm-show")).not.toBeInTheDocument();
  });

  it("shows the English the signs were matched from", async () => {
    // ADR 014. Signs are keyed on English, so with Twi input the matched text
    // is a translation rather than what the doctor typed, and they need to see
    // which words were actually searched for.
    const response = captionResponse({ sign_lookup_text: "EN:wo tiri" });
    response.sequence.needs_confirmation = true;
    captionUtterance.mockResolvedValue(response);
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "wo tiri");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(screen.getByTestId("lookup-text")).toHaveTextContent("EN:wo tiri");
    });
  });

  it("reports a failure instead of leaving the doctor waiting", async () => {
    captionUtterance.mockRejectedValue(new Error("service unavailable"));
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "head hurts");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(screen.getByTestId("caption-error")).toBeInTheDocument();
    });
  });

  it("will not send an empty message", async () => {
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    expect(captionUtterance).not.toHaveBeenCalled();
  });

  it("says why nothing was sent instead of doing nothing", async () => {
    // Silently ignoring the tap is the worst response. Mid consultation the
    // doctor would assume the message reached the patient and wait for an
    // answer that is never coming.
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    expect(screen.getByTestId("empty-message-warning")).toBeInTheDocument();
  });

  it("mentions the microphone when this browser can record", async () => {
    // Typing is not the only way to send, so the message should not imply it
    // is. Under jsdom there is no microphone, so the wording drops it.
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    expect(screen.getByTestId("empty-message-warning")).toHaveTextContent(
      /type a message/i,
    );
  });

  it("clears the warning as soon as the doctor starts typing", async () => {
    // A warning that lingered would contradict what is on screen.
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await user.type(screen.getByLabelText(/message for the patient/i), "H");

    expect(screen.queryByTestId("empty-message-warning")).not.toBeInTheDocument();
  });

  it("sends normally once there is something to send", async () => {
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await user.type(screen.getByLabelText(/message for the patient/i), "Fever?");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(captionUtterance).toHaveBeenCalledOnce();
    });
  });

  it("shows a working indicator while the caption is being produced", async () => {
    // SRS 4.1 requires a visible status during processing, so the doctor is
    // never left wondering whether their action registered.
    let resolve;
    captionUtterance.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "head hurts");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    expect(screen.getByTestId("working-indicator")).toBeInTheDocument();

    resolve(captionResponse());
    await waitFor(() => {
      expect(screen.queryByTestId("working-indicator")).not.toBeInTheDocument();
    });
  });
});


describe("the patient's typed reply", () => {
  it("speaks the reply aloud in the visit's output language", async () => {
    // FR 3.1, 3.2 and 3.4 together: the patient writes Twi, the doctor hears
    // English, and the language was set once for the visit.
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/type your answer/i), "me tiri yɛ me ya");
    await user.click(screen.getByRole("button", { name: /speak to the doctor/i }));

    await waitFor(() => {
      expect(speakResponse).toHaveBeenCalledWith({
        text: "me tiri yɛ me ya",
        sourceLanguage: "tw",
        outputLanguage: "en",
      });
    });
  });

  it("confirms on screen that the reply was spoken", async () => {
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/type your answer/i), "yes");
    await user.click(screen.getByRole("button", { name: /speak to the doctor/i }));

    await waitFor(() => {
      expect(screen.getByTestId("spoken-response")).toBeInTheDocument();
    });
  });
});

describe("where the patient replies", () => {
  async function watchMessage() {
    const video = await waitFor(() => {
      const element = document.querySelector("video");
      if (!element) throw new Error("no sign video on screen");
      return element;
    });
    fireEvent.ended(video);

    // The reply replaces the video after a short settle, so waiting for the
    // event alone would race the swap.
    await waitFor(() =>
      expect(screen.getByTestId("stage-answers")).toBeInTheDocument(),
    );
  }

  it("offers a reply before anything has been asked, per FR 3.1", async () => {
    // A patient on this path can say something unprompted. A screen that only
    // offered a reply after a question would quietly take that away.
    render(<DoctorConsultation outputLanguage="en" />);

    expect(screen.getByTestId("stage-idle")).toBeInTheDocument();
    expect(screen.getByLabelText(/type your answer/i)).toBeInTheDocument();
  });

  it("takes the video's place once the message has played", async () => {
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "Hello");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));
    await watchMessage();

    await waitFor(() => {
      expect(screen.getByTestId("stage-answers")).toBeInTheDocument();
    });
    expect(screen.getByTestId("stage-answers")).toContainElement(
      screen.getByLabelText(/type your answer/i),
    );
    // Nothing competes with the reply for the space the patient is looking at.
    expect(document.querySelector("video")).toBeNull();
  });

  it("keeps the reply out of the way while the message is playing", async () => {
    // The patient is watching, not typing, and a reply box under a playing
    // video invites an answer to a question only half seen.
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "Hello");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    expect(screen.queryByLabelText(/type your answer/i)).not.toBeInTheDocument();
  });

  it("is not duplicated in the doctor's column", async () => {
    // It used to live there. Two reply boxes would let the patient type into
    // one and send the other, empty.
    render(<DoctorConsultation outputLanguage="en" />);

    expect(screen.getAllByLabelText(/type your answer/i)).toHaveLength(1);
  });
});

describe("telling the patient their answer is being spoken", () => {
  /**
   * An Audio stand-in that fires the events a real one fires.
   *
   * The shared stub in this file resolves play() and never calls onplay or
   * onended, which leaves the hook stuck reporting "working". That is fine for
   * tests about the request, and useless for tests about what the patient sees
   * while the audio runs, which is the whole cycle.
   */
  function stubAudio({ endImmediately = false } = {}) {
    const played = [];

    vi.stubGlobal(
      "Audio",
      class {
        constructor(src) {
          this.src = src;
          played.push(this);
        }

        play() {
          this.onplay?.();
          if (endImmediately) this.onended?.();
          return Promise.resolve();
        }
      },
    );

    return played;
  }

  it("shows a wave in the button itself while it speaks", async () => {
    // Section 4.2. A Deaf patient cannot hear whether their answer went out,
    // and the button they pressed is where they are already looking, so the
    // cue belongs in it rather than somewhere else on the screen.
    // Playing but not finished, which is the state the wave describes.
    stubAudio();
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/type your answer/i), "I'm good");
    await user.click(screen.getByTestId("speak-to-doctor"));

    await waitFor(() => {
      expect(screen.getByTestId("speak-to-doctor").querySelector(".wave"))
        .not.toBeNull();
    });

    // And nothing to replay yet: it is still being said the first time.
    expect(screen.queryByTestId("replay-answer")).not.toBeInTheDocument();
  });

  it("lets the answer be said again for a doctor who missed it", async () => {
    // The patient has no way to tell a doctor who understood from one who was
    // not listening, so repeating has to be theirs to do.
    const played = stubAudio({ endImmediately: true });
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/type your answer/i), "I'm good");
    await user.click(screen.getByTestId("speak-to-doctor"));

    await waitFor(() => {
      expect(screen.getByTestId("replay-answer")).toBeInTheDocument();
    });

    speakResponse.mockClear();
    await user.click(screen.getByTestId("replay-answer"));

    // Played a second time rather than merely re-rendered.
    expect(played).toHaveLength(2);

    // Replayed from the response already in hand. Asking the language service
    // again would spend metered Khaya credit to repeat something unchanged,
    // which ADR 015 exists to avoid.
    expect(speakResponse).not.toHaveBeenCalled();
  });

  it("offers nothing to replay before anything has been said", async () => {
    render(<DoctorConsultation outputLanguage="en" />);

    expect(screen.queryByTestId("replay-answer")).not.toBeInTheDocument();
  });
});

describe("the pause before the answer interface", () => {
  it("does not swap the video out on the same frame it ends", async () => {
    // A sign ends on a handshape and the final one carries meaning. Cutting it
    // off makes the change read as a fault rather than as the question
    // finishing.
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "Hello");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    const video = await waitFor(() => {
      const element = document.querySelector("video");
      if (!element) throw new Error("no sign video on screen");
      return element;
    });
    fireEvent.ended(video);

    // Still showing the last frame at this point, not the reply.
    expect(screen.queryByTestId("stage-answers")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("stage-answers")).toBeInTheDocument();
    });
  });
});

describe("a refusal caused by the translation, not by the doctor", () => {
  /**
   * Type "bisa" in Twi and the app refuses "inquire". Both are correct: bisa
   * does mean inquire, and the clip library happens to file that sign under
   * ASK. Without the connection on screen the message is baffling, because it
   * names a word the doctor never typed.
   *
   * The confirmation panel had said this for a while. The refusal is where it
   * matters more, since a refusal is the moment somebody has to work out what
   * to write instead.
   */

  it("says what the typed words were translated to", async () => {
    const response = captionResponse();
    response.transcript = "bisa";
    response.source_language = "tw";
    response.sign_lookup_text = "inquire";
    response.sequence.is_safe_to_show = false;
    response.sequence.unavailable_tokens = ["inquire"];
    captionUtterance.mockResolvedValue(response);

    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "bisa");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(screen.getByTestId("refused-lookup-text")).toBeInTheDocument();
    });

    const explanation = screen.getByTestId("refused-lookup-text");
    expect(explanation).toHaveTextContent("bisa");
    expect(explanation).toHaveTextContent("inquire");
  });

  it("stays quiet when the doctor typed the words that were matched", async () => {
    // English input. Repeating the sentence back unchanged would be noise on
    // the one panel that needs to be read carefully.
    const response = captionResponse();
    response.transcript = "no pain";
    response.sign_lookup_text = "no pain";
    response.sequence.is_safe_to_show = false;
    response.sequence.blocking_tokens = ["no"];
    captionUtterance.mockResolvedValue(response);

    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "no pain");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => screen.getByTestId("utterance-refused"));
    expect(screen.queryByTestId("refused-lookup-text")).not.toBeInTheDocument();
  });
});
