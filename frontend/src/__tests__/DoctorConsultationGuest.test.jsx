import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DoctorConsultationGuest from "../components/DoctorConsultationGuest.jsx";
import { readTranscript } from "../transcript/transcript.js";

/**
 * The literate patient's own phone. Nothing here is gated, because
 * everything that reaches it already cleared the doctor's device; what these
 * pin is that replies are sent rather than spoken here, that the patient keeps
 * their own record, and that it never shows a staff facing panel.
 */

function caption(overrides = {}) {
  return {
    source_language: "en",
    transcript: "Where does it hurt?",
    caption: "Ɛhe na ɛyɛ yaw?",
    caption_language: "tw",
    caption_problem: "",
    language_provider: "khaya",
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
  return { send: vi.fn(), lastMessage: null, state: "connected", ...overrides };
}

const question = (result = caption()) => ({ type: "question", result, path: "literate" });

beforeEach(() => localStorage.clear());
afterEach(() => {
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
  await waitFor(() => expect(screen.getByTestId("stage-answers")).toBeInTheDocument());
}

describe("before any question has arrived", () => {
  it("offers a reply straight away, since FR 3.1 lets a patient speak first", () => {
    render(<DoctorConsultationGuest channel={channel()} />);

    expect(screen.getByTestId("stage-idle")).toBeInTheDocument();
    expect(screen.getByTestId("speak-to-doctor")).toBeInTheDocument();
  });
});

describe("receiving a question", () => {
  it("shows the caption, and keeps the patient's own record of it", async () => {
    render(<DoctorConsultationGuest channel={channel({ lastMessage: question() })} />);

    expect(await screen.findByTestId("caption")).toHaveTextContent("Ɛhe na ɛyɛ yaw?");
    expect(readTranscript()).toEqual([
      expect.objectContaining({
        direction: "to_patient",
        text: "Where does it hurt?",
        language: "en",
        translation: "Ɛhe na ɛyɛ yaw?",
        translationLanguage: "tw",
      }),
    ]);
  });

  it("shows a caption problem, the same as the doctor's screen does", async () => {
    render(
      <DoctorConsultationGuest
        channel={channel({ lastMessage: question(caption({ caption_problem: "quota" })) })}
      />,
    );

    expect(await screen.findByTestId("caption-problem")).toBeInTheDocument();
  });

  it("never shows a staff facing gate panel", async () => {
    // The gate runs on the doctor's device. If a refused sentence somehow
    // reached this phone it still must not render the doctor's panels.
    render(<DoctorConsultationGuest channel={channel({ lastMessage: question() })} />);
    await screen.findByTestId("caption");

    expect(screen.queryByTestId("utterance-refused")).not.toBeInTheDocument();
    expect(screen.queryByTestId("utterance-confirm")).not.toBeInTheDocument();
  });

  it("offers the reply once the question has been watched", async () => {
    render(<DoctorConsultationGuest channel={channel({ lastMessage: question() })} />);
    await watchQuestion();

    expect(screen.getByTestId("speak-to-doctor")).toBeInTheDocument();
  });
});

describe("replying to the doctor", () => {
  it("sends a typed reply with its language, instead of speaking it here", async () => {
    const ch = channel();
    const user = userEvent.setup();
    render(<DoctorConsultationGuest channel={ch} />);

    await user.type(screen.getByLabelText(/type your answer/i), "My head hurts");
    await user.click(screen.getByTestId("speak-to-doctor"));

    expect(ch.send).toHaveBeenCalledWith({
      type: "reply",
      text: "My head hurts",
      sourceLanguage: "tw",
    });
  });

  it("sends a tapped quick reply as English", async () => {
    const ch = channel();
    render(<DoctorConsultationGuest channel={ch} />);

    await userEvent.click(screen.getByTestId("quick-reply-yes"));

    expect(ch.send).toHaveBeenCalledWith({
      type: "reply",
      text: "Yes",
      sourceLanguage: "en",
    });
  });

  it("keeps its own record of what the patient said, at once", async () => {
    const ch = channel();
    render(<DoctorConsultationGuest channel={ch} />);

    await userEvent.click(screen.getByTestId("quick-reply-no"));

    expect(readTranscript()).toEqual([
      expect.objectContaining({ direction: "to_doctor", text: "No", language: "en" }),
    ]);
  });

  it("does not take a second tap while the first is being spoken", async () => {
    const ch = channel();
    render(<DoctorConsultationGuest channel={ch} />);

    await userEvent.click(screen.getByTestId("quick-reply-yes"));

    expect(screen.getByTestId("quick-reply-yes")).toBeDisabled();
  });
});

describe("hearing back from the doctor's device", () => {
  // Reports are about an answer this phone gave, so each of these gives one.
  async function replied(status) {
    const ch = channel();
    const view = render(<DoctorConsultationGuest channel={ch} />);
    await userEvent.click(screen.getByTestId("quick-reply-yes"));
    view.rerender(
      <DoctorConsultationGuest channel={channel({ send: ch.send, lastMessage: { type: "speaking", status } })} />,
    );
    return { ch, ...view };
  }

  it("shows that it is speaking", async () => {
    await replied("playing");

    expect(screen.getByTestId("quick-reply-yes")).toBeDisabled();
  });

  it("frees the buttons again once the answer has been spoken, after the face has been seen", async () => {
    await replied("spoken");

    await waitFor(() => expect(screen.getByTestId("quick-reply-yes")).toBeEnabled(), {
      timeout: 4000,
    });
  });

  it("offers to say it again only once something has been spoken", () => {
    render(<DoctorConsultationGuest channel={channel()} />);

    expect(screen.queryByTestId("replay-answer")).not.toBeInTheDocument();
  });

  it("asks the doctor's device to replay, without a second reply", async () => {
    const { ch } = await replied("spoken");
    ch.send.mockClear();

    await userEvent.click(screen.getByTestId("replay-answer"));

    expect(ch.send).toHaveBeenCalledWith({ type: "replay" });
    expect(ch.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "reply" }));
  });

  it("follows a replay too: the face is shown again while it is said again", async () => {
    const { ch, rerender } = await replied("spoken");
    await userEvent.click(screen.getByTestId("replay-answer"));

    rerender(
      <DoctorConsultationGuest
        channel={channel({ send: ch.send, lastMessage: { type: "speaking", status: "playing" } })}
      />,
    );

    expect(screen.getByTestId("speaking-overlay")).toBeInTheDocument();
  });

  it("believes no report about something this phone did not say", () => {
    // The doctor's device speaks other things too. Showing "your answer is
    // being spoken" for one the patient never gave would be untrue.
    render(
      <DoctorConsultationGuest
        channel={channel({ lastMessage: { type: "speaking", status: "playing" } })}
      />,
    );

    expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sent-reply")).not.toBeInTheDocument();
    expect(screen.getByTestId("quick-reply-yes")).toBeEnabled();
  });
});

