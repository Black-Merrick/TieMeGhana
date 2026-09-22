import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App.jsx";
import { fetchClipByGloss } from "../api/clips.js";
import { fetchBodyLocations, fetchCriticalAlerts } from "../api/clips.js";
import { fetchPlaylist } from "../api/prescriptions.js";
import { saveDoctorRole } from "../pairing/role.js";
import { LiteracyPath, saveLiteracyPath } from "../visit/visit.js";
import { forgetYesNoSigns } from "../hooks/useYesNoSigns.js";

vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchClipByGloss: vi.fn(),
    fetchBodyLocations: vi.fn(),
    fetchCriticalAlerts: vi.fn(),
  };
});

vi.mock("../api/prescriptions.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchPlaylist: vi.fn() };
});

beforeEach(() => {
  // The YES and NO signs are fetched once and shared, so one case's
  // clips must not still be there for the next.
  forgetYesNoSigns();
  localStorage.clear();
  // Every test below is about a doctor's device. The first screen a device
  // that has not been chosen sees is covered in AppRole.test.jsx.
  saveDoctorRole();
  // Every test starts on the app's own route. A leaked prescription path would
  // replace the whole consultation screen and fail in a way that looks
  // unrelated to whichever test left it behind.
  window.history.pushState({}, "", "/");
  fetchPlaylist.mockResolvedValue({
    reference: "ref",
    items: [],
    is_fully_signable: true,
    unsignable_positions: [],
  });
  fetchClipByGloss.mockResolvedValue({
    gloss: "CAN_YOU_READ_AND_WRITE",
    kind: "prompt",
    video_url: "/media/clips/prompt.webm",
    duration_ms: 3000,
  });
  fetchBodyLocations.mockResolvedValue([]);
  fetchCriticalAlerts.mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", database: "ok", migrations: "ok" }),
    }),
  );
});

/**
 * Answer the first question a visit asks, "does this patient have their own
 * phone?", with No, which is the shared device flow every test below this one
 * was written for. Waits for the literacy check it leads to, so a caller can go
 * straight on to answering it.
 */
async function shareThisDevice(user = userEvent.setup()) {
  await waitFor(() => screen.getByTestId("device-choice"));
  await user.click(
    within(screen.getByTestId("device-choice")).getByTestId("choice-no"),
  );
  await waitFor(() => screen.getByTestId("literacy-check"));
  return user;
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("connection status", () => {
  it("reports a connected system when the health check succeeds", async () => {
    render(<App />);

    // The bar shows signal bars rather than the sentence now, so the wording
    // is asserted where it still lives: the accessible name, which is what a
    // screen reader reads and what the tooltip shows.
    await waitFor(() => {
      expect(screen.getByTestId("connection-status")).toHaveAccessibleName(
        "Connected to the hospital system",
      );
    });
    expect(screen.getByTestId("connection-status")).toHaveAttribute(
      "data-state",
      "connected",
    );
  });

  it("falls back to an offline message when the API is unreachable", async () => {
    // NFR 5, the app must stay usable under intermittent connectivity, so a
    // failed health check has to degrade visibly rather than hang on checking.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("connection-status")).toHaveAccessibleName(
        "Offline, cached content only",
      );
    });
    // Struck through, so the state is a shape rather than a colour.
    expect(
      screen.getByTestId("connection-status").querySelector(".signal__slash"),
    ).not.toBeNull();
  });
});

describe("routing by literacy path", () => {
  it("asks the literacy question before anything else", async () => {
    // FR 2.1. Nothing about the consultation may start until the patient has
    // been routed, because assuming either path breaks the app for the people
    // it exists to serve.
    render(<App />);
    await shareThisDevice();

    expect(screen.getByTestId("literacy-check")).toBeInTheDocument();
    expect(screen.queryByLabelText(/message for the patient/i)).not.toBeInTheDocument();
  });

  it("asks whether the patient has their own phone before the literacy question", async () => {
    // ADR 053. The choice decides whether there is a second device to pair,
    // so it comes first, and nothing about the consultation may start under it.
    render(<App />);

    await waitFor(() => screen.getByTestId("device-choice"));
    expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/message for the patient/i)).not.toBeInTheDocument();
  });

  it("shows the captioning flow to a patient who reads", async () => {
    saveLiteracyPath(LiteracyPath.LITERATE);

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /send to patient/i }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ask-where-it-hurts")).not.toBeInTheDocument();
  });

  it("never shows typed captions to a patient who does not read", async () => {
    // The single most important routing rule in the app. Falling through to
    // captions here would silently break accessibility for exactly the
    // patients the literacy check exists to protect.
    saveLiteracyPath(LiteracyPath.GUIDED);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("ask-where-it-hurts")).toBeInTheDocument();
    });
    // The doctor asks in their own words on both paths, so the distinguishing
    // thing is the patient's side: Guided Interrogation offers them yes or no
    // and never a caption to read back or a field to type into.
    expect(
      screen.getByRole("button", { name: /ask the patient/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /send to patient/i }),
    ).not.toBeInTheDocument();
  });

  it("routes straight after the patient answers, without a reload", async () => {
    const user = userEvent.setup();
    render(<App />);
    await shareThisDevice(user);

    await user.click(screen.getByTestId("choice-yes"));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /send to patient/i }),
      ).toBeInTheDocument();
    });
  });
});

