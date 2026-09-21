import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DoctorConsultationHost from "../components/DoctorConsultationHost.jsx";
import { captionUtterance } from "../api/consultation.js";
import { speakResponse } from "../api/speech.js";
import { readTranscript } from "../transcript/transcript.js";

vi.mock("../api/consultation.js", () => ({ captionUtterance: vi.fn() }));
vi.mock("../api/speech.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, speakResponse: vi.fn() };
});

/**
 * The doctor's half of a literate consultation, on its own device. What these
 * pin: the ADR 033 gate stays here and nothing is sent to the patient's phone
 * until it has been cleared; a reply from that phone is spoken and recorded
 * here, where the doctor is listening; and only replies the speech service
 * could accept are passed on to it.
 */

function caption(overrides = {}) {
  return {
    source_language: "en",
    transcript: "Where does it hurt?",
    caption: "Ɛhe na ɛyɛ yaw?",
    caption_language: "tw",
    sign_lookup_text: "Where does it hurt?",
    transcript_source: "typed",
    translation_applied: true,
    language_provider: "khaya",
    caption_problem: "",
    sequence: {
      source_text: "Where does it hurt?",
      segments: [
        {
          token: "hurt",
          match: "gloss",
          clips: [{ gloss: "HURT", video_url: "/media/clips/hurt.webm", duration_ms: 800 }],
        },
      ],
      total_duration_ms: 800,
      fingerspelled_tokens: [],
      unavailable_tokens: [],
      omitted_tokens: [],
      blocking_tokens: [],
      back_translation: ["HURT"],
      is_safe_to_show: true,
      needs_confirmation: false,
    },
    ...overrides,
  };
}

function channel(overrides = {}) {
  return { send: vi.fn(), lastMessage: null, ...overrides };
}

