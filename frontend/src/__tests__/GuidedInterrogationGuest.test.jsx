import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GuidedInterrogationGuest from "../components/GuidedInterrogationGuest.jsx";
import { fetchBodyLocations } from "../api/clips.js";
import { readTranscript } from "../transcript/transcript.js";

vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchBodyLocations: vi.fn() };
});

/**
 * The patient's half of Guided Interrogation, on their own device.
 *
 * No useCaption, no gate of its own: everything here arrives already safe
 * to show, per GuidedInterrogationHost's own tests. What these tests pin is
 * that the patient answers here by a tap, Yes or No and where it hurts, that a
 * question the doctor has already answered stops being offered, and that this
 * screen keeps its own independent transcript rather than depending on the
 * doctor's device for its FR 4.2 copy.
 */

function caption(overrides = {}) {
  return {
    source_language: "en",
    transcript: "Did you vomit?",
    caption: "Wo foee?",
    caption_language: "tw",
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

function bodyLocation(gloss, label) {
  return {
    id: gloss,
    english_text: label,
    is_playable: true,
    clip: { gloss, video_url: `/media/clips/${gloss.toLowerCase()}.webm`, duration_ms: 800 },
  };
}

function fakeChannel(overrides = {}) {
  return { send: vi.fn(), lastMessage: null, state: "connected", ...overrides };
}

beforeEach(() => {
  localStorage.clear();
  fetchBodyLocations.mockResolvedValue([
    bodyLocation("HEAD", "Head"),
    bodyLocation("STOMACH", "Stomach"),
  ]);
});

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
  await waitFor(() =>
    expect(screen.getByTestId("stage-answers")).toBeInTheDocument(),
  );
}

describe("before any question has arrived", () => {
  it("shows a waiting stage rather than a blank screen", async () => {
    render(<GuidedInterrogationGuest channel={fakeChannel()} />);

    expect(screen.getByTestId("stage-idle")).toBeInTheDocument();
    // Settled within the test rather than left to resolve after it, so a
    // fetch this screen makes on mount cannot warn about a state update
    // landing outside act() once the test has already moved on.
    await waitFor(() => expect(fetchBodyLocations).toHaveBeenCalled());
  });
});

describe("receiving a question", () => {
  it("renders it, and keeps its own independent transcript copy", async () => {
    const channel = fakeChannel({
      lastMessage: { type: "question", result: caption(), awaitingLocation: false },
    });

    render(<GuidedInterrogationGuest channel={channel} />);

    expect(await screen.findByTestId("caption")).toHaveTextContent("Wo foee?");
    expect(readTranscript()).toEqual([
      expect.objectContaining({
        direction: "to_patient",
        text: "Did you vomit?",
        caption: "Wo foee?",
      }),
    ]);
  });

  it("shows a caption problem badge, same as the doctor's own screen", async () => {
    const channel = fakeChannel({
      lastMessage: {
        type: "question",
        result: caption({ caption_problem: "quota" }),
        awaitingLocation: false,
      },
    });

    render(<GuidedInterrogationGuest channel={channel} />);

    expect(await screen.findByTestId("caption-problem")).toBeInTheDocument();
  });
});

describe("a Yes/No question, answered here", () => {
  const yesNoQuestion = (overrides = {}) => ({
    type: "question",
    result: caption(),
    awaitingLocation: false,
    id: "q1abc",
    ...overrides,
  });

  async function watching(channel = fakeChannel({ lastMessage: yesNoQuestion() })) {
    const view = render(<GuidedInterrogationGuest channel={channel} />);
    await watchQuestion();
    return { ...view, channel };
  }

  it("offers Yes and No for the patient to tap", async () => {
    await watching();

    expect(screen.getByTestId("choice-yes")).toBeInTheDocument();
    expect(screen.getByTestId("choice-no")).toBeInTheDocument();
    expect(screen.getByTestId("tap-yes-or-no")).toHaveTextContent(/nod or shake/i);
  });

  it("sends the tap for the question it was on, as the patient's own", async () => {
    const { channel } = await watching();

    fireEvent.click(screen.getByTestId("choice-yes"));

    expect(channel.send).toHaveBeenCalledWith({
      type: "answer",
      kind: "yesno",
      value: "Yes",
      answeredBy: "patient",
      for: "q1abc",
    });
  });

  it("sends No the same way", async () => {
    const { channel } = await watching();

    fireEvent.click(screen.getByTestId("choice-no"));

    expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({ value: "No", for: "q1abc" }));
  });

  it("records its own copy, as the patient's", async () => {
    await watching();

    fireEvent.click(screen.getByTestId("choice-yes"));

    expect(readTranscript()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "to_doctor", text: "Yes", answeredBy: "patient" }),
      ]),
    );
  });

  it("shows the answer as sent at once, and the talking face", async () => {
    await watching();

    fireEvent.click(screen.getByTestId("choice-yes"));

    expect(screen.getByTestId("speaking-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("sent-reply-working")).toBeInTheDocument();
  });

  it("goes back to waiting once answered, so it cannot be answered twice", async () => {
    await watching();

    fireEvent.click(screen.getByTestId("choice-yes"));

    expect(screen.getByTestId("stage-idle")).toBeInTheDocument();
    expect(screen.queryByTestId("choice-yes")).not.toBeInTheDocument();
  });

  it("stops offering it when the doctor's device says it has been answered", async () => {
    const { rerender } = await watching();

    rerender(
      <GuidedInterrogationGuest
        channel={fakeChannel({ lastMessage: { type: "answered", id: "q1abc" } })}
      />,
    );

    expect(screen.queryByTestId("choice-yes")).not.toBeInTheDocument();
    expect(screen.getByTestId("stage-idle")).toBeInTheDocument();
  });

  it("ignores an answered notice for some other question", async () => {
    const { rerender } = await watching();

    rerender(
      <GuidedInterrogationGuest
        channel={fakeChannel({ lastMessage: { type: "answered", id: "older" } })}
      />,
    );

    expect(screen.getByTestId("choice-yes")).toBeInTheDocument();
  });

  it("does not leave a tap waiting when it was too late to count", async () => {
    // The doctor recorded a nod a moment before. This phone's tap is told so,
    // and must not sit on "sending" for ever.
    const { channel, rerender } = await watching();
    fireEvent.click(screen.getByTestId("choice-yes"));
    expect(screen.getByTestId("speaking-overlay")).toBeInTheDocument();

    rerender(
      <GuidedInterrogationGuest
        channel={fakeChannel({
          send: channel.send,
          lastMessage: { type: "answered", id: "q1abc", stale: true },
        })}
      />,
    );

    await waitFor(() => expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument());
    expect(screen.queryByTestId("sent-reply")).not.toBeInTheDocument();
  });

  it("is offered again after a reload, from the question sent again", async () => {
    await watching(fakeChannel({ lastMessage: yesNoQuestion({ resent: true }) }));

    expect(screen.getByTestId("choice-yes")).toBeInTheDocument();
  });

  it("is locked while the doctor's device is being found again", async () => {
    render(
      <GuidedInterrogationGuest channel={fakeChannel({ lastMessage: yesNoQuestion() })} offline />,
    );
    await watchQuestion();

    expect(screen.getByTestId("choice-yes").closest(".offline-lock")).toHaveAttribute("inert");
  });

  it("falls back to waiting on the doctor for a question with no name, from an older device", async () => {
    // Nothing to say the tap is for, so it is not offered.
    await watching(fakeChannel({ lastMessage: yesNoQuestion({ id: undefined }) }));

    expect(screen.getByTestId("waiting-on-doctor-confirmation")).toBeInTheDocument();
    expect(screen.queryByTestId("choice-yes")).not.toBeInTheDocument();
  });
});

