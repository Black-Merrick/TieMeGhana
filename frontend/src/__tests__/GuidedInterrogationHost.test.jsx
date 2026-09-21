import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GuidedInterrogationHost from "../components/GuidedInterrogationHost.jsx";
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
 * The doctor's half of Guided Interrogation, on its own device.
 *
 * Section 4 in the approved plan for two-device mode is what these tests
 * pin: a Yes/No question is answered here, on the doctor's own device, per
 * FR 2.7, and only a body-location answer travels from the patient's device.
 * If that routing were ever reversed, this is where it would be caught.
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
    caption_problem: "",
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
      back_translation: ["VOMIT"],
      is_safe_to_show: true,
      needs_confirmation: false,
    },
    ...overrides,
  };
}

function fakeChannel(overrides = {}) {
  return { send: vi.fn(), lastMessage: null, ...overrides };
}

beforeEach(() => {
  localStorage.clear();
  captionUtterance.mockResolvedValue(caption());
  fetchBodyLocations.mockResolvedValue([]);
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

async function watchQuestion() {
  const video = await waitFor(() => {
    const element = document.querySelector("video");
    if (!element) throw new Error("no sign video on screen");
    return element;
  });
  fireEvent.ended(video);
  await waitFor(() =>
    expect(screen.getByTestId("stage-answers")).toBeInTheDocument(),
  );
}

async function askFreely(channel, text = "Did you vomit?") {
  const user = userEvent.setup();
  render(
    <GuidedInterrogationHost outputLanguage="en" channel={channel} />,
  );
  await user.type(screen.getByLabelText(/message for the patient/i), text);
  await user.click(screen.getByRole("button", { name: /ask the patient/i }));
  await watchQuestion();
  return user;
}

describe("broadcasting a question", () => {
  it("sends the result to the patient's device once it has been shown", async () => {
    const channel = fakeChannel();

    await askFreely(channel);

    expect(channel.send).toHaveBeenCalledWith({
      type: "question",
      result: expect.objectContaining({ transcript: "Did you vomit?" }),
      awaitingLocation: false,
      // Repeated on every question so the patient's phone can never be left
      // waiting for a `path` message that collapsed into this one.
      path: "guided",
    });
  });

  it("sends nothing before the gate has let the sentence through", async () => {
    // A sentence needing confirmation has not been shown, so there is
    // nothing yet for a second device to receive.
    captionUtterance.mockResolvedValue(
      caption({ sequence: { ...caption().sequence, needs_confirmation: true } }),
    );
    const channel = fakeChannel();
    const user = userEvent.setup();
    render(<GuidedInterrogationHost outputLanguage="en" channel={channel} />);
    await user.type(screen.getByLabelText(/message for the patient/i), "hi");
    await user.click(screen.getByRole("button", { name: /ask the patient/i }));

    await screen.findByTestId("utterance-confirm");

    expect(channel.send).not.toHaveBeenCalled();
  });

  it("marks a where-does-it-hurt question as awaiting a location", async () => {
    const channel = fakeChannel();
    const user = userEvent.setup();
    render(<GuidedInterrogationHost outputLanguage="en" channel={channel} />);

    await user.click(
      screen.getByRole("button", { name: /ask where it hurts/i }),
    );
    await watchQuestion();

    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({ awaitingLocation: true }),
    );
  });
});

describe("FR 2.7, a Yes/No question is answered here, not on the patient's device", () => {
  it("shows Yes/No buttons on the doctor's own screen", async () => {
    const channel = fakeChannel();

    await askFreely(channel);

    expect(screen.getByTestId("choice-yes")).toBeInTheDocument();
    expect(screen.getByTestId("choice-no")).toBeInTheDocument();
    expect(
      screen.queryByTestId("waiting-on-patient-device"),
    ).not.toBeInTheDocument();
  });

  it("speaks and records a local Yes/No tap exactly as the single device path does", async () => {
    const channel = fakeChannel();
    const user = await askFreely(channel);

    await user.click(screen.getByTestId("choice-yes"));

    await waitFor(() =>
      expect(speakResponse).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Yes" }),
      ),
    );
    expect(screen.getByText(/^Yes$/)).toBeInTheDocument();
  });
});

describe("a where-does-it-hurt question is answered on the patient's device", () => {
  it("shows a waiting notice instead of the location grid", async () => {
    const channel = fakeChannel();
    const user = userEvent.setup();
    render(<GuidedInterrogationHost outputLanguage="en" channel={channel} />);

    await user.click(
      screen.getByRole("button", { name: /ask where it hurts/i }),
    );
    await watchQuestion();

    expect(screen.getByTestId("waiting-on-patient-device")).toBeInTheDocument();
    expect(screen.queryByTestId("choice-yes")).not.toBeInTheDocument();
  });

  it("speaks and records an answer that arrives from the patient's device", async () => {
    const channel = fakeChannel();
    const user = userEvent.setup();
    const { rerender } = render(
      <GuidedInterrogationHost outputLanguage="en" channel={channel} />,
    );
    await user.click(
      screen.getByRole("button", { name: /ask where it hurts/i }),
    );
    await watchQuestion();

    rerender(
      <GuidedInterrogationHost
        outputLanguage="en"
        channel={fakeChannel({
          send: channel.send,
          lastMessage: { type: "answer", value: "Head", answeredBy: "patient" },
        })}
      />,
    );

    await waitFor(() =>
      expect(speakResponse).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Head" }),
      ),
    );
  });
});

describe("telling the patient's phone how its answer is going", () => {
  beforeEach(() => {
    // One that reports it has started, as a real element does, so the
    // "playing" the phone is told about is reached.
    vi.stubGlobal(
      "Audio",
      class {
        play() {
          this.onplay?.();
          return Promise.resolve();
        }
      },
    );
  });

  it("reports that it is being spoken when a tapped location arrives", async () => {
    const channel = fakeChannel({
      lastMessage: { type: "answer", value: "Head", answeredBy: "patient" },
    });

    render(<GuidedInterrogationHost outputLanguage="en" channel={channel} />);

    await waitFor(() =>
      expect(channel.send).toHaveBeenCalledWith({ type: "speaking", status: "working" }),
    );
    await waitFor(() =>
      expect(channel.send).toHaveBeenCalledWith({ type: "speaking", status: "playing" }),
    );
  });

  it("does not report the idle state a fresh screen starts in", () => {
    const channel = fakeChannel();

    render(<GuidedInterrogationHost outputLanguage="en" channel={channel} />);

    expect(channel.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "speaking" }));
  });

  it("stops what is being spoken when the phone asks", async () => {
    const channel = fakeChannel({
      lastMessage: { type: "answer", value: "Head", answeredBy: "patient" },
    });
    const { rerender } = render(<GuidedInterrogationHost outputLanguage="en" channel={channel} />);
    await waitFor(() =>
      expect(channel.send).toHaveBeenCalledWith({ type: "speaking", status: "playing" }),
    );

    rerender(
      <GuidedInterrogationHost
        outputLanguage="en"
        channel={fakeChannel({ send: channel.send, lastMessage: { type: "stop" } })}
      />,
    );

    await waitFor(() =>
      expect(channel.send).toHaveBeenCalledWith({ type: "speaking", status: "stopped" }),
    );
  });
});