beforeEach(() => {
  localStorage.clear();
  captionUtterance.mockResolvedValue(caption());
  speakResponse.mockResolvedValue({
    spoken_text: "My head hurts",
    output_language: "en",
    translation_applied: true,
    language_provider: "khaya",
    audio_base64: btoa("RIFFWAVE"),
    audio_media_type: "audio/wav",
  });
  vi.stubGlobal(
    "Audio",
    class {
      play() {
        this.onplay?.();
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

async function ask(ch, text = "Where does it hurt?") {
  const user = userEvent.setup();
  render(<DoctorConsultationHost outputLanguage="en" channel={ch} />);
  await user.type(screen.getByLabelText(/message for the patient/i), text);
  await user.click(screen.getByRole("button", { name: /send to patient/i }));
  return user;
}

async function watchQuestion() {
  const video = await waitFor(() => {
    const element = document.querySelector("video");
    if (!element) throw new Error("no sign video on screen");
    return element;
  });
  fireEvent.ended(video);
}

describe("sending the message to the patient's phone", () => {
  it("sends it once it has been shown, marked as the literate path", async () => {
    const ch = channel();

    await ask(ch);

    await waitFor(() =>
      expect(ch.send).toHaveBeenCalledWith({
        type: "question",
        result: expect.objectContaining({ transcript: "Where does it hurt?" }),
        path: "literate",
      }),
    );
  });

  it("sends nothing while the sentence is held behind the gate", async () => {
    captionUtterance.mockResolvedValue(
      caption({ sequence: { ...caption().sequence, needs_confirmation: true } }),
    );
    const ch = channel();

    await ask(ch);
    await screen.findByTestId("utterance-confirm");

    expect(ch.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "question" }));
  });

  it("sends it once the doctor has confirmed", async () => {
    captionUtterance.mockResolvedValue(
      caption({ sequence: { ...caption().sequence, needs_confirmation: true } }),
    );
    const ch = channel();
    const user = await ask(ch);
    await screen.findByTestId("utterance-confirm");

    await user.click(screen.getByTestId("confirm-show"));

    await waitFor(() =>
      expect(ch.send).toHaveBeenCalledWith(expect.objectContaining({ type: "question" })),
    );
  });

  it("never sends a refused sentence", async () => {
    captionUtterance.mockResolvedValue(
      caption({
        sequence: { ...caption().sequence, is_safe_to_show: false, blocking_tokens: ["no"] },
      }),
    );
    const ch = channel();

    await ask(ch);
    await screen.findByTestId("utterance-refused");

    expect(ch.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "question" }));
  });

  it("records what the patient was shown in the doctor's own transcript", async () => {
    await ask(channel());
    await waitFor(() => expect(readTranscript()).toHaveLength(1));

    expect(readTranscript()[0]).toEqual(
      expect.objectContaining({ direction: "to_patient", text: "Where does it hurt?" }),
    );
  });
});

describe("the reply form is on the patient's phone", () => {
  it("is not shown on this screen", () => {
    render(<DoctorConsultationHost outputLanguage="en" channel={channel()} />);

    expect(screen.queryByTestId("speak-to-doctor")).not.toBeInTheDocument();
    expect(screen.getByTestId("replying-on-patient-phone")).toBeInTheDocument();
  });

  it("is still not shown after a question has played", async () => {
    await ask(channel());
    await watchQuestion();
    await screen.findByTestId("replying-on-patient-phone");

    expect(screen.queryByTestId("speak-to-doctor")).not.toBeInTheDocument();
  });
});

describe("a reply arriving from the patient's phone", () => {
  it("is spoken here, in the visit's output language", async () => {
    render(
      <DoctorConsultationHost
        outputLanguage="en"
        channel={channel({
          lastMessage: { type: "reply", text: "My head hurts", sourceLanguage: "tw" },
        })}
      />,
    );

    await waitFor(() =>
      expect(speakResponse).toHaveBeenCalledWith({
        text: "My head hurts",
        sourceLanguage: "tw",
        outputLanguage: "en",
      }),
    );
  });

  it("is recorded in the doctor's transcript with the translation that was spoken", async () => {
    render(
      <DoctorConsultationHost
        outputLanguage="en"
        channel={channel({
          lastMessage: { type: "reply", text: "Me ti yɛ me ya", sourceLanguage: "tw" },
        })}
      />,
    );

    await waitFor(() => expect(readTranscript()).toHaveLength(1));

    expect(readTranscript()[0]).toEqual(
      expect.objectContaining({
        direction: "to_doctor",
        text: "Me ti yɛ me ya",
        language: "tw",
        translation: "My head hurts",
        translationLanguage: "en",
      }),
    );
  });

  it.each([
    ["an empty reply", { type: "reply", text: "   ", sourceLanguage: "en" }],
    ["a reply with no text", { type: "reply", sourceLanguage: "en" }],
    ["text that is not a string", { type: "reply", text: 42, sourceLanguage: "en" }],
    ["a language the service does not speak", { type: "reply", text: "hi", sourceLanguage: "fr" }],
    ["a reply with no language", { type: "reply", text: "hi" }],
    ["a reply longer than the service accepts", { type: "reply", text: "x".repeat(1001), sourceLanguage: "en" }],
  ])("is refused, not passed to the speech service: %s", async (_name, message) => {
    render(
      <DoctorConsultationHost outputLanguage="en" channel={channel({ lastMessage: message })} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(speakResponse).not.toHaveBeenCalled();
  });
});

describe("telling the patient's phone what is happening", () => {
  it("reports when the reply is being spoken", async () => {
    const ch = channel({
      lastMessage: { type: "reply", text: "Yes", sourceLanguage: "en" },
    });

    render(<DoctorConsultationHost outputLanguage="en" channel={ch} />);

    await waitFor(() =>
      expect(ch.send).toHaveBeenCalledWith({ type: "speaking", status: "working" }),
    );
  });

  it("does not report the idle state a fresh screen starts in", () => {
    const ch = channel();

    render(<DoctorConsultationHost outputLanguage="en" channel={ch} />);

    expect(ch.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "speaking" }));
  });

  it("plays the stored answer again on request, without a second translation", async () => {
    let played = 0;
    vi.stubGlobal(
      "Audio",
      class {
        play() {
          played += 1;
          this.onplay?.();
          return Promise.resolve();
        }
      },
    );
    const ch = channel({
      lastMessage: { type: "reply", text: "Yes", sourceLanguage: "en" },
    });
    const { rerender } = render(<DoctorConsultationHost outputLanguage="en" channel={ch} />);
    await waitFor(() => expect(speakResponse).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(played).toBe(1));

    rerender(
      <DoctorConsultationHost
        outputLanguage="en"
        channel={{ ...ch, lastMessage: { type: "replay" } }}
      />,
    );

    // Something actually played a second time, and it cost no second call.
    await waitFor(() => expect(played).toBe(2));
    expect(speakResponse).toHaveBeenCalledTimes(1);
  });

  it("ignores a replay request when nothing has been said yet", async () => {
    render(
      <DoctorConsultationHost
        outputLanguage="en"
        channel={channel({ lastMessage: { type: "replay" } })}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(speakResponse).not.toHaveBeenCalled();
  });
});

describe("showing the patient's reply on the doctor's screen", () => {
  const reply = (overrides = {}) => ({
    type: "reply",
    text: "I have taken the medicine",
    sourceLanguage: "en",
    ...overrides,
  });

  it("says what to expect before any reply has come", () => {
    render(<DoctorConsultationHost outputLanguage="en" channel={channel()} />);

    expect(screen.getByTestId("replying-on-patient-phone")).toHaveTextContent(
      /the patient replies on their own phone/i,
    );
    expect(screen.queryByTestId("patient-reply")).not.toBeInTheDocument();
  });

  it("shows the words of the reply where that line is, as they arrive", async () => {
    render(
      <DoctorConsultationHost outputLanguage="en" channel={channel({ lastMessage: reply() })} />,
    );

    const box = await screen.findByTestId("replying-on-patient-phone");
    expect(await within(box).findByTestId("patient-reply-text")).toHaveTextContent(
      "I have taken the medicine",
    );
  });

  it("says which language it was written in", async () => {
    render(
      <DoctorConsultationHost
        outputLanguage="en"
        channel={channel({ lastMessage: reply({ text: "Me ti yɛ me ya", sourceLanguage: "tw" }) })}
      />,
    );

    expect(await screen.findByTestId("patient-reply")).toHaveTextContent(/twi/i);
  });

  it("shows what was actually spoken when it was translated", async () => {
    render(
      <DoctorConsultationHost
        outputLanguage="en"
        channel={channel({ lastMessage: reply({ text: "Me ti yɛ me ya", sourceLanguage: "tw" }) })}
      />,
    );

    expect(await screen.findByTestId("patient-reply-said")).toHaveTextContent("My head hurts");
  });

  it("does not repeat the words when nothing was translated", async () => {
    speakResponse.mockResolvedValue({
      spoken_text: "I have taken the medicine",
      output_language: "en",
      translation_applied: false,
      language_provider: "khaya",
      audio_base64: btoa("RIFFWAVE"),
      audio_media_type: "audio/wav",
    });
    render(
      <DoctorConsultationHost outputLanguage="en" channel={channel({ lastMessage: reply() })} />,
    );

    await screen.findByTestId("patient-reply-text");
    await waitFor(() => expect(speakResponse).toHaveBeenCalled());
    expect(screen.queryByTestId("patient-reply-said")).not.toBeInTheDocument();
  });

  it("reports, in the doctor's terms, that it is being spoken on this device", async () => {
    render(
      <DoctorConsultationHost outputLanguage="en" channel={channel({ lastMessage: reply() })} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("patient-reply-status")).toHaveTextContent(
        /speaking the patient's answer/i,
      ),
    );
    // Never "your answer": that is what the patient is told, on their phone.
    expect(screen.getByTestId("patient-reply-status")).not.toHaveTextContent(/your answer/i);
  });

  it("says so when it could not be spoken, and leaves the words to read", async () => {
    speakResponse.mockRejectedValue(new Error("service down"));
    render(
      <DoctorConsultationHost outputLanguage="en" channel={channel({ lastMessage: reply() })} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("patient-reply-status")).toHaveTextContent(
        /could not be spoken aloud/i,
      ),
    );
    expect(screen.getByTestId("patient-reply-text")).toHaveTextContent("I have taken the medicine");
  });

  it("still announces the development service's silence beside the reply", async () => {
    // ADR 011: nobody in the room heard anything, and must not assume they did.
    speakResponse.mockResolvedValue({
      spoken_text: "I have taken the medicine",
      output_language: "en",
      translation_applied: false,
      language_provider: "stub",
      audio_base64: btoa("RIFFWAVE"),
      audio_media_type: "audio/wav",
    });
    render(
      <DoctorConsultationHost outputLanguage="en" channel={channel({ lastMessage: reply() })} />,
    );

    expect(await screen.findByTestId("spoken-stub-warning")).toBeInTheDocument();
  });

  it("clears the reply once the next message goes out, since it answered the last one", async () => {
    const ch = channel({ lastMessage: reply() });
    const user = userEvent.setup();
    render(<DoctorConsultationHost outputLanguage="en" channel={ch} />);
    await screen.findByTestId("patient-reply-text");

    await user.type(screen.getByLabelText(/message for the patient/i), "Where does it hurt?");
    await user.click(screen.getByRole("button", { name: /send to patient/i }));
    await watchQuestion();

    await waitFor(() => expect(screen.queryByTestId("patient-reply")).not.toBeInTheDocument());
  });

  it("shows nothing for a reply it refused", async () => {
    render(
      <DoctorConsultationHost
        outputLanguage="en"
        channel={channel({ lastMessage: reply({ sourceLanguage: "fr" }) })}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByTestId("patient-reply")).not.toBeInTheDocument();
  });
});

