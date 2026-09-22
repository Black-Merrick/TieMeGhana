import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SavePrescription from "../components/SavePrescription.jsx";
import { saveFile } from "../prescription/saveFile.js";

vi.mock("../prescription/saveFile.js", () => ({ saveFile: vi.fn() }));

/**
 * Saving the videos to the patient's phone, FR 6.2. A tap that seems to do
 * nothing is the worst outcome for a patient who cannot hear or read what went
 * wrong, so each save says what became of it.
 */

function playlist(overrides = {}) {
  return {
    video_url: "https://bucket.example/stitched/whole.mp4",
    items: [
      {
        position: 1,
        label: "Paracetamol",
        video_url: "https://bucket.example/stitched/one.mp4",
        sequence: { is_safe_to_show: true },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  saveFile.mockResolvedValue(true);
});
afterEach(() => vi.clearAllMocks());

describe("saving all the medicines as one video", () => {
  it("saves the file itself, under the name the patient will see", async () => {
    render(<SavePrescription playlist={playlist()} />);

    await userEvent.click(screen.getByTestId("save-whole"));

    expect(saveFile).toHaveBeenCalledWith(
      "https://bucket.example/stitched/whole.mp4",
      "my-prescription.mp4",
    );
  });

  it("says it is saving, then that it was saved and where to look", async () => {
    let finish;
    saveFile.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<SavePrescription playlist={playlist()} />);

    await userEvent.click(screen.getByTestId("save-whole"));
    expect(screen.getByTestId("save-status-saving")).toBeInTheDocument();

    finish(true);
    expect(await screen.findByTestId("save-status-saved")).toHaveTextContent(
      /downloads or gallery/i,
    );
  });

  it("says when it could not be saved from here, and offers the video to open instead", async () => {
    saveFile.mockResolvedValue(false);
    render(<SavePrescription playlist={playlist()} />);

    await userEvent.click(screen.getByTestId("save-whole"));

    expect(await screen.findByTestId("save-status-failed")).toBeInTheDocument();
    const open = screen.getByTestId("save-open");
    expect(open).toHaveAttribute("href", "https://bucket.example/stitched/whole.mp4");
    expect(open).toHaveAttribute("target", "_blank");
  });

  it("leaves a modified click to the browser", async () => {
    render(<SavePrescription playlist={playlist()} />);

    fireEvent.click(screen.getByTestId("save-whole"), { ctrlKey: true });

    expect(saveFile).not.toHaveBeenCalled();
  });

  it("keeps the plain link, so it still works with scripting off", () => {
    render(<SavePrescription playlist={playlist()} />);

    const link = screen.getByTestId("save-whole");
    expect(link).toHaveAttribute("href", "https://bucket.example/stitched/whole.mp4");
    expect(link).toHaveAttribute("download", "my-prescription.mp4");
  });
});

describe("saving each medicine when one file is not offered", () => {
  it("saves that medicine, named for it", async () => {
    render(<SavePrescription playlist={playlist({ video_url: null })} />);

    await userEvent.click(screen.getByTestId("save-item-1"));

    expect(saveFile).toHaveBeenCalledWith(
      "https://bucket.example/stitched/one.mp4",
      "paracetamol.mp4",
    );
    await waitFor(() => expect(screen.getByTestId("save-status-saved")).toBeInTheDocument());
  });
});