describe("the talking face on the patient's phone", () => {
  async function replied(status) {
    const ch = channel();
    const view = render(<DoctorConsultationGuest channel={ch} />);
    await userEvent.type(screen.getByLabelText(/type your answer/i), "My head hurts");
    await userEvent.click(screen.getByTestId("speak-to-doctor"));
    if (status) {
      view.rerender(
        <DoctorConsultationGuest channel={channel({ send: ch.send, lastMessage: { type: "speaking", status } })} />,
      );
    }
    return { ch, ...view };
  }

  it("appears the moment the reply is sent, with the patient's own words", async () => {
    await replied();

    const overlay = screen.getByTestId("speaking-overlay");
    expect(overlay).toHaveTextContent(/preparing your answer/i);
    expect(overlay).toHaveTextContent("My head hurts");
  });

  it("stays while the doctor's device speaks it", async () => {
    await replied("playing");

    expect(screen.getByTestId("speaking-overlay")).toHaveTextContent(/speaking to the doctor/i);
  });

  it("stays up long enough to be seen when it is spoken almost at once", async () => {
    // The development service's audio is a fraction of a second, and a face
    // that is gone before it can be read is a flicker, not feedback.
    await replied("spoken");

    expect(screen.getByTestId("speaking-overlay")).toBeInTheDocument();
  });

  it("then goes away, leaving the tick", async () => {
    await replied("spoken");

    await waitFor(() => expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument(), {
      timeout: 4000,
    });
    expect(screen.getByTestId("sent-reply-spoken")).toBeInTheDocument();
  });

  it("is not held for a failure, which has something to say at once", async () => {
    await replied("failed");

    expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument();
  });

  it("is not held for a stop", async () => {
    await replied("playing");
    await userEvent.click(screen.getByRole("button", { name: /stop/i }));

    expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument();
  });

  it("gives way at once when the doctor's device is waiting for a touch", async () => {
    await replied("blocked");

    expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("sent-reply-blocked")).toHaveTextContent(/show this screen to the doctor/i);
  });

  it("still believes it when the doctor then touches the device and it is spoken", async () => {
    const { ch, rerender } = await replied("blocked");

    rerender(
      <DoctorConsultationGuest
        channel={channel({ send: ch.send, lastMessage: { type: "speaking", status: "playing" } })}
      />,
    );

    expect(screen.getByTestId("speaking-overlay")).toBeInTheDocument();
  });

  it("goes away when it fails, leaving the message to show the doctor", async () => {
    await replied("failed");

    expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("sent-reply-failed")).toBeInTheDocument();
  });

  it("can always be stopped, and asks the doctor's device to stop too", async () => {
    // It covers the screen, so it must never trap a patient behind a device
    // that has stopped reporting.
    const { ch } = await replied("playing");

    await userEvent.click(screen.getByRole("button", { name: /stop/i }));

    expect(ch.send).toHaveBeenCalledWith({ type: "stop" });
    expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("sent-reply-stopped")).toBeInTheDocument();
  });

  it("can be stopped even when the doctor's device never answers", async () => {
    await replied();

    await userEvent.click(screen.getByRole("button", { name: /stop/i }));

    expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("quick-reply-yes")).toBeEnabled();
  });

  it("is not shown before anything has been said", () => {
    render(<DoctorConsultationGuest channel={channel()} />);

    expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument();
  });
});