describe("the visit bar", () => {
  it("keeps the patient's path visible rather than in a settings menu", async () => {
    // Section 4.1, Visibility.
    saveLiteracyPath(LiteracyPath.GUIDED);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("literacy-path")).toHaveTextContent(
        "Guided Interrogation",
      );
    });
  });

  it("shows no path indicator before the patient has answered", async () => {
    render(<App />);
    await shareThisDevice();

    expect(screen.queryByTestId("literacy-path")).not.toBeInTheDocument();
  });

  it("asks the next patient fresh when the visit is ended", async () => {
    // The control that stops one patient's literacy answer being applied to
    // the next person handed the same device.
    saveLiteracyPath(LiteracyPath.LITERATE);
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => screen.getByTestId("new-patient"));
    await user.click(screen.getByTestId("new-patient"));

    // Back to the very first question, not to the literacy check: the next
    // patient may have a phone the last one did not.
    await shareThisDevice(user);
    expect(
      screen.queryByRole("button", { name: /send to patient/i }),
    ).not.toBeInTheDocument();
  });
});


describe("the spoken output language", () => {
  it("keeps the listener's language on screen, not in a settings menu", async () => {
    // Section 4.1 names this specifically as something that must always be
    // visible, because it decides whether the doctor understands anything.
    saveLiteracyPath(LiteracyPath.GUIDED);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("output-language")).toBeInTheDocument();
    });
  });

  it("defaults to English", async () => {
    saveLiteracyPath(LiteracyPath.GUIDED);

    render(<App />);

    await waitFor(() => screen.getByTestId("output-language"));
    const group = within(screen.getByTestId("output-language"));
    expect(group.getByRole("radio", { name: /english/i })).toBeChecked();
  });

  it("keeps the choice for the rest of the visit", async () => {
    // FR 3.4 sets it once per session, so it has to survive a reload rather
    // than being asked again for every answer.
    saveLiteracyPath(LiteracyPath.GUIDED);
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    await waitFor(() => screen.getByTestId("output-language"));
    await user.click(
      within(screen.getByTestId("output-language")).getByRole("radio", {
        name: /twi/i,
      }),
    );
    unmount();

    render(<App />);
    await waitFor(() => screen.getByTestId("output-language"));
    expect(
      within(screen.getByTestId("output-language")).getByRole("radio", {
        name: /twi/i,
      }),
    ).toBeChecked();
  });

  it("shows no language toggle before a patient has been routed", async () => {
    render(<App />);
    await shareThisDevice();

    expect(screen.queryByTestId("output-language")).not.toBeInTheDocument();
  });
});


describe("the transcript and the shared device", () => {
  it("destroys the record when the visit ends", async () => {
    // The most important privacy property in the app. This device is handed
    // from one patient to the next, and these consultations are about
    // pregnancy, sexually transmitted infections, and HIV status. Leaving one
    // behind for a stranger to read is the precise harm the project exists to
    // prevent. ADR 026.
    const { appendEntry, Direction, readTranscript } = await import(
      "../transcript/transcript.js"
    );
    saveLiteracyPath(LiteracyPath.GUIDED);
    appendEntry({ direction: Direction.TO_DOCTOR, text: "I am HIV positive" });

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => screen.getByTestId("new-patient"));
    await user.click(screen.getByTestId("new-patient"));

    expect(readTranscript()).toEqual([]);
  });

  it("shows the next patient nothing from the previous consultation", async () => {
    const { appendEntry, Direction } = await import(
      "../transcript/transcript.js"
    );
    saveLiteracyPath(LiteracyPath.GUIDED);
    appendEntry({ direction: Direction.TO_DOCTOR, text: "I am HIV positive" });

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => screen.getByTestId("new-patient"));
    await user.click(screen.getByTestId("new-patient"));

    await shareThisDevice(user);
    expect(screen.queryByText(/HIV positive/i)).not.toBeInTheDocument();
  });

  it("keeps the record across a reload within the same visit", async () => {
    // A patient who reloads mid consultation must not lose what has been said,
    // which is the other half of FR 4.2: stored on the device, and actually
    // stored rather than held in memory.
    const { appendEntry, Direction } = await import(
      "../transcript/transcript.js"
    );
    saveLiteracyPath(LiteracyPath.GUIDED);
    appendEntry({ direction: Direction.TO_DOCTOR, text: "Yes" });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("transcript-list")).toHaveTextContent("Yes");
    });
  });
});


