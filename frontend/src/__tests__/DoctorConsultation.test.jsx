import { render, screen, waitFor, within } from "@testing-library/react";
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
    },
    ...overrides,
  };
}

beforeEach(() => {
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

  it("tells the doctor which words were spelled out rather than signed", async () => {
    // A spelled clinical term may not be understood by the patient, so the
    // doctor needs to know to rephrase.
    const response = captionResponse();
    response.sequence.fingerspelled_tokens = ["hurts"];
    captionUtterance.mockResolvedValue(response);
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "head hurts");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(screen.getByTestId("coverage-notice")).toHaveTextContent("hurts");
    });
  });

  it("tells the doctor which words could not be signed at all", async () => {
    const response = captionResponse();
    response.sequence.unavailable_tokens = ["nausea"];
    captionUtterance.mockResolvedValue(response);
    const user = userEvent.setup();
    render(<DoctorConsultation outputLanguage="en" />);

    await user.type(screen.getByLabelText(/message for the patient/i), "nausea");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(screen.getByTestId("coverage-notice")).toHaveTextContent("nausea");
    });
  });

  it("shows the English text the signs were looked up from", async () => {
    // Signs are keyed on English glosses, so with Twi input the searched text
    // is a translation rather than what the doctor typed. When a sign is
    // missing they need to see which English word was actually searched for.
    const response = captionResponse({ sign_lookup_text: "EN:wo tiri" });
    response.sequence.unavailable_tokens = ["tiri"];
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
