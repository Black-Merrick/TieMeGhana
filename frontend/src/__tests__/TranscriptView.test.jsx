import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TranscriptView from "../components/TranscriptView.jsx";
import { Direction } from "../transcript/transcript.js";

/** FR 4.3, the patient viewing, scrolling, and deleting their own record. */

const entries = [
  {
    id: "1",
    direction: Direction.TO_PATIENT,
    text: "Do you have fever?",
    at: "2026-09-12T10:00:00.000Z",
  },
  {
    id: "2",
    direction: Direction.TO_DOCTOR,
    text: "Yes",
    answeredBy: "doctor",
    at: "2026-09-12T10:00:05.000Z",
  },
];

beforeEach(() => {
  vi.stubGlobal("URL", {
    ...globalThis.URL,
    createObjectURL: vi.fn(() => "blob:transcript"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("reading the record", () => {
  it("shows nothing when there is no record yet", () => {
    render(<TranscriptView entries={[]} onDiscard={vi.fn()} />);

    expect(screen.queryByTestId("transcript")).not.toBeInTheDocument();
  });

  it("shows both sides of the conversation", () => {
    render(<TranscriptView entries={entries} onDiscard={vi.fn()} />);

    const list = screen.getByTestId("transcript-list");
    expect(list).toHaveTextContent("Do you have fever?");
    expect(list).toHaveTextContent("Yes");
  });

  it("says who said each line in the patient's terms", () => {
    // The record is the patient's, so it reads "You" rather than an internal
    // direction value.
    render(<TranscriptView entries={entries} onDiscard={vi.fn()} />);

    expect(screen.getByTestId("transcript-list")).toHaveTextContent("You");
    expect(screen.getByTestId("transcript-list")).not.toHaveTextContent(
      "to_doctor",
    );
  });

  it("shows that a nod was the doctor's confirmation", () => {
    // FR 2.7. A patient reading this later has to be able to tell which
    // answers were their own taps and which the doctor confirmed for them.
    render(<TranscriptView entries={entries} onDiscard={vi.fn()} />);

    expect(screen.getByTestId("transcript-list")).toHaveTextContent(
      "confirmed by the doctor",
    );
  });

  it("tells the patient the record never leaves the device", () => {
    // FR 4.2 and NFR 4. This is the reason a patient would use the app rather
    // than bring a relative along to interpret, so it is stated plainly.
    render(<TranscriptView entries={entries} onDiscard={vi.fn()} />);

    expect(screen.getByTestId("transcript-privacy")).toHaveTextContent(
      /this device only/i,
    );
  });

  it("says the shared device's record is deleted when the visit ends", () => {
    render(<TranscriptView entries={entries} onDiscard={vi.fn()} />);

    expect(screen.getByTestId("transcript-privacy")).toHaveTextContent(
      /deleted automatically when the visit ends/i,
    );
  });

  it("does not promise that on a patient's own phone, where nothing ends the visit", () => {
    // Saying a record is deleted automatically when it is not would be the
    // one untrue thing a privacy line can say. ADR 053.
    render(<TranscriptView entries={entries} onDiscard={vi.fn()} onOwnPhone />);

    const line = screen.getByTestId("transcript-privacy");
    expect(line).toHaveTextContent(/this phone only/i);
    expect(line).toHaveTextContent(/until you delete it/i);
    expect(line).not.toHaveTextContent(/deleted automatically/i);
  });
});

describe("deleting the record", () => {
  it("asks for confirmation first", () => {
    // Deleting is the patient's right under FR 4.3, but it is irreversible,
    // and a mistap mid consultation would destroy their only record.
    render(<TranscriptView entries={entries} onDiscard={vi.fn()} />);

    expect(screen.queryByTestId("confirm-delete")).not.toBeInTheDocument();
  });

  it("deletes only after the patient confirms", async () => {
    const onDiscard = vi.fn();
    const user = userEvent.setup();
    render(<TranscriptView entries={entries} onDiscard={onDiscard} />);

    await user.click(screen.getByTestId("delete-transcript"));
    expect(onDiscard).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("confirm-delete-yes"));
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("keeps the record when the patient changes their mind", async () => {
    const onDiscard = vi.fn();
    const user = userEvent.setup();
    render(<TranscriptView entries={entries} onDiscard={onDiscard} />);

    await user.click(screen.getByTestId("delete-transcript"));
    await user.click(screen.getByTestId("confirm-delete-no"));

    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.getByTestId("delete-transcript")).toBeInTheDocument();
  });
});

describe("taking a copy", () => {
  async function startSaving() {
    const user = userEvent.setup();
    render(<TranscriptView entries={entries} onDiscard={vi.fn()} />);
    await user.click(screen.getByTestId("start-save-transcript"));
    return user;
  }

  it("asks for the patient's name before saving", async () => {
    // The record is meant to be recognisably theirs, which an unnamed file is
    // not, so the name is asked for rather than assumed.
    const user = await startSaving();

    expect(screen.getByTestId("patient-name")).toBeInTheDocument();
    expect(user).toBeDefined();
  });

  it("says the name is not kept on the device", async () => {
    // ADR 028. A name stored beside a clinical transcript on a shared device
    // would make a stray record identifying, so it is used and discarded, and
    // the patient is told that.
    await startSaving();

    expect(screen.getByTestId("transcript")).toHaveTextContent(
      /not stored on this device/i,
    );
  });

  it("refuses to save without a name, and says why", async () => {
    const user = await startSaving();

    await user.click(screen.getByTestId("save-transcript"));

    expect(screen.getByTestId("patient-name-warning")).toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("clears the warning once a name is typed", async () => {
    const user = await startSaving();
    await user.click(screen.getByTestId("save-transcript"));

    await user.type(screen.getByTestId("patient-name"), "A");

    expect(screen.queryByTestId("patient-name-warning")).not.toBeInTheDocument();
  });

  it("saves a named copy for the patient to keep", async () => {
    // NFR 4 calls this an explicit patient action, which is exactly what
    // naming the record and tapping download is.
    const user = await startSaving();

    await user.type(screen.getByTestId("patient-name"), "Ama Mensah");
    await user.click(screen.getByTestId("save-transcript"));

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });

  it("releases the download url rather than leaking it", async () => {
    const user = await startSaving();

    await user.type(screen.getByTestId("patient-name"), "Ama Mensah");
    await user.click(screen.getByTestId("save-transcript"));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:transcript");
  });

  it("forgets the name after saving", async () => {
    const user = await startSaving();

    await user.type(screen.getByTestId("patient-name"), "Ama Mensah");
    await user.click(screen.getByTestId("save-transcript"));

    // Back to the starting state, with nothing holding the name.
    expect(screen.getByTestId("start-save-transcript")).toBeInTheDocument();
    expect(screen.queryByTestId("patient-name")).not.toBeInTheDocument();
  });

  it("lets the patient back out without saving", async () => {
    const user = await startSaving();

    await user.click(screen.getByTestId("cancel-save"));

    expect(screen.queryByTestId("patient-name")).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe("naming the saved copy, in a dialog", () => {
  it("asks for the name in a dialog rather than under the list", async () => {
    // The panel it replaces sat below a transcript that scrolls, so on a long
    // consultation the field the patient had just asked for was off screen and
    // the button that completed the action was back up in the header.
    const user = userEvent.setup();
    render(<TranscriptView entries={entries} onDiscard={() => {}} />);

    await user.click(screen.getByTestId("start-save-transcript"));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(screen.getByTestId("patient-name"));
    expect(dialog).toContainElement(screen.getByTestId("save-transcript"));
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("puts the cursor in the field", async () => {
    // The dialog exists to hold one field, so making the patient find it
    // first would be the only thing it asks of them.
    const user = userEvent.setup();
    render(<TranscriptView entries={entries} onDiscard={() => {}} />);

    await user.click(screen.getByTestId("start-save-transcript"));

    expect(screen.getByTestId("patient-name")).toHaveFocus();
  });

  it("saves on Enter, without reaching for the button", async () => {
    const user = userEvent.setup();
    render(<TranscriptView entries={entries} onDiscard={() => {}} />);

    await user.click(screen.getByTestId("start-save-transcript"));
    await user.type(screen.getByTestId("patient-name"), "Ama Mensah{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("closes on Escape", async () => {
    // What a keyboard user reaches for first, and it goes through the same
    // path as Cancel so the two cannot drift apart.
    const user = userEvent.setup();
    render(<TranscriptView entries={entries} onDiscard={() => {}} />);

    await user.click(screen.getByTestId("start-save-transcript"));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("still refuses to save without a name", async () => {
    // The name is the point of asking, so an unnamed record would defeat it.
    const user = userEvent.setup();
    render(<TranscriptView entries={entries} onDiscard={() => {}} />);

    await user.click(screen.getByTestId("start-save-transcript"));
    await user.click(screen.getByTestId("save-transcript"));

    expect(screen.getByTestId("patient-name-warning")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("forgets the name after saving, per ADR 028", async () => {
    // A name stored beside a clinical transcript on a shared device is what
    // makes a stray record identifying.
    const user = userEvent.setup();
    render(<TranscriptView entries={entries} onDiscard={() => {}} />);

    await user.click(screen.getByTestId("start-save-transcript"));
    await user.type(screen.getByTestId("patient-name"), "Ama Mensah");
    await user.click(screen.getByTestId("save-transcript"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await user.click(screen.getByTestId("start-save-transcript"));
    expect(screen.getByTestId("patient-name")).toHaveValue("");
  });
});