describe("where does it hurt, answered here", () => {
  it("shows the body location grid once the question has been watched", async () => {
    const channel = fakeChannel({
      lastMessage: { type: "question", result: caption(), awaitingLocation: true },
    });
    render(<GuidedInterrogationGuest channel={channel} />);
    await watchQuestion();

    expect(screen.getByTestId("answer-option-HEAD")).toBeInTheDocument();
  });

  it("sends the tapped location back and records its own copy", async () => {
    const channel = fakeChannel({
      lastMessage: { type: "question", result: caption(), awaitingLocation: true },
    });
    render(<GuidedInterrogationGuest channel={channel} />);
    await watchQuestion();

    fireEvent.click(screen.getByTestId("answer-option-HEAD"));

    expect(channel.send).toHaveBeenCalledWith({
      type: "answer",
      value: "Head",
      answeredBy: "patient",
    });
    expect(readTranscript()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: "to_doctor",
          text: "Head",
          answeredBy: "patient",
        }),
      ]),
    );
  });

  it("returns to the waiting stage once answered", async () => {
    const channel = fakeChannel({
      lastMessage: { type: "question", result: caption(), awaitingLocation: true },
    });
    render(<GuidedInterrogationGuest channel={channel} />);
    await watchQuestion();

    fireEvent.click(screen.getByTestId("answer-option-HEAD"));

    expect(screen.getByTestId("stage-idle")).toBeInTheDocument();
  });
});

