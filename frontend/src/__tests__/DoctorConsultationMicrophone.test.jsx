import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DoctorConsultation from "../components/DoctorConsultation.jsx";
import { captionUtterance } from "../api/consultation.js";
import useAudioRecorder from "../hooks/useAudioRecorder.js";

/**
 * FR 1.2 from the doctor's side: speaking instead of typing.
 *
 * The recorder hook is mocked here, because its own behaviour is covered in
 * useAudioRecorder.test.jsx and this file is about what the screen does with
 * it. Kept separate from DoctorConsultation.test.jsx so those tests keep
 * exercising the real hook, which reports no microphone under jsdom and so
 * covers the typing only fallback.
 */

vi.mock("../api/consultation.js", () => ({ captionUtterance: vi.fn() }));
vi.mock("../hooks/useAudioRecorder.js", () => ({ default: vi.fn() }));

const audio = new Blob(["recorded"], { type: "audio/webm" });

function mockRecorder(overrides = {}) {
  const recorder = {
    isSupported: true,
    support: "ok",
    status: "idle",
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(audio),
    ...overrides,
  };
  useAudioRecorder.mockReturnValue(recorder);
  return recorder;
}

beforeEach(() => {
  captionUtterance.mockResolvedValue({
    source_language: "en",
    transcript: "where does it hurt",
    caption: "Ɛhe na ɛyɛ yaw",
    caption_language: "tw",
    sign_lookup_text: "where does it hurt",
    transcript_source: "spoken",
    translation_applied: true,
    language_provider: "khaya",
    sequence: {
      source_text: "where does it hurt",
      segments: [],
      total_duration_ms: 0,
      fingerspelled_tokens: [],
      unavailable_tokens: [],
      omitted_tokens: [],
      blocking_tokens: [],
      back_translation: [],
      is_safe_to_show: true,
      needs_confirmation: false,
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("speaking to the patient", () => {
  it("offers a microphone when the browser can record", () => {
    mockRecorder();
    render(<DoctorConsultation />);

    expect(screen.getByTestId("microphone-button")).toBeInTheDocument();
  });

  it("starts recording when the microphone is tapped", async () => {
    const recorder = mockRecorder();
    const user = userEvent.setup();
    render(<DoctorConsultation />);

    await user.click(screen.getByTestId("microphone-button"));

    expect(recorder.start).toHaveBeenCalledOnce();
  });

  it("shows that the microphone is live while recording", async () => {
    // SRS 4.2. Nothing else on screen would tell the doctor the microphone is
    // open, and a Deaf patient cannot hear a recording tone either.
    mockRecorder({ status: "recording" });
    render(<DoctorConsultation />);

    expect(screen.getByTestId("recording-indicator")).toBeInTheDocument();
  });

  it("sends the recording in the selected language when stopped", async () => {
    const recorder = mockRecorder({ status: "recording" });
    const user = userEvent.setup();
    render(<DoctorConsultation />);

    await user.click(
      within(screen.getByTestId("doctor-language")).getByRole("radio", {
        name: /twi/i,
      }),
    );
    await user.click(screen.getByTestId("microphone-button"));

    await waitFor(() => {
      expect(recorder.stop).toHaveBeenCalledOnce();
      expect(captionUtterance).toHaveBeenCalledWith({
        sourceLanguage: "tw",
        audio,
      });
    });
  });

  it("captions the spoken message the same way as a typed one", async () => {
    mockRecorder({ status: "recording" });
    const user = userEvent.setup();
    render(<DoctorConsultation />);

    await user.click(screen.getByTestId("microphone-button"));

    await waitFor(() => {
      expect(screen.getByTestId("caption")).toHaveTextContent("Ɛhe na ɛyɛ yaw");
    });
  });

  it("sends nothing when the recording came back empty", async () => {
    // Tapping stop immediately produces no audio. Sending it would spend a
    // metered transcription call to get nothing back.
    mockRecorder({ status: "recording", stop: vi.fn().mockResolvedValue(null) });
    const user = userEvent.setup();
    render(<DoctorConsultation />);

    await user.click(screen.getByTestId("microphone-button"));

    await waitFor(() => {
      expect(captionUtterance).not.toHaveBeenCalled();
    });
  });

  it("explains that typing is the way when the browser cannot record", () => {
    // NFR 6 targets browsers that differ in support, so the screen degrades
    // to typing rather than offering a button that cannot work.
    mockRecorder({ isSupported: false, support: "unsupported" });
    render(<DoctorConsultation />);

    expect(screen.queryByTestId("microphone-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("microphone-unsupported")).toBeInTheDocument();
  });

  it("blames the connection when the origin is not secure", () => {
    // Telling someone their browser cannot record, when actually the app is
    // being served over http, sends them debugging the wrong thing.
    mockRecorder({ isSupported: false, support: "insecure" });
    render(<DoctorConsultation />);

    expect(screen.getByTestId("microphone-insecure")).toBeInTheDocument();
    expect(screen.queryByTestId("microphone-unsupported")).not.toBeInTheDocument();
  });

  it("explains a refused microphone rather than failing silently", () => {
    mockRecorder({ status: "denied" });
    render(<DoctorConsultation />);

    expect(screen.getByTestId("microphone-denied")).toBeInTheDocument();
  });

  it("explains a recorder that could not start", () => {
    mockRecorder({ status: "failed" });
    render(<DoctorConsultation />);

    expect(screen.getByTestId("microphone-failed")).toBeInTheDocument();
  });

  it("will not let a typed message be sent mid recording", async () => {
    // Both inputs describe the same utterance, and the backend rejects a
    // request carrying both, so the form blocks it before that happens.
    mockRecorder({ status: "recording" });
    render(<DoctorConsultation />);

    expect(screen.getByRole("button", { name: /send to patient/i })).toBeDisabled();
  });
});