describe("the exchange and the shared device", () => {
  it("does not leave the previous patient's question waiting for the next", async () => {
    // ADR 032 keeps the question across a reload, which makes it all the more
    // important that ending the visit removes it.
    const { saveCurrentExchange, loadCurrentExchange } = await import(
      "../consultation/currentExchange.js"
    );
    saveLiteracyPath(LiteracyPath.GUIDED);
    saveCurrentExchange({
      caption: {
        transcript: "Are you pregnant?",
        caption: "Wo yɛ nyinsɛn?",
        sequence: {
          segments: [],
          fingerspelled_tokens: [],
          unavailable_tokens: [],
          omitted_tokens: [],
          blocking_tokens: [],
          back_translation: [],
          is_safe_to_show: true,
          needs_confirmation: false,
          total_duration_ms: 0,
        },
      },
    });

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => screen.getByTestId("new-patient"));
    await user.click(screen.getByTestId("new-patient"));

    expect(loadCurrentExchange()).toBeNull();
  });
});

describe("emergency triage is reachable, FR 5", () => {
  it("can be entered before the literacy question has been answered", async () => {
    // The reason this sits outside the visit. FR 5 is for a patient who may
    // have arrived after an accident, and asking whether they read before
    // letting them say they cannot breathe would be the wrong order.
    // See ADR 040.
    render(<App />);

    await userEvent.click(screen.getByTestId("enter-emergency"));

    // Awaited because emergency triage is split out of the main bundle and
    // fetched on first use, so it arrives a tick after the tap.
    await waitFor(() => {
      expect(screen.getByTestId("emergency-triage")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument();
  });

  it("can be entered in the middle of a consultation", async () => {
    saveLiteracyPath(LiteracyPath.LITERATE);
    render(<App />);

    await userEvent.click(screen.getByTestId("enter-emergency"));

    await waitFor(() => {
      expect(screen.getByTestId("emergency-triage")).toBeInTheDocument();
    });
  });

  it("returns to where the patient was when emergency mode is left", async () => {
    // A patient who taps Emergency by mistake, or whose emergency is dealt
    // with, must not lose the consultation they were part way through.
    saveLiteracyPath(LiteracyPath.LITERATE);
    render(<App />);

    await userEvent.click(screen.getByTestId("enter-emergency"));
    await waitFor(() => screen.getByTestId("leave-emergency"));
    await userEvent.click(screen.getByTestId("leave-emergency"));

    expect(screen.queryByTestId("emergency-triage")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/message for the patient/i)).toBeInTheDocument();
  });

  it("hides the entry button while already in emergency mode", async () => {
    render(<App />);

    await userEvent.click(screen.getByTestId("enter-emergency"));

    await waitFor(() => {
      expect(screen.queryByTestId("enter-emergency")).not.toBeInTheDocument();
    });
  });
});

describe("a scanned prescription link, FR 6.3 and FR 6.4", () => {
  it("opens the prescription and nothing else", async () => {
    // This is the patient's own phone at home, not a hospital device. It must
    // not be shown a consultation shell, a literacy question, or any route
    // back into a visit.
    window.history.pushState({}, "", "/p/abc123XYZ_-def");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("prescription-playback")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument();
    expect(screen.queryByTestId("enter-emergency")).not.toBeInTheDocument();
    expect(screen.queryByTestId("new-patient")).not.toBeInTheDocument();
    expect(screen.queryByTestId("connection-status")).not.toBeInTheDocument();
  });

  it("opens the prescription even mid consultation on the same device", async () => {
    // The reference in the URL decides, not what happens to be in
    // localStorage. A patient scanning at home may be on a phone that once
    // ran a consultation.
    saveLiteracyPath(LiteracyPath.LITERATE);
    window.history.pushState({}, "", "/p/abc123XYZ_-def");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("prescription-playback")).toBeInTheDocument();
    });
  });

  it("does not check the hospital connection on the patient's phone", async () => {
    // FR 6.2 means this screen is expected to work offline. Telling the
    // patient the hospital system is unreachable would be alarming and
    // irrelevant.
    window.history.pushState({}, "", "/p/abc123XYZ_-def");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("prescription-playback")).toBeInTheDocument();
    });
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/health"),
      expect.anything(),
    );
  });
});