describe("the doctor ending the consultation", () => {
  it("leaves the patient's own record where they can read and delete it", async () => {
    // Nothing clears this phone for them the way a new patient does on the
    // shared device, so an ended screen that hid the record would leave a
    // consultation on the phone that its owner could not get at.
    const question = {
      type: "question",
      result: caption(),
      awaitingLocation: false,
    };
    const { rerender } = render(
      <GuidedInterrogationGuest channel={fakeChannel({ lastMessage: question })} />,
    );
    await waitFor(() => expect(readTranscript()).toHaveLength(1));

    rerender(
      <GuidedInterrogationGuest channel={fakeChannel({ lastMessage: { type: "ended" } })} />,
    );

    expect(screen.getByTestId("pairing-ended")).toBeInTheDocument();
    expect(screen.getByTestId("transcript")).toBeInTheDocument();
    expect(screen.getByTestId("transcript-privacy")).toHaveTextContent(
      /until you delete it/i,
    );

    fireEvent.click(screen.getByTestId("delete-transcript"));
    fireEvent.click(screen.getByTestId("confirm-delete-yes"));

    expect(readTranscript()).toEqual([]);
    await waitFor(() => expect(fetchBodyLocations).toHaveBeenCalled());
  });

  it("shows that it has ended rather than going silently dead", async () => {
    const channel = fakeChannel({ lastMessage: { type: "ended" } });

    render(<GuidedInterrogationGuest channel={channel} />);

    expect(screen.getByTestId("pairing-ended")).toBeInTheDocument();
    await waitFor(() => expect(fetchBodyLocations).toHaveBeenCalled());
  });

  it("is told it is over by the screen that owns the connection", async () => {
    render(<GuidedInterrogationGuest channel={fakeChannel()} forceEnded />);

    expect(screen.getByTestId("pairing-ended")).toBeInTheDocument();
    await waitFor(() => expect(fetchBodyLocations).toHaveBeenCalled());
  });

  it("does not call a dropped connection the end", async () => {
    // It may be waiting to rejoin after a reload, which is not the end.
    const { rerender } = render(<GuidedInterrogationGuest channel={fakeChannel()} />);

    rerender(<GuidedInterrogationGuest channel={fakeChannel({ state: "closed" })} offline />);

    expect(screen.queryByTestId("pairing-ended")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchBodyLocations).toHaveBeenCalled());
  });

  it("offers the way to the next consultation once it is over", async () => {
    const onLeave = vi.fn();
    render(<GuidedInterrogationGuest channel={fakeChannel()} forceEnded onLeave={onLeave} />);

    fireEvent.click(screen.getByTestId("join-another"));

    expect(onLeave).toHaveBeenCalled();
    await waitFor(() => expect(fetchBodyLocations).toHaveBeenCalled());
  });

});

