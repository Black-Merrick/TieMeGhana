import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DoctorConsultation from "../components/DoctorConsultation.jsx";
import { captionUtterance } from "../api/consultation.js";

vi.mock("../api/consultation.js", () => ({ captionUtterance: vi.fn() }));

function captionResponse(overrides = {}) {
  return {
    source_language: "en",
    transcript: "head hurts",
    caption: "head hurts",
    caption_language: "tw",
    sign_lookup_text: "head hurts",
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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("DoctorConsultation", () => {
  it("shows the input language choice before anything is said", () => {
    // FR 1.1 requires the doctor to pick the language first, and SRS 4.1
    // requires it to be visible rather than buried in a settings menu.
    render(<DoctorConsultation />);

    expect(screen.getByRole("radio", { name: /english/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /twi/i })).toBeInTheDocument();
  });

  it("sends the typed message in the selected language", async () => {
    const user = userEvent.setup();
    render(<DoctorConsultation />);

    await user.click(screen.getByRole("radio", { name: /twi/i }));
    await user.type(screen.getByLabelText(/message/i), "wo tiri");
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
    render(<DoctorConsultation />);

    await user.type(screen.getByLabelText(/message/i), "head hurts");
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
    render(<DoctorConsultation />);

    await user.type(screen.getByLabelText(/message/i), "head hurts");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(screen.getByTestId("provider-warning")).toBeInTheDocument();
    });
  });

  it("shows no provider warning when real translation was used", async () => {
    const user = userEvent.setup();
    render(<DoctorConsultation />);

    await user.type(screen.getByLabelText(/message/i), "head hurts");
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
    render(<DoctorConsultation />);

    await user.type(screen.getByLabelText(/message/i), "head hurts");
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
    render(<DoctorConsultation />);

    await user.type(screen.getByLabelText(/message/i), "nausea");
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
    render(<DoctorConsultation />);

    await user.type(screen.getByLabelText(/message/i), "wo tiri");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(screen.getByTestId("lookup-text")).toHaveTextContent("EN:wo tiri");
    });
  });

  it("reports a failure instead of leaving the doctor waiting", async () => {
    captionUtterance.mockRejectedValue(new Error("service unavailable"));
    const user = userEvent.setup();
    render(<DoctorConsultation />);

    await user.type(screen.getByLabelText(/message/i), "head hurts");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    await waitFor(() => {
      expect(screen.getByTestId("caption-error")).toBeInTheDocument();
    });
  });

  it("will not send an empty message", async () => {
    const user = userEvent.setup();
    render(<DoctorConsultation />);

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
    render(<DoctorConsultation />);

    await user.type(screen.getByLabelText(/message/i), "head hurts");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));

    expect(screen.getByTestId("working-indicator")).toBeInTheDocument();

    resolve(captionResponse());
    await waitFor(() => {
      expect(screen.queryByTestId("working-indicator")).not.toBeInTheDocument();
    });
  });
});