describe("the consultation ending", () => {
  it("leaves the patient's own record where they can read and delete it", async () => {
    // Nothing clears this phone for them the way a new patient does on the
    // shared device, so an ended screen that hid the record would leave a
    // consultation on the phone that its owner could not get at.
    const ch = channel();
    const { rerender } = render(<DoctorConsultationGuest channel={ch} />);
    await userEvent.click(screen.getByTestId("quick-reply-yes"));

    rerender(<DoctorConsultationGuest channel={channel({ lastMessage: { type: "ended" } })} />);

    expect(screen.getByTestId("pairing-ended")).toBeInTheDocument();
    expect(screen.getByTestId("transcript")).toBeInTheDocument();
    expect(screen.getByTestId("transcript-privacy")).toHaveTextContent(
      /until you delete it/i,
    );

    await userEvent.click(screen.getByTestId("delete-transcript"));
    await userEvent.click(screen.getByTestId("confirm-delete-yes"));

    expect(readTranscript()).toEqual([]);
  });

  it("says so when the doctor ends it", () => {
    render(<DoctorConsultationGuest channel={channel({ lastMessage: { type: "ended" } })} />);

    expect(screen.getByTestId("pairing-ended")).toBeInTheDocument();
  });

  it("is told it is over by the screen that owns the connection", () => {
    // Whether the connection is up is not this screen's to judge: it may be
    // waiting to rejoin after a reload, which is not the end.
    render(<DoctorConsultationGuest channel={channel()} forceEnded />);

    expect(screen.getByTestId("pairing-ended")).toBeInTheDocument();
  });

  it("does not call a dropped connection the end", () => {
    const { rerender } = render(<DoctorConsultationGuest channel={channel()} />);

    rerender(<DoctorConsultationGuest channel={channel({ state: "closed" })} offline />);

    expect(screen.queryByTestId("pairing-ended")).not.toBeInTheDocument();
    expect(screen.getByTestId("stage-idle")).toBeInTheDocument();
  });

  it("offers the way to the next consultation once it is over", async () => {
    const onLeave = vi.fn();
    render(<DoctorConsultationGuest channel={channel()} forceEnded onLeave={onLeave} />);

    await userEvent.click(screen.getByTestId("join-another"));

    expect(onLeave).toHaveBeenCalled();
  });

});

