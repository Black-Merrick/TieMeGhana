import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PrescriptionBuilder from "../components/PrescriptionBuilder.jsx";
import PrescriptionPlayback from "../components/PrescriptionPlayback.jsx";
import {
  fetchPlaylist,
  issuePrescription,
  playlistUrl,
  referenceFromPath,
} from "../api/prescriptions.js";

vi.mock("../api/prescriptions.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, issuePrescription: vi.fn(), fetchPlaylist: vi.fn() };
});

/**
 * Prescription playback, SRS FR 6.1 to FR 6.4.
 *
 * The one part of the app the patient uses alone, at home, with nobody to ask.
 * That shapes what these tests hold: an instruction that cannot be rendered
 * must say so rather than render partially, and nothing on the patient's
 * screen may lead anywhere but the prescription.
 */

function sequence({ safe = true, ...overrides } = {}) {
  return {
    source_text: "Paracetamol, one tablet, twice a day",
    segments: safe
      ? [
          {
            token: "paracetamol",
            match: "gloss",
            clips: [
              {
                gloss: "PARACETAMOL",
                video_url: "/media/clips/paracetamol.webm",
                duration_ms: 800,
              },
            ],
          },
        ]
      : [],
    total_duration_ms: safe ? 800 : 0,
    fingerspelled_tokens: [],
    unavailable_tokens: [],
    omitted_tokens: [],
    blocking_tokens: safe ? [] : ["twice"],
    back_translation: safe ? ["PARACETAMOL"] : [],
    is_safe_to_show: safe,
    needs_confirmation: false,
    stitched_video_url: safe ? "/media/stitched/item.mp4" : null,
    ...overrides,
  };
}

function playlist({ safe = true, reference = "abc123XYZ_-def456ghi" } = {}) {
  return {
    reference,
    // One file for the whole prescription, only when everything can be signed.
    video_url: safe ? "/media/stitched/whole.mp4" : null,
    items: [
      {
        position: 1,
        medicine: "Paracetamol",
        dosage: "one tablet",
        frequency: "twice a day",
        instruction: "Paracetamol, one tablet, twice a day",
        caption: "Paracetamol, taabolet baako, da biara mprenu",
        caption_language: "tw",
        caption_provider: "khaya",
        sequence: sequence({ safe }),
      },
    ],
    is_fully_signable: safe,
    unsignable_positions: safe ? [] : [1],
  };
}