describe("joining a paired visit, ADR 053", () => {
  it("opens the join screen and nothing else", async () => {
    // The patient's own phone, reached by typing in a code rather than a QR
    // scan, but the same "nothing else in this app is wanted here" case as
    // a scanned prescription link above.
    window.history.pushState({}, "", "/join");

    render(<App />);

    expect(await screen.findByTestId("pairing-join-form")).toBeInTheDocument();
    expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument();
    expect(screen.queryByTestId("enter-emergency")).not.toBeInTheDocument();
    expect(screen.queryByTestId("new-patient")).not.toBeInTheDocument();
    expect(screen.queryByTestId("connection-status")).not.toBeInTheDocument();
  });

  it("opens the join screen even mid consultation on the same device", async () => {
    saveLiteracyPath(LiteracyPath.GUIDED);
    window.history.pushState({}, "", "/join");

    render(<App />);

    expect(await screen.findByTestId("pairing-join-form")).toBeInTheDocument();
  });

  it("does not check the hospital connection on the patient's phone", async () => {
    window.history.pushState({}, "", "/join");

    render(<App />);

    await screen.findByTestId("pairing-join-form");
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/health"),
      expect.anything(),
    );
  });
});

describe("the prescription builder, FR 6.1", () => {
  it("is offered once a visit is under way", async () => {
    saveLiteracyPath(LiteracyPath.LITERATE);
    render(<App />);

    await userEvent.click(screen.getByTestId("enter-prescription"));

    await waitFor(() => {
      expect(screen.getByTestId("prescription-builder")).toBeInTheDocument();
    });
  });

  it("is not offered before there is a patient", async () => {
    // Unlike emergency mode. A prescription is the last thing that happens in
    // a consultation, so there is always a visit by the time it is wanted, and
    // offering it first would put a doctor's form in front of a patient who
    // has not been asked anything yet.
    render(<App />);

    expect(screen.queryByTestId("enter-prescription")).not.toBeInTheDocument();
  });

  it("returns to the consultation when cancelled", async () => {
    saveLiteracyPath(LiteracyPath.LITERATE);
    render(<App />);

    await userEvent.click(screen.getByTestId("enter-prescription"));
    await waitFor(() => screen.getByTestId("leave-prescription"));
    await userEvent.click(screen.getByTestId("leave-prescription"));

    expect(screen.queryByTestId("prescription-builder")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/message for the patient/i)).toBeInTheDocument();
  });
});

describe("a database missing its migrations", () => {
  it("says so instead of leaving it to a 500 mid consultation", async () => {
    // The failure this exists for: a migration written but not applied. The
    // endpoint that touches the new column returns a 500 about a column nobody
    // has heard of, runserver printed its warning before the migration existed
    // and does not repeat it on reload, and the tests stay green because
    // pytest builds its database from scratch every run.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "ok",
          database: "ok",
          migrations: "pending",
          pending_migrations: ["prescriptions.0002_prescriptionitem_caption_provider"],
        }),
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("pending-migrations")).toBeInTheDocument();
    });
    expect(screen.getByTestId("pending-migrations")).toHaveTextContent(
      "manage.py migrate",
    );
  });

  it("stays quiet when the schema is up to date", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("connection-status")).toHaveAccessibleName(
        /Connected/,
      );
    });
    expect(screen.queryByTestId("pending-migrations")).not.toBeInTheDocument();
  });
});