describe("the patient's phone asking to stop", () => {
  it("stops what is being spoken here, and says so", async () => {
    const ch = channel({ lastMessage: { type: "reply", text: "Yes", sourceLanguage: "en" } });
    const { rerender } = render(<DoctorConsultationHost outputLanguage="en" channel={ch} />);
    await waitFor(() =>
      expect(ch.send).toHaveBeenCalledWith({ type: "speaking", status: "playing" }),
    );

    rerender(<DoctorConsultationHost outputLanguage="en" channel={{ ...ch, lastMessage: { type: "stop" } }} />);

    await waitFor(() =>
      expect(ch.send).toHaveBeenCalledWith({ type: "speaking", status: "stopped" }),
    );
  });

  it("ignores a stop when nothing is being said, so a spoken answer stays spoken", async () => {
    const ch = channel();
    render(
      <DoctorConsultationHost
        outputLanguage="en"
        channel={{ ...ch, lastMessage: { type: "stop" } }}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(ch.send).not.toHaveBeenCalledWith(expect.objectContaining({ status: "stopped" }));
  });
});

describe("when the browser holds back the sound", () => {
  function blockFirstPlay() {
    let attempts = 0;
    let plays = 0;
    vi.stubGlobal(
      "Audio",
      class {
        play() {
          attempts += 1;
          if (attempts === 1) {
            const error = new Error("blocked");
            error.name = "NotAllowedError";
            return Promise.reject(error);
          }
          plays += 1;
          this.onplay?.();
          return Promise.resolve();
        }
      },
    );
    return () => plays;
  }

  const reply = { type: "reply", text: "Yes", sourceLanguage: "en" };

  it("says so and offers to play it, rather than calling it a failure", async () => {
    blockFirstPlay();
    render(<DoctorConsultationHost outputLanguage="en" channel={channel({ lastMessage: reply })} />);

    expect(await screen.findByTestId("play-patient-reply")).toBeInTheDocument();
    expect(screen.getByTestId("patient-reply-status")).toHaveTextContent(/holding back the sound/i);
    expect(screen.getByTestId("patient-reply-status")).not.toHaveTextContent(/could not be spoken/i);
  });

  it("tells the patient's phone, which is then not left waiting on it", async () => {
    blockFirstPlay();
    const ch = channel({ lastMessage: reply });
    render(<DoctorConsultationHost outputLanguage="en" channel={ch} />);

    await waitFor(() =>
      expect(ch.send).toHaveBeenCalledWith({ type: "speaking", status: "blocked" }),
    );
  });

  it("plays it when the doctor touches the button, without asking the service again", async () => {
    const plays = blockFirstPlay();
    const ch = channel({ lastMessage: reply });
    render(<DoctorConsultationHost outputLanguage="en" channel={ch} />);

    await userEvent.click(await screen.findByTestId("play-patient-reply"));

    await waitFor(() => expect(plays()).toBe(1));
    expect(speakResponse).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(ch.send).toHaveBeenCalledWith({ type: "speaking", status: "playing" }),
    );
  });
});