describe("feedback on the tapped location, on the patient's own phone", () => {
  let vibrate;

  beforeEach(() => {
    vibrate = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
  });

  afterEach(() => {
    delete navigator.vibrate;
  });

  const asking = () =>
    fakeChannel({
      lastMessage: { type: "question", result: caption(), awaitingLocation: true },
    });

  async function tappedHead() {
    const ch = asking();
    const view = render(<GuidedInterrogationGuest channel={ch} />);
    await watchQuestion();
    fireEvent.click(screen.getByTestId("answer-option-HEAD"));
    return { ch, ...view };
  }

  const report = (ch, status) =>
    fakeChannel({ send: ch.send, lastMessage: { type: "speaking", status } });

  it("shows the talking face at once, with the location that was tapped", async () => {
    await tappedHead();

    const overlay = screen.getByTestId("speaking-overlay");
    expect(overlay).toHaveTextContent("Head");
    expect(screen.getByTestId("sent-reply-working")).toBeInTheDocument();
  });

  it("keeps it up while the doctor's device speaks, with the wave and two pulses", async () => {
    const { ch, rerender } = await tappedHead();
    vibrate.mockClear();

    rerender(<GuidedInterrogationGuest channel={report(ch, "playing")} />);

    expect(screen.getByTestId("speaking-overlay")).toBeInTheDocument();
    expect(vibrate).toHaveBeenCalledWith([40, 70, 40]);
  });

  it("shows the tick and gives one long pulse when it has been spoken", async () => {
    const { ch, rerender } = await tappedHead();
    vibrate.mockClear();

    rerender(<GuidedInterrogationGuest channel={report(ch, "spoken")} />);

    // Held a moment so it can be seen, then gone.
    await waitFor(() => expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument(), {
      timeout: 4000,
    });
    expect(screen.getByTestId("sent-reply-spoken")).toHaveTextContent(/spoken to the doctor/i);
    expect(vibrate).toHaveBeenCalledWith([220]);
  });

  it("can be stopped, and asks the doctor's device to stop", async () => {
    const { ch } = await tappedHead();

    fireEvent.click(screen.getByRole("button", { name: /stop/i }));

    expect(ch.send).toHaveBeenCalledWith({ type: "stop" });
    expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument();
  });

  it("shows nothing for the doctor's own confirmation, which the patient did not tap", async () => {
    // FR 2.7: the doctor confirms a Yes or No. That is spoken on their device
    // too, and reported, but it is not this patient's answer to show back.
    const ch = fakeChannel();
    render(<GuidedInterrogationGuest channel={report(ch, "playing")} />);

    expect(screen.queryByTestId("speaking-overlay")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sent-reply")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchBodyLocations).toHaveBeenCalled());
  });
});

describe("while the phone is finding the doctor's device again", () => {
  it("keeps the question on screen but holds the answers still", async () => {
    render(
      <GuidedInterrogationGuest
        channel={fakeChannel({
          lastMessage: { type: "question", result: caption(), awaitingLocation: true },
        })}
        offline
      />,
    );

    await waitFor(() => expect(fetchBodyLocations).toHaveBeenCalled());
    expect(document.querySelector(".offline-lock")).toHaveAttribute("inert");
  });
});

describe("a question sent again after a reconnect", () => {
  it("is shown, but not recorded a second time", async () => {
    render(
      <GuidedInterrogationGuest
        channel={fakeChannel({
          lastMessage: {
            type: "question",
            result: caption(),
            awaitingLocation: true,
            resent: true,
          },
        })}
      />,
    );
    await watchQuestion();

    expect(readTranscript()).toEqual([]);
  });
});