describe("installing the app, NFR 5", () => {
  it("is offered before a patient has been asked anything", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("install-app")).toBeInTheDocument();
    });
  });

  it("is still offered during a consultation", async () => {
    // It used to appear only on the literacy screen, which meant it vanished
    // the moment a consultation started and could only be found again by
    // ending one. Installing is a one time action, so it lives in the bar.
    saveLiteracyPath(LiteracyPath.LITERATE);
    render(<App />);

    expect(screen.getByTestId("install-app")).toBeInTheDocument();
  });

  it("closes the instructions again", async () => {
    render(<App />);
    await waitFor(() => screen.getByTestId("install-app"));

    await userEvent.click(screen.getByTestId("install-app"));
    expect(screen.getByTestId("install-help")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("close-install-help"));
    expect(screen.queryByTestId("install-help")).not.toBeInTheDocument();
  });

  it("shows the browser's own dialog when the browser has one", async () => {
    render(<App />);
    await waitFor(() => screen.getByTestId("install-app"));

    const event = new Event("beforeinstallprompt");
    event.preventDefault = vi.fn();
    event.prompt = vi.fn();
    event.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(event);

    // The banner the browser would have shown itself is suppressed, so the
    // offer appears in one place at a moment the patient chose.
    expect(event.preventDefault).toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("install-app"));
    expect(event.prompt).toHaveBeenCalled();
  });

  it("explains how to install where the browser offers no dialog", async () => {
    // Safari on iOS fires nothing and exposes no API, so there the
    // instructions are the feature. Hiding the control would make "install"
    // look like a bug on a very common device.
    render(<App />);
    await waitFor(() => screen.getByTestId("install-app"));

    await userEvent.click(screen.getByTestId("install-app"));

    expect(screen.getByTestId("install-help")).toHaveTextContent(
      /Add to Home Screen/i,
    );
  });

  it("says nothing when already running as an installed app", async () => {
    vi.stubGlobal("matchMedia", (query) => ({
      matches: query === "(display-mode: standalone)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    render(<App />);
    await waitFor(() => screen.getByTestId("device-choice"));

    expect(screen.queryByTestId("install-app")).not.toBeInTheDocument();
  });
});

describe("where the privacy policy and terms are offered", () => {
  /**
   * The opening screen only.
   *
   * They belong where somebody is deciding whether to use the app, not under a
   * consultation that is already happening: beneath the body map in an
   * emergency, or under the doctor's message box mid visit, the footer offered
   * a document to read to somebody who is treating a patient.
   *
   * Both addresses still work when typed or followed from elsewhere. They are
   * simply not advertised on top of clinical work.
   */

  it("are offered on the screen the app opens into", async () => {
    render(<App />);

    // Awaited so the health check settling after the first render lands inside
    // act rather than warning about it.
    await waitFor(() =>
      expect(screen.getByTestId("legal-footer")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("device-choice")).toBeInTheDocument();
    expect(screen.getByTestId("open-privacy")).toBeInTheDocument();
    expect(screen.getByTestId("open-terms")).toBeInTheDocument();
  });

  it("are gone once a consultation has started", async () => {
    saveLiteracyPath(LiteracyPath.LITERATE);
    render(<App />);

    await waitFor(() =>
      expect(screen.queryByTestId("literacy-check")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("legal-footer")).not.toBeInTheDocument();
  });

  it("are gone in emergency mode, which is reachable without a visit", async () => {
    // The case a single `visit` check would have missed: emergency sits
    // outside the visit entirely, so it is reachable while the app still has
    // no visit at all.
    render(<App />);

    await userEvent.click(screen.getByTestId("enter-emergency"));

    await waitFor(() =>
      expect(screen.getByTestId("emergency-triage")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("legal-footer")).not.toBeInTheDocument();
  });

  it("are gone on a scanned prescription", async () => {
    window.history.pushState({}, "", "/p/abc123XYZ_-def");
    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId("prescription-playback")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("legal-footer")).not.toBeInTheDocument();
  });

  it("come back when the visit ends", async () => {
    // The next patient is handed the device at the opening screen, and that is
    // the moment the documents are worth offering again.
    saveLiteracyPath(LiteracyPath.LITERATE);
    render(<App />);

    await waitFor(() =>
      expect(screen.queryByTestId("legal-footer")).not.toBeInTheDocument(),
    );

    await userEvent.click(screen.getByTestId("new-patient"));

    await waitFor(() =>
      expect(screen.getByTestId("legal-footer")).toBeInTheDocument(),
    );
  });

  it("still open at their own addresses", async () => {
    // Removing the links must not remove the pages. A hospital sent the
    // privacy policy link has to be able to open it.
    window.history.pushState({}, "", "/privacy");

    render(<App />);

    // Awaited rather than asserted outright, so the health check settling
    // after the first render lands inside act rather than warning about it.
    await waitFor(() =>
      expect(screen.getByTestId("legal-screen")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("heading", { name: /privacy policy/i }),
    ).toBeInTheDocument();
  });
});
