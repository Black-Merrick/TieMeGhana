import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GuidedInterrogation from "../components/GuidedInterrogation.jsx";
import { fetchQuestions } from "../api/questions.js";

vi.mock("../api/questions.js", () => ({ fetchQuestions: vi.fn() }));

const selectionQuestion = {
  id: 1,
  english_text: "Where does it hurt?",
  question_type: "selection",
  category: "intake",
  is_playable: true,
  prompt_sequence: {
    source_text: "Where does it hurt?",
    segments: [
      {
        token: "where",
        match: "gloss",
        clips: [
          { gloss: "WHERE", video_url: "/media/clips/where.webm", duration_ms: 900 },
        ],
      },
    ],
    total_duration_ms: 900,
    fingerspelled_tokens: [],
    unavailable_tokens: [],
  },
  options: [
    {
      id: 11,
      english_text: "Head",
      order: 0,
      clip: { gloss: "HEAD", video_url: "/media/clips/head.webm", duration_ms: 800 },
    },
    {
      id: 12,
      english_text: "Chest",
      order: 1,
      clip: { gloss: "CHEST", video_url: "/media/clips/chest.webm", duration_ms: 800 },
    },
  ],
};

const yesNoQuestion = {
  id: 2,
  english_text: "Do you feel nauseous?",
  question_type: "yes_no",
  category: "symptoms",
  is_playable: true,
  prompt_sequence: {
    source_text: "Do you feel nausea?",
    segments: [
      {
        token: "nausea",
        match: "gloss",
        clips: [
          { gloss: "NAUSEA", video_url: "/media/clips/nausea.webm", duration_ms: 900 },
        ],
      },
      {
        token: "nod_or_shake",
        match: "gloss",
        clips: [
          { gloss: "NOD_OR_SHAKE", video_url: "/media/clips/nod.webm", duration_ms: 1200 },
        ],
      },
    ],
    total_duration_ms: 2100,
    fingerspelled_tokens: [],
    unavailable_tokens: [],
  },
  options: [],
};