describe("feedback on the patient's own phone", () => {
  let vibrate;

  beforeEach(() => {
    vibrate = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
  });

  afterEach(() => {
    delete navigator.vibrate;
  });

  // The tap's own pulse. Saving the record vibrates too (a softer, shorter
  // one), which is the app's existing behaviour and not what is counted here.
  const taps = () => vibrate.mock.calls.filter(([pattern]) => pattern[0] === 40 && pattern.length === 1);

  const withStatus = (status) => channel({ lastMessage: { type: "speaking", status } });

  it("shows nothing about a reply before one has been given", () => {
    render(<DoctorConsultationGuest channel={channel()} />);

    expect(screen.queryByTestId("sent-reply")).not.toBeInTheDocument();
  });

  it("answers a tapped reply at once, with what was sent", async () => {
    render(<DoctorConsultationGuest channel={channel()} />);

    await userEvent.click(screen.getByTestId("quick-reply-yes"));

    expect(screen.getByTestId("sent-reply-working")).toHaveTextContent(/sending your answer/i);
    expect(screen.getByTestId("sent-reply-text")).toHaveTextContent("Yes");
  });

  it("does the same for a typed reply, in the patient's own words", async () => {
    render(<DoctorConsultationGuest channel={channel()} />);

    await userEvent.type(screen.getByLabelText(/type your answer/i), "Me ti yɛ me ya");
    await userEvent.click(screen.getByTestId("speak-to-doctor"));

    expect(screen.getByTestId("sent-reply-text")).toHaveTextContent("Me ti yɛ me ya");
  });

  it("vibrates once for a tapped reply", async () => {
    render(<DoctorConsultationGuest channel={channel()} />);

    await userEvent.click(screen.getByTestId("quick-reply-yes"));

    expect(taps()).toHaveLength(1);
  });

  it("vibrates once for a typed reply", async () => {
    render(<DoctorConsultationGuest channel={channel()} />);

    await userEvent.type(screen.getByLabelText(/type your answer/i), "Yes please");
    await userEvent.click(screen.getByTestId("speak-to-doctor"));

    expect(taps()).toHaveLength(1);
  });

  it("does not vibrate for an empty reply that was refused", async () => {
    render(<DoctorConsultationGuest channel={channel()} />);

    await userEvent.click(screen.getByTestId("speak-to-doctor"));

    expect(vibrate).not.toHaveBeenCalled();
  });

  describe("as the doctor's device reports on it", () => {
    async function sentThen(status) {
      const ch = channel();
      const { rerender } = render(<DoctorConsultationGuest channel={ch} />);
      await userEvent.click(screen.getByTestId("quick-reply-yes"));
      vibrate.mockClear();
      rerender(<DoctorConsultationGuest channel={withStatus(status)} />);
    }

    it("shows the wave and two short pulses when it starts being spoken", async () => {
      await sentThen("playing");

      expect(screen.getByTestId("sent-reply-playing")).toHaveTextContent(/speaking your answer/i);
      expect(vibrate).toHaveBeenCalledWith([40, 70, 40]);
    });

    it("shows the tick and one long pulse when it has been spoken", async () => {
      await sentThen("spoken");

      expect(screen.getByTestId("sent-reply-spoken")).toHaveTextContent(/spoken to the doctor/i);
      expect(vibrate).toHaveBeenCalledWith([220]);
    });

    it("keeps showing what was said alongside each stage", async () => {
      await sentThen("spoken");

      expect(screen.getByTestId("sent-reply-text")).toHaveTextContent("Yes");
    });

    it("says so on screen when it could not be spoken, without inventing a pulse for it", async () => {
      await sentThen("failed");

      expect(screen.getByTestId("sent-reply-failed")).toHaveTextContent(/show this screen to the doctor/i);
      expect(vibrate).not.toHaveBeenCalled();
    });

    it("says so when the doctor stopped it, and offers to say it again", async () => {
      await sentThen("stopped");

      expect(screen.getByTestId("sent-reply-stopped")).toBeInTheDocument();
      expect(screen.getByTestId("replay-answer")).toBeInTheDocument();
    });

    it("does not vibrate twice for the same report", async () => {
      const ch = channel();
      const { rerender } = render(<DoctorConsultationGuest channel={ch} />);
      await userEvent.click(screen.getByTestId("quick-reply-yes"));
      vibrate.mockClear();

      rerender(<DoctorConsultationGuest channel={withStatus("playing")} />);
      rerender(<DoctorConsultationGuest channel={{ ...withStatus("playing") }} />);

      expect(vibrate).toHaveBeenCalledTimes(1);
    });
  });

  it("clears the last answer's confirmation when the doctor sends the next message", async () => {
    const ch = channel();
    const { rerender } = render(<DoctorConsultationGuest channel={ch} />);
    await userEvent.click(screen.getByTestId("quick-reply-yes"));
    rerender(<DoctorConsultationGuest channel={withStatus("spoken")} />);
    expect(screen.getByTestId("sent-reply-spoken")).toBeInTheDocument();

    rerender(<DoctorConsultationGuest channel={channel({ lastMessage: question() })} />);

    await screen.findByTestId("caption");
    expect(screen.queryByTestId("sent-reply")).not.toBeInTheDocument();
  });
});

describe("while the phone is finding the doctor's device again", () => {
  it("keeps the screen and the patient's place, but holds the controls still", async () => {
    render(<DoctorConsultationGuest channel={channel({ lastMessage: question() })} offline />);

    await screen.findByTestId("caption");
    expect(document.querySelector(".offline-lock")).toHaveAttribute("inert");
  });

  it("locks nothing when it is connected", async () => {
    render(<DoctorConsultationGuest channel={channel({ lastMessage: question() })} />);

    await screen.findByTestId("caption");
    expect(document.querySelector(".offline-lock")).not.toHaveAttribute("inert");
  });

  it("still shows the patient's own record", async () => {
    const ch = channel();
    const { rerender } = render(<DoctorConsultationGuest channel={ch} />);
    await userEvent.click(screen.getByTestId("quick-reply-yes"));

    rerender(<DoctorConsultationGuest channel={channel({ state: "closed" })} offline />);

    expect(screen.getByTestId("transcript")).toBeInTheDocument();
  });
});

describe("a question sent again after a reconnect", () => {
  it("is shown, but not recorded a second time", async () => {
    render(
      <DoctorConsultationGuest
        channel={channel({ lastMessage: { ...question(), resent: true } })}
      />,
    );

    expect(await screen.findByTestId("caption")).toHaveTextContent("Ɛhe na ɛyɛ yaw?");
    expect(readTranscript()).toEqual([]);
  });
});