beforeEach(() => {
  issuePrescription.mockResolvedValue(playlist());
  fetchPlaylist.mockResolvedValue(playlist());
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  vi.stubGlobal("navigator", { ...navigator, vibrate: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function fillOneMedicine() {
  await userEvent.type(screen.getByTestId("medicine-0"), "Paracetamol");
  await userEvent.type(screen.getByTestId("dosage-0"), "one tablet");
  await userEvent.type(screen.getByTestId("frequency-0"), "twice a day");
}

describe("writing a prescription, FR 6.1", () => {
  it("sends the medicines in the order they were entered", async () => {
    render(<PrescriptionBuilder onLeave={() => {}} />);

    await fillOneMedicine();
    await userEvent.click(screen.getByTestId("add-medicine"));
    await userEvent.type(screen.getByTestId("medicine-1"), "Zinc");
    await userEvent.type(screen.getByTestId("dosage-1"), "one spoon");
    await userEvent.type(screen.getByTestId("frequency-1"), "once a day");
    await userEvent.click(screen.getByTestId("issue-prescription"));

    await waitFor(() => expect(issuePrescription).toHaveBeenCalled());
    expect(issuePrescription).toHaveBeenCalledWith([
      { medicine: "Paracetamol", dosage: "one tablet", frequency: "twice a day" },
      { medicine: "Zinc", dosage: "one spoon", frequency: "once a day" },
    ]);
  });

  it("refuses a row with a missing dosage and says which row", async () => {
    // The server rejects this too, but a 400 cannot say which row it was, and
    // the useful message is the one that arrives before the request.
    render(<PrescriptionBuilder onLeave={() => {}} />);

    await userEvent.type(screen.getByTestId("medicine-0"), "Paracetamol");
    await userEvent.click(screen.getByTestId("issue-prescription"));

    expect(screen.getByTestId("prescription-problem")).toHaveTextContent(
      "Medicine 1",
    );
    expect(issuePrescription).not.toHaveBeenCalled();
  });

  it("says so when the prescription could not be saved", async () => {
    issuePrescription.mockRejectedValue(new Error("network down"));
    render(<PrescriptionBuilder onLeave={() => {}} />);

    await fillOneMedicine();
    await userEvent.click(screen.getByTestId("issue-prescription"));

    await waitFor(() => {
      expect(screen.getByTestId("prescription-problem")).toBeInTheDocument();
    });
    // Still editable, with the typing intact, so the doctor retries rather
    // than re enters.
    expect(screen.getByTestId("medicine-0")).toHaveValue("Paracetamol");
  });
});

describe("the QR code, FR 6.3", () => {
  it("encodes a link containing only the opaque reference", async () => {
    render(<PrescriptionBuilder onLeave={() => {}} />);

    await fillOneMedicine();
    await userEvent.click(screen.getByTestId("issue-prescription"));

    await waitFor(() => expect(screen.getByTestId("qr-url")).toBeInTheDocument());

    const url = screen.getByTestId("qr-url").textContent;
    expect(url).toContain("/p/abc123XYZ_-def456ghi");
    // FR 6.4. Nothing in the link identifies the patient or their visit.
    for (const forbidden of ["name", "patient", "visit", "transcript"]) {
      expect(url.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("draws a scannable image", async () => {
    render(<PrescriptionBuilder onLeave={() => {}} />);

    await fillOneMedicine();
    await userEvent.click(screen.getByTestId("issue-prescription"));

    await waitFor(() => expect(screen.getByTestId("qr-image")).toBeInTheDocument());
    expect(screen.getByTestId("qr-image").getAttribute("src")).toMatch(
      /^data:image\/png;base64,/,
    );
  });

  it("still shows the link as text if the code cannot be drawn", async () => {
    // Losing the QR must not lose the prescription: the link can be typed.
    render(<PrescriptionBuilder onLeave={() => {}} />);

    await fillOneMedicine();
    await userEvent.click(screen.getByTestId("issue-prescription"));

    await waitFor(() => expect(screen.getByTestId("qr-url")).toBeInTheDocument());
    expect(screen.getByTestId("qr-url")).toHaveTextContent("/p/");
  });

  it("builds the same path the router reads back", async () => {
    // The encoder and the reader are the pair that has to agree. If they
    // drift, every QR code already printed stops resolving, and nothing in
    // the app would report it.
    const reference = "abc123XYZ_-def456ghi";
    const url = playlistUrl(reference, "https://hospital.example");

    expect(referenceFromPath(new URL(url).pathname)).toBe(reference);
  });
});

describe("an instruction that cannot be signed", () => {
  it("warns the doctor before they hand the code over", async () => {
    // The reason the playlist is returned at issue time at all. Someone has to
    // explain that medicine another way, and they can only arrange it while
    // the patient is still in the room.
    issuePrescription.mockResolvedValue(playlist({ safe: false }));
    render(<PrescriptionBuilder onLeave={() => {}} />);

    await fillOneMedicine();
    await userEvent.click(screen.getByTestId("issue-prescription"));

    await waitFor(() => {
      expect(screen.getByTestId("not-fully-signable")).toBeInTheDocument();
    });
    expect(screen.getByTestId("not-fully-signable")).toHaveTextContent("Medicine 1");
  });

  it("is refused whole rather than shown without its dosage", async () => {
    // ADR 033 in the place it matters most. A prescription rendered without
    // its frequency is the difference between one tablet and four.
    fetchPlaylist.mockResolvedValue(playlist({ safe: false }));
    render(<PrescriptionPlayback reference="abc123XYZ_-def456ghi" />);

    await waitFor(() => {
      expect(screen.getByTestId("playlist-refused-1")).toBeInTheDocument();
    });
    expect(document.querySelector("video")).toBeNull();
  });

  it("tells the patient too, not only the doctor", async () => {
    fetchPlaylist.mockResolvedValue(playlist({ safe: false }));
    render(<PrescriptionPlayback reference="abc123XYZ_-def456ghi" />);

    await waitFor(() => {
      expect(screen.getByTestId("playback-incomplete")).toBeInTheDocument();
    });
  });

  it("still shows the dosage as text when the signs are refused", async () => {
    // The words are the fallback. Refusing the signs must not also withhold
    // the instruction from a pharmacist or a family member who can read it.
    fetchPlaylist.mockResolvedValue(playlist({ safe: false }));
    render(<PrescriptionPlayback reference="abc123XYZ_-def456ghi" />);

    await waitFor(() => {
      expect(screen.getByTestId("playlist-dosage-1")).toHaveTextContent("one tablet");
    });
    expect(screen.getByTestId("playlist-frequency-1")).toHaveTextContent("twice a day");
  });
});

describe("replaying a prescription, FR 6.2", () => {
  it("renders from the reference alone, with no session", async () => {
    render(<PrescriptionPlayback reference="abc123XYZ_-def456ghi" />);

    await waitFor(() => {
      expect(screen.getByTestId("prescription-playback")).toBeInTheDocument();
    });
    expect(screen.getByTestId("playlist-dosage-1")).toHaveTextContent("one tablet");
  });

  it("pulls every clip into the cache rather than waiting for first play", async () => {
    // FR 6.2. The service worker caches a clip when it is played, so a patient
    // who walks out without pressing play would have nothing saved and no way
    // to know. The fetching is done while they are still on the hospital
    // connection.
    render(<PrescriptionPlayback reference="abc123XYZ_-def456ghi" />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/media/clips/paracetamol.webm",
        expect.objectContaining({ cache: "reload" }),
      );
    });
  });

  it("reports how many clips were saved rather than claiming all of them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<PrescriptionBuilder onLeave={() => {}} />);

    await fillOneMedicine();
    await userEvent.click(screen.getByTestId("issue-prescription"));

    // The count, not the wording: what matters is that a failure is reported
    // as a partial save rather than as success. Matched loosely so adding a
    // clip to the fixture does not break the assertion it is not about.
    await waitFor(() => {
      expect(screen.getByTestId("offline-status")).toHaveTextContent(
        /Saved 0 of \d+ sign clips/,
      );
    });
  });

  it("says the link did not open rather than hanging", async () => {
    fetchPlaylist.mockRejectedValue(new Error("not found"));
    render(<PrescriptionPlayback reference="nope" />);

    await waitFor(() => {
      expect(screen.getByTestId("playback-failed")).toBeInTheDocument();
    });
  });

  it("does not take the screen down on a malformed response", async () => {
    // The same lesson as the alerts fetch: a catch handles the server failing,
    // not the server answering wrongly, and those are different failures.
    fetchPlaylist.mockResolvedValue({ reference: "x", items: "not-a-list" });
    render(<PrescriptionPlayback reference="x" />);

    await waitFor(() => {
      expect(screen.getByTestId("playback-failed")).toBeInTheDocument();
    });
  });
});

describe("the caption, FR 6.1", () => {
  it("is not presented as a translation when the stub produced it", async () => {
    // ADR 011. The stub returns its input unchanged, so the caption is English
    // text under a lang="tw" attribute. Caught by an end to end check against
    // the dev server, where the payload came back labelled Twi and reading
    // English, which is the exact failure ADR 011 was written for.
    fetchPlaylist.mockResolvedValue({
      ...playlist(),
      items: [{ ...playlist().items[0], caption_provider: "stub" }],
    });
    render(<PrescriptionPlayback reference="abc123XYZ_-def456ghi" />);

    await waitFor(() => {
      expect(screen.getByTestId("playlist-untranslated-1")).toBeInTheDocument();
    });
  });

  it("says nothing extra when a real translation produced it", async () => {
    render(<PrescriptionPlayback reference="abc123XYZ_-def456ghi" />);

    await waitFor(() => {
      expect(screen.getByTestId("playlist-caption-1")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("playlist-untranslated-1"),
    ).not.toBeInTheDocument();
  });

  it("is marked with the language it is actually in", async () => {
    // When translation was unreachable at issue time the caption is English,
    // and saying so is better than presenting English as Twi.
    fetchPlaylist.mockResolvedValue({
      ...playlist(),
      items: [
        {
          ...playlist().items[0],
          caption: "Paracetamol, one tablet, twice a day",
          caption_language: "en",
        },
      ],
    });
    render(<PrescriptionPlayback reference="abc123XYZ_-def456ghi" />);

    await waitFor(() => {
      expect(screen.getByTestId("playlist-caption-1")).toHaveAttribute("lang", "en");
    });
  });
});

describe("reading a reference out of the path", () => {
  it("recognises a prescription link", () => {
    expect(referenceFromPath("/p/abc123XYZ_-def")).toBe("abc123XYZ_-def");
    expect(referenceFromPath("/p/abc123XYZ_-def/")).toBe("abc123XYZ_-def");
  });

  it("recognises nothing else", () => {
    // A false positive here would replace the consultation screen with a
    // prescription lookup, which is the whole app gone for the doctor.
    for (const path of ["/", "/p", "/p/", "/patient/1", "/p/a/b", "/prescription"]) {
      expect(referenceFromPath(path)).toBeNull();
    }
  });

  it("rejects a reference containing characters a real one cannot have", () => {
    // References are url safe base64. Anything else is a probe or a typo, and
    // passing it through would put attacker controlled text into a request path.
    for (const path of ["/p/../../etc/passwd", "/p/a%2Fb", "/p/a b", "/p/<script>"]) {
      expect(referenceFromPath(path)).toBeNull();
    }
  });
});

describe("printing for the patient, FR 6.1", () => {
  it("prints the medicines as words, not only the code", async () => {
    // On paper there are no videos, so the words carry the whole
    // prescription. A printed page showing only a QR code is useless to the
    // pharmacist and to a patient whose phone has a flat battery.
    render(<PrescriptionBuilder onLeave={() => {}} />);

    await fillOneMedicine();
    await userEvent.click(screen.getByTestId("issue-prescription"));

    await waitFor(() => expect(screen.getByTestId("qr-image")).toBeInTheDocument());

    const slip = document.querySelector(".print-only");
    expect(slip).not.toBeNull();
    expect(slip.textContent).toContain("Paracetamol");
    expect(slip.textContent).toContain("one tablet");
    expect(slip.textContent).toContain("twice a day");
  });

  it("prints the instruction to explain a refused medicine in person", async () => {
    // The one line on the page someone has to act on, so it must survive the
    // print stylesheet rather than being hidden with the rest of the chrome.
    issuePrescription.mockResolvedValue(playlist({ safe: false }));
    render(<PrescriptionBuilder onLeave={() => {}} />);

    await fillOneMedicine();
    await userEvent.click(screen.getByTestId("issue-prescription"));

    await waitFor(() => {
      expect(screen.getByTestId("not-fully-signable")).toBeInTheDocument();
    });
    expect(document.querySelector(".print-only").textContent).toContain(
      "explained in person",
    );
  });

  it("asks the browser to print", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    render(<PrescriptionBuilder onLeave={() => {}} />);

    await fillOneMedicine();
    await userEvent.click(screen.getByTestId("issue-prescription"));

    await waitFor(() =>
      expect(screen.getByTestId("print-prescription")).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByTestId("print-prescription"));

    expect(print).toHaveBeenCalled();
  });
});

describe("saving to the patient's phone, FR 6.2 and ADR 046", () => {
  it("offers one file for the whole prescription", async () => {
    // A file in the gallery outlives the browser cache, the app, and the
    // hospital. It plays in whatever video player the phone came with.
    render(<PrescriptionPlayback reference="abc123XYZ_-def456ghi" />);

    await waitFor(() => {
      expect(screen.getByTestId("save-whole")).toBeInTheDocument();
    });

    const link = screen.getByTestId("save-whole");
    expect(link).toHaveAttribute("href", "/media/stitched/whole.mp4");
    // Named for what it is. The reference means nothing to the patient.
    expect(link).toHaveAttribute("download", "my-prescription.mp4");
  });

  it("offers no single file when one medicine was refused", async () => {
    // A single file cannot say that a medicine is missing from it, so it would
    // sit in the gallery looking complete. ADR 033 applied to a download.
    fetchPlaylist.mockResolvedValue({
      ...playlist({ safe: false }),
      items: [
        playlist().items[0],
        { ...playlist({ safe: false }).items[0], position: 2, medicine: "Zinc" },
      ],
      video_url: null,
      is_fully_signable: false,
      unsignable_positions: [2],
    });
    render(<PrescriptionPlayback reference="abc123XYZ_-def456ghi" />);

    await waitFor(() => {
      expect(screen.getByTestId("save-item-1")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("save-whole")).not.toBeInTheDocument();
    // The refused one has nothing to save, visibly.
    expect(screen.queryByTestId("save-item-2")).not.toBeInTheDocument();
  });

  it("says there is nothing to save rather than offering an empty download", async () => {
    fetchPlaylist.mockResolvedValue(playlist({ safe: false }));
    render(<PrescriptionPlayback reference="abc123XYZ_-def456ghi" />);

    await waitFor(() => {
      expect(screen.getByTestId("nothing-to-save")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("save-whole")).not.toBeInTheDocument();
  });

  it("tells the patient how to find the page again", async () => {
    render(<PrescriptionPlayback reference="abc123XYZ_-def456ghi" />);

    await waitFor(() => {
      expect(screen.getByTestId("save-prescription")).toHaveTextContent(
        "Add to Home screen",
      );
    });
  });
});