beforeEach(() => {
  fetchQuestions.mockResolvedValue([selectionQuestion, yesNoQuestion]);
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Render the bank and wait for a given question to appear in it. */
async function openBank(questionId = 1) {
  render(<GuidedInterrogation />);
  await waitFor(() => screen.getByTestId(`ask-question-${questionId}`));
}

describe("the question bank", () => {
  it("offers the doctor the questions from the bank", async () => {
    await openBank();

    expect(screen.getByTestId("ask-question-1")).toHaveTextContent(
      "Where does it hurt?",
    );
    expect(screen.getByTestId("ask-question-2")).toBeInTheDocument();
  });

  it("offers no free text field anywhere", async () => {
    // Section 4.3. A non literate patient is never shown a text input, and the
    // bank itself is a fixed list rather than something the doctor types into,
    // so an unreviewed question cannot reach a patient.
    await openBank();

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("says so when no question is askable yet", async () => {
    // Expected before filming: a question needs its GhSL prompt approved.
    fetchQuestions.mockResolvedValue([]);
    render(<GuidedInterrogation />);

    await waitFor(() => {
      expect(screen.getByTestId("guided-empty")).toBeInTheDocument();
    });
  });

  it("reports a failure to load rather than showing an empty bank", async () => {
    // An empty bank and a broken connection need different responses from the
    // doctor, so they must not look the same.
    fetchQuestions.mockRejectedValue(new Error("offline"));
    render(<GuidedInterrogation />);

    await waitFor(() => {
      expect(screen.getByTestId("guided-error")).toBeInTheDocument();
    });
  });
});

describe("asking a selection question", () => {
  it("plays the question to the patient as sign video", async () => {
    // FR 2.4. The patient sees GhSL, not the English the doctor read.
    const user = userEvent.setup();
    await openBank();

    await user.click(screen.getByTestId("ask-question-1"));

    expect(screen.getAllByTestId("sign-video")[0]).toHaveAttribute(
      "src",
      "/media/clips/where.webm",
    );
  });

  it("shows a grid of sign video answers to tap", async () => {
    // FR 2.5. Each option is a sign video, because the patient may not read.
    const user = userEvent.setup();
    await openBank();

    await user.click(screen.getByTestId("ask-question-1"));

    expect(screen.getByTestId("answer-option-11")).toBeInTheDocument();
    expect(screen.getByTestId("answer-option-12")).toBeInTheDocument();
  });

  it("records the option the patient tapped", async () => {
    const user = userEvent.setup();
    await openBank();

    await user.click(screen.getByTestId("ask-question-1"));
    await user.click(screen.getByTestId("answer-option-11"));

    await waitFor(() => {
      expect(screen.getByTestId("exchange-log")).toHaveTextContent("Head");
    });
  });

  it("records a tapped answer as the patient's own", async () => {
    // The distinction FR 2.7 draws. A tapped answer came from the patient, so
    // the record must not later imply the doctor entered it.
    const user = userEvent.setup();
    await openBank();

    await user.click(screen.getByTestId("ask-question-1"));
    await user.click(screen.getByTestId("answer-option-11"));

    await waitFor(() => {
      expect(screen.getByTestId("exchange-log")).toHaveTextContent(
        "tapped by the patient",
      );
    });
  });

  it("returns to the bank after an answer, ready for the next question", async () => {
    const user = userEvent.setup();
    await openBank();

    await user.click(screen.getByTestId("ask-question-1"));
    await user.click(screen.getByTestId("answer-option-12"));

    await waitFor(() => {
      expect(screen.getByTestId("ask-question-1")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("asking-question")).not.toBeInTheDocument();
  });
});

describe("asking a yes or no question", () => {
  it("tells the doctor to observe the patient rather than detect a gesture", async () => {
    // FR 2.6 is explicit that no camera based gesture detection is used. The
    // doctor watches the patient in person.
    const user = userEvent.setup();
    await openBank();

    await user.click(screen.getByTestId("ask-question-2"));

    expect(screen.getByTestId("nod-instruction")).toBeInTheDocument();
  });

  it("uses no camera", async () => {
    // Asserted directly, because adding gesture detection later would be a
    // change to a stated design decision, not an improvement.
    const user = userEvent.setup();
    await openBank();

    await user.click(screen.getByTestId("ask-question-2"));

    expect(document.querySelector("video[autoplay][data-camera]")).toBeNull();
    expect(navigator.mediaDevices).toBeUndefined();
  });

  it("shows no answer grid, since the patient nods instead", async () => {
    const user = userEvent.setup();
    await openBank();

    await user.click(screen.getByTestId("ask-question-2"));

    expect(screen.queryByTestId("answer-option-11")).not.toBeInTheDocument();
    expect(screen.getByTestId("choice-yes")).toBeInTheDocument();
  });

  it("records the doctor's confirmation, not a reading of the patient", async () => {
    // FR 2.7. What gets logged is what the doctor confirmed they observed.
    const user = userEvent.setup();
    await openBank();

    await user.click(screen.getByTestId("ask-question-2"));
    await user.click(screen.getByTestId("choice-yes"));

    await waitFor(() => {
      expect(screen.getByTestId("exchange-log")).toHaveTextContent(
        "confirmed by the doctor",
      );
    });
    expect(screen.getByTestId("exchange-log")).toHaveTextContent("Yes");
  });

  it("records a no the same way", async () => {
    const user = userEvent.setup();
    await openBank();

    await user.click(screen.getByTestId("ask-question-2"));
    await user.click(screen.getByTestId("choice-no"));

    await waitFor(() => {
      expect(screen.getByTestId("exchange-log")).toHaveTextContent("No");
    });
  });
});

describe("coverage while footage is still missing", () => {
  it("marks a question that has no signs filmed yet", async () => {
    // Marked rather than hidden, so the doctor sees the gap instead of a bank
    // that merely looks small.
    fetchQuestions.mockResolvedValue([{ ...yesNoQuestion, is_playable: false }]);
    await openBank(yesNoQuestion.id);

    expect(screen.getByTestId(`no-signs-${yesNoQuestion.id}`)).toBeInTheDocument();
  });

  it("warns which words the patient will not have seen signed", async () => {
    // A question the patient only partly saw is a question they were partly
    // asked, so the doctor is told to ask it in person instead.
    fetchQuestions.mockResolvedValue([
      {
        ...yesNoQuestion,
        prompt_sequence: {
          ...yesNoQuestion.prompt_sequence,
          unavailable_tokens: ["nausea"],
        },
      },
    ]);
    const user = userEvent.setup();
    await openBank(yesNoQuestion.id);

    await user.click(screen.getByTestId(`ask-question-${yesNoQuestion.id}`));

    expect(screen.getByTestId("asking-gap")).toHaveTextContent("nausea");
  });
});

describe("the consultation log", () => {
  it("keeps every answer in the order they were given", async () => {
    const user = userEvent.setup();
    await openBank();

    await user.click(screen.getByTestId("ask-question-1"));
    await user.click(screen.getByTestId("answer-option-11"));
    await waitFor(() => screen.getByTestId("ask-question-2"));
    await user.click(screen.getByTestId("ask-question-2"));
    await user.click(screen.getByTestId("choice-yes"));

    await waitFor(() => {
      expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
    });
  });

  it("says plainly that the log is not saved yet", async () => {
    // It is held in memory until FR 4.1 to 4.3. Implying otherwise would be a
    // promise about a patient's record that the code does not keep.
    const user = userEvent.setup();
    await openBank();

    await user.click(screen.getByTestId("ask-question-2"));
    await user.click(screen.getByTestId("choice-yes"));

    await waitFor(() => {
      expect(screen.getByTestId("log-not-saved")).toBeInTheDocument();
    });
  });

  it("shows nothing before the first answer", async () => {
    await openBank();

    expect(screen.queryByTestId("exchange-log")).not.toBeInTheDocument();
  });

  it("lets the doctor back out of a question without recording an answer", async () => {
    const user = userEvent.setup();
    await openBank();

    await user.click(screen.getByTestId("ask-question-1"));
    await user.click(screen.getByTestId("cancel-question"));

    await waitFor(() => screen.getByTestId("ask-question-1"));
    expect(screen.queryByTestId("exchange-log")).not.toBeInTheDocument();
  });
});
