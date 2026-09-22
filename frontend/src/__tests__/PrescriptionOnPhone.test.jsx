import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PatientDevice from "../components/PatientDevice.jsx";
import PrescriptionBuilder from "../components/PrescriptionBuilder.jsx";
import { fetchCriticalAlerts, fetchEmergencySpeech } from "../api/clips.js";
import { fetchPlaylist, issuePrescription } from "../api/prescriptions.js";
import { loadGuestResume, saveGuestResume } from "../pairing/resume.js";

vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchBodyLocations: vi.fn().mockResolvedValue([]),
    fetchCriticalAlerts: vi.fn(),
    fetchEmergencySpeech: vi.fn(),
  };
});
vi.mock("../api/prescriptions.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchPlaylist: vi.fn(),
    issuePrescription: vi.fn(),
    cachePlaylistClips: vi.fn().mockResolvedValue({ saved: 1, total: 1 }),
  };
});

/**
 * The doctor issues a prescription in a paired visit, and it is on the
 * patient's own phone: the medicines to play, the videos to save, and the QR
 * code. The phone is sent only the reference; everything else is fetched.
 */

const REFERENCE = "abc123XYZ_-def456ghi";
const OTHER = "zzz999AAA_-ghi789jkl";

function playlist(reference = REFERENCE) {
  return {
    reference,
    video_url: "/media/stitched/whole.mp4",
    is_fully_signable: true,
    unsignable_positions: [],
    items: [
      {
        position: 1,
        medicine: "Paracetamol",
        label: "Paracetamol",
        image_url: null,
        dosage: "one tablet",
        frequency: "twice a day",
        video_url: "/media/stitched/item.mp4",
        caption: "Paracetamol, taabolet baako",
        caption_language: "tw",
        caption_provider: "khaya",
        sequence: {
          source_text: "Paracetamol, one tablet, twice a day",
          segments: [],
          total_duration_ms: 0,
          stitched_video_url: null,
          fingerspelled_tokens: [],
          unavailable_tokens: [],
          omitted_tokens: [],
          blocking_tokens: [],
          back_translation: [],
          is_safe_to_show: true,
          needs_confirmation: false,
        },
      },
    ],
  };
}

const send = vi.fn();
function channel(lastMessage = null) {
  return { send, lastMessage, state: "connected" };
}

