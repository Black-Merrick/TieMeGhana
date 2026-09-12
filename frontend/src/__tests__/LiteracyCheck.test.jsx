import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LiteracyCheck from "../components/LiteracyCheck.jsx";
import { fetchClipByGloss } from "../api/clips.js";
import { LiteracyPath, loadVisit } from "../visit/visit.js";

vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchClipByGloss: vi.fn() };
});

const promptClip = {
  gloss: "CAN_YOU_READ_AND_WRITE",
  kind: "prompt",
  video_url: "/media/clips/can_you_read_and_write.webm",
  duration_ms: 3000,
};

beforeEach(() => {
  localStorage.clear();
  fetchClipByGloss.mockResolvedValue(promptClip);
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("LiteracyCheck", () => {
  it("asks the question as sign video", async () => {
    // FR 2.1. The question must be delivered in GhSL, because a patient who
    // cannot read print cannot be asked in writing whether they can read.
    render(<LiteracyCheck onDecided={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("sign-video")).toHaveAttribute(
        "src",
        promptClip.video_url,
      );
    });
  });

  it("plays the prompt through the app's shared player", async () => {
    // Section 4.4. The same player appearance and controls everywhere, so a
    // patient who learns one sign video knows them all.
    render(<LiteracyCheck onDecided={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("sign-video")).toBeInTheDocument();
    });
    expect(screen.getByTestId("sign-video").className).toContain(
      "player__video",
    );
  });

  it("offers only icon answers, with no text to read", async () => {
    render(<LiteracyCheck onDecided={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("choice-yes")).toBeInTheDocument();
    });
    expect(screen.getByTestId("choice-yes")).toHaveTextContent("");
    expect(screen.getByTestId("choice-no")).toHaveTextContent("");
  });

  it("routes a patient who reads to the literate path", async () => {
    // FR 2.3, free captioning and typed responses.
    const onDecided = vi.fn();
    const user = userEvent.setup();
    render(<LiteracyCheck onDecided={onDecided} />);

    await waitFor(() => screen.getByTestId("choice-yes"));
    await user.click(screen.getByTestId("choice-yes"));

    expect(onDecided).toHaveBeenCalledWith(LiteracyPath.LITERATE);
  });

  it("routes a patient who does not read to Guided Interrogation", async () => {
    // FR 2.4. This is the branch the whole project exists for, so it gets its
    // own test rather than being assumed symmetric with the yes case.
    const onDecided = vi.fn();
    const user = userEvent.setup();
    render(<LiteracyCheck onDecided={onDecided} />);

    await waitFor(() => screen.getByTestId("choice-no"));
    await user.click(screen.getByTestId("choice-no"));

    expect(onDecided).toHaveBeenCalledWith(LiteracyPath.GUIDED);
  });

  it("remembers the answer so a reload does not ask again", async () => {
    // FR 2.2, the answer lasts for the visit.
    const user = userEvent.setup();
    render(<LiteracyCheck onDecided={vi.fn()} />);

    await waitFor(() => screen.getByTestId("choice-no"));
    await user.click(screen.getByTestId("choice-no"));

    expect(loadVisit().literacyPath).toBe(LiteracyPath.GUIDED);
  });

  it("says so when the question has not been filmed yet", async () => {
    // Without the clip the app cannot ask in GhSL. Reporting that is the only
    // honest option: acting on an answer to a question the patient was never
    // asked would silently defeat the literacy check.
    fetchClipByGloss.mockRejectedValue(new Error("404"));
    render(<LiteracyCheck onDecided={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("literacy-unavailable")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("sign-video")).not.toBeInTheDocument();
  });

  it("still lets the answer be recorded when the prompt is missing", async () => {
    // The doctor can ask in person, so the patient's answer is still usable.
    // Blocking here would make the whole app unusable before filming is done.
    fetchClipByGloss.mockRejectedValue(new Error("404"));
    const onDecided = vi.fn();
    const user = userEvent.setup();
    render(<LiteracyCheck onDecided={onDecided} />);

    await waitFor(() => screen.getByTestId("choice-yes"));
    await user.click(screen.getByTestId("choice-yes"));

    expect(onDecided).toHaveBeenCalledWith(LiteracyPath.LITERATE);
  });

  it("shows no answer options until the prompt has been resolved", async () => {
    // Tapping before the question has loaded would be answering nothing.
    let resolve;
    fetchClipByGloss.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<LiteracyCheck onDecided={vi.fn()} />);

    expect(screen.queryByTestId("choice-yes")).not.toBeInTheDocument();
    expect(screen.getByTestId("literacy-loading")).toBeInTheDocument();

    resolve(promptClip);
    await waitFor(() => {
      expect(screen.getByTestId("choice-yes")).toBeInTheDocument();
    });
  });

  it("asks for the literacy prompt by its gloss", async () => {
    render(<LiteracyCheck onDecided={vi.fn()} />);

    await waitFor(() => {
      expect(fetchClipByGloss).toHaveBeenCalledWith("CAN_YOU_READ_AND_WRITE");
    });
  });
});