function mount(props = {}, first = null) {
  const view = render(<PatientDevice channel={channel(first)} path="literate" {...props} />);
  return {
    ...view,
    hear(message) {
      view.rerender(<PatientDevice channel={channel(message)} path="literate" {...props} />);
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  fetchPlaylist.mockImplementation(async (reference) => playlist(reference));
  fetchCriticalAlerts.mockResolvedValue([]);
  fetchEmergencySpeech.mockResolvedValue({ phrases: [], pending_review: [] });
  saveGuestResume({ token: "k3Jx9_-Qm2LpV8wZr5TnYA" });
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("the doctor issuing a prescription to the phone", () => {
  it("opens the medicines on the phone, from the reference alone", async () => {
    const view = mount();
    await screen.findByTestId("speak-to-doctor");

    view.hear({ type: "path", path: "literate", prescription: REFERENCE });

    expect(await screen.findByTestId("prescription-guest")).toBeInTheDocument();
    await waitFor(() => expect(fetchPlaylist).toHaveBeenCalledWith(REFERENCE));
    expect(await screen.findByTestId("prescription-playback")).toBeInTheDocument();
  });

  it("shows the medicines and their videos, and offers to save them", async () => {
    mount({}, { type: "path", path: "literate", prescription: REFERENCE });

    expect(await screen.findByTestId("playlist-caption-1")).toHaveTextContent(
      "Paracetamol, taabolet baako",
    );
    expect(screen.getByTestId("save-whole")).toBeInTheDocument();
  });

  it("shows the QR code, to open the same medicines on another phone", async () => {
    mount({}, { type: "path", path: "literate", prescription: REFERENCE });

    expect(await screen.findByTestId("qr-image")).toBeInTheDocument();
    expect(screen.getByTestId("qr-url")).toHaveTextContent(`/p/${REFERENCE}`);
  });

  it("is told by whichever message came last, since the connection keeps only the newest", async () => {
    const view = mount();
    await screen.findByTestId("speak-to-doctor");

    view.hear({ type: "question", path: "literate", prescription: REFERENCE, result: {} });

    expect(await screen.findByTestId("prescription-guest")).toBeInTheDocument();
  });

  it("is remembered, so a reload comes back to the medicines", async () => {
    const view = mount();
    await screen.findByTestId("speak-to-doctor");

    view.hear({ type: "path", path: "literate", prescription: REFERENCE });
    await screen.findByTestId("prescription-guest");

    expect(loadGuestResume()).toMatchObject({ prescription: REFERENCE, prescriptionOpen: true });
  });

  it("opens on the medicines after a reload when that is where the patient was", async () => {
    render(
      <PatientDevice
        channel={channel()}
        path="literate"
        prescription={REFERENCE}
        prescriptionOpen
        offline
      />,
    );

    expect(await screen.findByTestId("prescription-guest")).toBeInTheDocument();
    expect(screen.getByTestId("patient-reconnecting-banner")).toBeInTheDocument();
  });

  it("opens on the conversation after a reload when the patient had gone back to it", async () => {
    render(
      <PatientDevice channel={channel()} path="literate" prescription={REFERENCE} />,
    );

    expect(await screen.findByTestId("speak-to-doctor")).toBeInTheDocument();
    expect(screen.getByTestId("medicines-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("prescription-guest")).not.toBeInTheDocument();
  });

  it("believes only something shaped like a reference", async () => {
    const view = mount();
    await screen.findByTestId("speak-to-doctor");

    view.hear({ type: "path", path: "literate", prescription: "../../etc/passwd" });

    expect(screen.queryByTestId("prescription-guest")).not.toBeInTheDocument();
    expect(fetchPlaylist).not.toHaveBeenCalled();
  });
});

describe("going back to the conversation, and returning to the medicines", () => {
  async function onTheMedicines() {
    const view = mount();
    await screen.findByTestId("speak-to-doctor");
    view.hear({ type: "path", path: "literate", prescription: REFERENCE });
    await screen.findByTestId("prescription-guest");
    return view;
  }

  it("goes back to the conversation, with a bar to get to the medicines again", async () => {
    await onTheMedicines();

    await userEvent.click(screen.getByTestId("medicines-back"));

    expect(await screen.findByTestId("speak-to-doctor")).toBeInTheDocument();
    expect(screen.getByTestId("medicines-bar")).toHaveTextContent(/your medicines are ready/i);
  });

  it("comes back to the medicines from the bar", async () => {
    await onTheMedicines();
    await userEvent.click(screen.getByTestId("medicines-back"));

    await userEvent.click(await screen.findByTestId("view-medicines"));

    expect(await screen.findByTestId("prescription-guest")).toBeInTheDocument();
    expect(loadGuestResume().prescriptionOpen).toBe(true);
  });

  it("remembers having gone back", async () => {
    await onTheMedicines();

    await userEvent.click(screen.getByTestId("medicines-back"));

    expect(loadGuestResume().prescriptionOpen).toBe(false);
  });

  it("is not pulled back to the medicines by the same prescription sent again", async () => {
    // Sent every time the connection comes back, which is often.
    const view = await onTheMedicines();
    await userEvent.click(screen.getByTestId("medicines-back"));
    await screen.findByTestId("speak-to-doctor");

    view.hear({ type: "path", path: "literate", prescription: REFERENCE, resent: true });

    expect(screen.queryByTestId("prescription-guest")).not.toBeInTheDocument();
    expect(screen.getByTestId("medicines-bar")).toBeInTheDocument();
  });

  it("is taken to a new prescription, which is a different one", async () => {
    const view = await onTheMedicines();
    await userEvent.click(screen.getByTestId("medicines-back"));

    view.hear({ type: "path", path: "literate", prescription: OTHER });

    expect(await screen.findByTestId("prescription-guest")).toBeInTheDocument();
    await waitFor(() => expect(fetchPlaylist).toHaveBeenCalledWith(OTHER));
  });

  it("is not taken away by a message that says nothing about it", async () => {
    const view = await onTheMedicines();

    view.hear({ type: "speaking", status: "playing" });
    view.hear({ type: "path", path: "literate" });

    expect(screen.getByTestId("prescription-guest")).toBeInTheDocument();
  });
});

describe("the medicines and everything else on the phone", () => {
  it("gives way to emergency mode, and is there when it is over", async () => {
    const view = mount(
      {},
      { type: "path", path: "literate", prescription: REFERENCE },
    );
    await screen.findByTestId("prescription-guest");

    view.hear({ type: "emergency", emergency: true, path: "literate", prescription: REFERENCE });
    expect(await screen.findByTestId("emergency-triage-guest")).toBeInTheDocument();
    expect(screen.queryByTestId("medicines-bar")).not.toBeInTheDocument();

    view.hear({ type: "path", path: "literate", emergency: false, prescription: REFERENCE });
    expect(await screen.findByTestId("prescription-guest")).toBeInTheDocument();
  });

  it("stays when the consultation ends, saying so, because it is the patient's to keep", async () => {
    const view = mount({}, { type: "path", path: "literate", prescription: REFERENCE });
    await screen.findByTestId("prescription-guest");

    view.hear({ type: "ended" });

    expect(await screen.findByTestId("medicines-after-visit")).toHaveTextContent(/has ended/i);
    expect(screen.getByTestId("prescription-guest")).toBeInTheDocument();
  });

  it("is offered on the ended screen too", async () => {
    const view = mount({}, { type: "path", path: "literate", prescription: REFERENCE });
    await screen.findByTestId("prescription-guest");
    view.hear({ type: "ended" });
    await userEvent.click(await screen.findByTestId("medicines-back"));

    expect(await screen.findByTestId("pairing-ended")).toBeInTheDocument();
    expect(screen.getByTestId("view-medicines")).toBeInTheDocument();
  });

  it("is offered before the doctor has chosen a path as well", async () => {
    render(<PatientDevice channel={channel()} prescription={REFERENCE} />);

    expect(await screen.findByTestId("patient-waiting")).toBeInTheDocument();
    expect(screen.getByTestId("medicines-bar")).toBeInTheDocument();
  });

  it("offers nothing when there is no prescription", async () => {
    mount();

    expect(await screen.findByTestId("speak-to-doctor")).toBeInTheDocument();
    expect(screen.queryByTestId("medicines-bar")).not.toBeInTheDocument();
  });

  it("says so when the medicines cannot be fetched", async () => {
    fetchPlaylist.mockRejectedValue(new Error("offline"));
    mount({}, { type: "path", path: "literate", prescription: REFERENCE });

    expect(await screen.findByTestId("playback-failed")).toBeInTheDocument();
    expect(screen.getByTestId("medicines-back")).toBeInTheDocument();
  });
});

describe("the doctor's prescription screen, in a paired visit", () => {
  async function issue(props) {
    issuePrescription.mockResolvedValue(playlist());
    const view = render(<PrescriptionBuilder onLeave={() => {}} {...props} />);
    await userEvent.type(screen.getByTestId("medicine-0"), "Paracetamol");
    await userEvent.click(screen.getByTestId("issue-prescription"));
    await screen.findByTestId("prescription-issued");
    return view;
  }

  it("gives the reference to the phone once it is issued", async () => {
    const onIssued = vi.fn();

    await issue({ onIssued, patientPhone: "connected" });

    expect(onIssued).toHaveBeenCalledWith(REFERENCE);
  });

  it("tells the doctor it is on the patient's phone", async () => {
    await issue({ onIssued: vi.fn(), patientPhone: "connected" });

    expect(screen.getByTestId("issued-on-phone")).toHaveTextContent(/on the patient's phone/i);
  });

  it("tells the doctor when the phone is not there, and that the code still works", async () => {
    await issue({ onIssued: vi.fn(), patientPhone: "away" });

    expect(screen.getByTestId("issued-phone-away")).toHaveTextContent(/not connected/i);
    expect(await screen.findByTestId("qr-image")).toBeInTheDocument();
  });

  it("says nothing of a phone on a shared device, and gives nothing to one", async () => {
    await issue({});

    expect(screen.queryByTestId("issued-on-phone")).not.toBeInTheDocument();
    expect(screen.queryByTestId("issued-phone-away")).not.toBeInTheDocument();
    expect(await screen.findByTestId("qr-image")).toBeInTheDocument();
  });

  it("gives it to the phone again when the doctor's page is reloaded on the issued screen", async () => {
    localStorage.setItem("tiemeghana.prescription", REFERENCE);
    const onIssued = vi.fn();

    render(<PrescriptionBuilder onLeave={() => {}} onIssued={onIssued} patientPhone="connected" />);

    await screen.findByTestId("prescription-issued");
    expect(onIssued).toHaveBeenCalledWith(REFERENCE);
  });

  it("does not give the phone one that was never issued", async () => {
    const onIssued = vi.fn();
    render(<PrescriptionBuilder onLeave={() => {}} onIssued={onIssued} patientPhone="connected" />);

    await act(async () => {});

    expect(onIssued).not.toHaveBeenCalled();
  });
});
