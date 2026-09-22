import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/usePeerChannel.js", () => ({ default: vi.fn() }));
vi.mock("../api/clips.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchBodyLocations: vi.fn().mockResolvedValue([]) };
});

const { default: usePeerChannel } = await import("../hooks/usePeerChannel.js");
const { fetchBodyLocations } = await import("../api/clips.js");
const { PeerState } = await import("../webrtc/peerChannel.js");
const { loadGuestResume, saveGuestResume } = await import("../pairing/resume.js");
const { default: PairingJoinScreen } = await import(
  "../components/PairingJoinScreen.jsx"
);

beforeEach(() => {
  localStorage.clear();
  usePeerChannel.mockReset().mockReturnValue({
    state: PeerState.CONNECTING,
    send: vi.fn(),
    lastMessage: null,
    close: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("before a code has been entered", () => {
  it("shows a form asking for the code, no visit or literacy check needed", () => {
    render(<PairingJoinScreen />);

    expect(screen.getByTestId("pairing-join-form")).toBeInTheDocument();
    expect(screen.getByTestId("pairing-code-input")).toBeInTheDocument();
  });

  it("does not open a channel until a code is submitted", () => {
    render(<PairingJoinScreen />);

    expect(usePeerChannel).toHaveBeenCalledWith({ role: "guest", code: null, attempt: 0 });
  });

  it("refuses to submit an empty code", () => {
    render(<PairingJoinScreen />);

    expect(screen.getByTestId("pairing-join-submit")).toBeDisabled();
  });
});

describe("the entry form", () => {
  it("shows the code in capitals as it is typed, and takes no more than six", async () => {
    const user = userEvent.setup();
    render(<PairingJoinScreen />);

    await user.type(screen.getByTestId("pairing-code-input"), "abc123xyz");

    expect(screen.getByTestId("pairing-code-input")).toHaveValue("ABC123");
  });

  it("offers the doctor a way back to their own screen", async () => {
    const onLeave = vi.fn();
    render(<PairingJoinScreen onLeave={onLeave} />);

    await userEvent.click(screen.getByTestId("join-leave"));

    expect(onLeave).toHaveBeenCalled();
  });

  it("offers no way back where there is nowhere to go", () => {
    render(<PairingJoinScreen />);

    expect(screen.queryByTestId("join-leave")).not.toBeInTheDocument();
  });
});

describe("submitting a code", () => {
  it("opens a guest channel keyed on the code, uppercased", async () => {
    const user = userEvent.setup();
    render(<PairingJoinScreen />);

    await user.type(screen.getByTestId("pairing-code-input"), "abc123");
    await user.click(screen.getByTestId("pairing-join-submit"));

    await waitFor(() =>
      expect(usePeerChannel).toHaveBeenCalledWith({
        role: "guest",
        code: "ABC123",
        attempt: 0,
      }),
    );
  });

  it("shows a connecting state while waiting", async () => {
    const user = userEvent.setup();
    render(<PairingJoinScreen />);

    await user.type(screen.getByTestId("pairing-code-input"), "ABC123");
    await user.click(screen.getByTestId("pairing-join-submit"));

    expect(screen.getByTestId("pairing-join-waiting")).toBeInTheDocument();
  });
});

describe("once connected", () => {
  it("waits for the doctor to begin, not the join form", () => {
    // The literacy answer is given after connecting, so the phone does not
    // yet know which consultation screen it is for. See PatientDevice.
    usePeerChannel.mockReturnValue({
      state: PeerState.CONNECTED,
      send: vi.fn(),
      lastMessage: null,
      close: vi.fn(),
    });

    render(<PairingJoinScreen />);

    expect(screen.queryByTestId("pairing-join-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("patient-waiting")).toBeInTheDocument();
  });

  it("shows the consultation once the doctor has chosen a path", async () => {
    usePeerChannel.mockReturnValue({
      state: PeerState.CONNECTED,
      send: vi.fn(),
      lastMessage: { type: "path", path: "guided" },
      close: vi.fn(),
    });

    render(<PairingJoinScreen />);

    expect(await screen.findByTestId("stage-idle")).toBeInTheDocument();
    await waitFor(() => expect(fetchBodyLocations).toHaveBeenCalled());
  });
});

describe("once the connection has ended", () => {
  const connection = (state, lastMessage = null) => ({
    state,
    send: vi.fn(),
    lastMessage,
    close: vi.fn(),
  });

  it("says it ended rather than going back to connecting", async () => {
    // What a real phone did when the doctor started the next patient: its
    // connection closed and the screen fell back to "connecting", for good.
    usePeerChannel.mockReturnValue(connection(PeerState.CONNECTED));
    const { rerender } = render(<PairingJoinScreen />);
    expect(screen.getByTestId("patient-waiting")).toBeInTheDocument();

    usePeerChannel.mockReturnValue(connection(PeerState.CLOSED));
    rerender(<PairingJoinScreen />);

    expect(screen.getByTestId("pairing-ended")).toBeInTheDocument();
    expect(screen.queryByTestId("pairing-join-waiting")).not.toBeInTheDocument();
  });

  it("does the same when the connection fails after it was made", () => {
    usePeerChannel.mockReturnValue(connection(PeerState.CONNECTED));
    const { rerender } = render(<PairingJoinScreen />);

    usePeerChannel.mockReturnValue(connection(PeerState.FAILED));
    rerender(<PairingJoinScreen />);

    expect(screen.getByTestId("pairing-ended")).toBeInTheDocument();
    expect(screen.queryByTestId("pairing-join-failed")).not.toBeInTheDocument();
  });

  it("still offers the entry form's own failure when it never connected", async () => {
    usePeerChannel.mockReturnValue(connection(PeerState.FAILED));

    render(<PairingJoinScreen />);

    expect(await screen.findByTestId("pairing-join-failed")).toBeInTheDocument();
  });
});

describe("when the two devices cannot connect", () => {
  it("says so and offers to try again", async () => {
    usePeerChannel.mockReturnValue({
      state: PeerState.FAILED,
      send: vi.fn(),
      lastMessage: null,
      close: vi.fn(),
    });

    render(<PairingJoinScreen />);

    expect(await screen.findByTestId("pairing-join-failed")).toBeInTheDocument();
    expect(screen.getByTestId("pairing-try-again")).toBeInTheDocument();
  });

  it("returns to the entry form on try again", async () => {
    // Responds to the code the component is currently holding, the same
    // way the real hook's state resets to connecting the moment a fresh
    // code opens a fresh channel, rather than staying failed forever.
    usePeerChannel.mockImplementation(({ code }) => ({
      state: code ? PeerState.FAILED : PeerState.CONNECTING,
      send: vi.fn(),
      lastMessage: null,
      close: vi.fn(),
    }));
    const user = userEvent.setup();
    render(<PairingJoinScreen />);
    await user.type(screen.getByTestId("pairing-code-input"), "ABC123");
    await user.click(screen.getByTestId("pairing-join-submit"));
    await screen.findByTestId("pairing-join-failed");

    await user.click(screen.getByTestId("pairing-try-again"));

    expect(screen.getByTestId("pairing-join-form")).toBeInTheDocument();
  });
});

const TOKEN = "k3Jx9_-Qm2LpV8wZr5TnYA";

const connection = (state, lastMessage = null) => ({
  state,
  send: vi.fn(),
  lastMessage,
  close: vi.fn(),
});

// One object per situation, as the real hook hands out: a message that is a new
// object on every render is not a thing that happens, and would make any
// effect watching it run forever.
function stable(build) {
  const seen = new Map();
  return (props) => {
    const key = JSON.stringify(props);
    if (!seen.has(key)) seen.set(key, build(props));
    return seen.get(key);
  };
}

describe("learning the way back", () => {
  it("keeps the token and the path the doctor's device sends when it connects", async () => {
    usePeerChannel.mockReturnValue(
      connection(PeerState.CONNECTED, { type: "path", path: "literate", resume: TOKEN }),
    );

    render(<PairingJoinScreen />);

    await waitFor(() =>
      expect(loadGuestResume()).toEqual({ token: TOKEN, path: "literate", emergency: false, prescription: null, prescriptionOpen: false, ended: false }),
    );
  });

  it("learns the token from a message sent before there is a path to send", async () => {
    usePeerChannel.mockReturnValue(
      connection(PeerState.CONNECTED, { type: "resume", resume: TOKEN }),
    );

    render(<PairingJoinScreen />);

    await waitFor(() => expect(loadGuestResume()?.token).toBe(TOKEN));
  });

  it("learns it from a question too, since the newest message may be the only one seen", async () => {
    usePeerChannel.mockReturnValue(
      connection(PeerState.CONNECTED, {
        type: "question",
        path: "guided",
        resume: TOKEN,
        result: { transcript: "x", caption: "x", sequence: { segments: [] } },
      }),
    );

    render(<PairingJoinScreen />);

    await waitFor(() => expect(loadGuestResume()).toMatchObject({ token: TOKEN, path: "guided" }));
  });

  it("does not believe a token that is not shaped like one", () => {
    usePeerChannel.mockReturnValue(
      connection(PeerState.CONNECTED, { type: "path", path: "literate", resume: "short" }),
    );

    render(<PairingJoinScreen />);

    expect(loadGuestResume()).toBeNull();
  });

  it("stays on the code it was given while that connection is up, even once it knows the way back", async () => {
    usePeerChannel.mockImplementation(
      stable(({ code }) =>
        connection(
          code ? PeerState.CONNECTED : PeerState.CONNECTING,
          code ? { type: "path", path: "literate", resume: TOKEN } : null,
        ),
      ),
    );
    const user = userEvent.setup();
    render(<PairingJoinScreen />);
    await user.type(screen.getByTestId("pairing-code-input"), "ABC123");
    await user.click(screen.getByTestId("pairing-join-submit"));
    await waitFor(() => expect(loadGuestResume()?.token).toBe(TOKEN));

    expect(usePeerChannel).toHaveBeenLastCalledWith({
      role: "guest",
      code: "ABC123",
      attempt: 0,
    });
  });
});

describe("a reload in the middle of a consultation", () => {
  beforeEach(() => saveGuestResume({ token: TOKEN, path: "literate" }));

  it("does not go back to the empty code box", async () => {
    usePeerChannel.mockReturnValue(connection(PeerState.CONNECTING));

    render(<PairingJoinScreen />);

    expect(screen.queryByTestId("pairing-join-form")).not.toBeInTheDocument();
    expect(await screen.findByTestId("speak-to-doctor")).toBeInTheDocument();
  });

  it("looks for the doctor's device under the way back it remembered", () => {
    usePeerChannel.mockReturnValue(connection(PeerState.CONNECTING));

    render(<PairingJoinScreen />);

    expect(usePeerChannel).toHaveBeenCalledWith({
      role: "guest",
      code: TOKEN,
      attempt: 0,
    });
  });

  it("says it is reconnecting, over the consultation", async () => {
    usePeerChannel.mockReturnValue(connection(PeerState.CONNECTING));

    render(<PairingJoinScreen />);

    expect(screen.getByTestId("patient-reconnecting-banner")).toBeInTheDocument();
    await screen.findByTestId("speak-to-doctor");
  });

  it("stays on the consultation when the first attempt does not find anybody", async () => {
    usePeerChannel.mockReturnValue(connection(PeerState.FAILED));

    render(<PairingJoinScreen />);

    expect(screen.queryByTestId("pairing-join-failed")).not.toBeInTheDocument();
    expect(await screen.findByTestId("speak-to-doctor")).toBeInTheDocument();
  });

  it("drops the banner once it is connected again", async () => {
    usePeerChannel.mockReturnValue(connection(PeerState.CONNECTED));

    render(<PairingJoinScreen />);

    await screen.findByTestId("speak-to-doctor");
    expect(screen.queryByTestId("patient-reconnecting-banner")).not.toBeInTheDocument();
  });

  it("looks for the doctor's device almost at once the first time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    usePeerChannel.mockReturnValue(connection(PeerState.FAILED));

    render(<PairingJoinScreen />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(usePeerChannel).toHaveBeenLastCalledWith({
      role: "guest",
      code: TOKEN,
      attempt: 1,
    });
  });

  it("tries again by itself, under the same way back, when an attempt fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    usePeerChannel.mockReturnValue(connection(PeerState.FAILED));

    render(<PairingJoinScreen />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(usePeerChannel).toHaveBeenLastCalledWith({
      role: "guest",
      code: TOKEN,
      attempt: 1,
    });
  });

  it("waits a little longer between tries each time nobody is there", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    usePeerChannel.mockReturnValue(connection(PeerState.FAILED));
    render(<PairingJoinScreen />);

    const waits = [];
    for (let round = 0; round < 3; round += 1) {
      let waited = 0;
      while (usePeerChannel.mock.lastCall[0].attempt === round && waited < 40000) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(250);
        });
        waited += 250;
      }
      waits.push(waited);
    }

    expect(waits[1]).toBeGreaterThan(waits[0]);
    expect(waits[2]).toBeGreaterThan(waits[1]);
  });

  it("lets the patient give up, and lands on the code box with nothing kept", async () => {
    usePeerChannel.mockReturnValue(connection(PeerState.CONNECTING));
    render(<PairingJoinScreen />);

    await userEvent.click(await screen.findByTestId("leave-consultation"));

    expect(screen.getByTestId("pairing-join-form")).toBeInTheDocument();
    expect(loadGuestResume()).toBeNull();
  });
});

describe("the connection dropping in the middle of a consultation", () => {
  it("is not the end when there is a way back", async () => {
    saveGuestResume({ token: TOKEN, path: "literate" });
    usePeerChannel.mockReturnValue(connection(PeerState.CONNECTED));
    const { rerender } = render(<PairingJoinScreen />);
    await screen.findByTestId("speak-to-doctor");

    usePeerChannel.mockReturnValue(connection(PeerState.CLOSED));
    rerender(<PairingJoinScreen />);

    expect(screen.queryByTestId("pairing-ended")).not.toBeInTheDocument();
    expect(screen.getByTestId("patient-reconnecting-banner")).toBeInTheDocument();
    expect(screen.getByTestId("speak-to-doctor")).toBeInTheDocument();
  });

  it("looks for the doctor's device again, on the way back and not the code typed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    usePeerChannel.mockImplementation(
      stable(({ code, attempt }) =>
        connection(
          attempt === 0 && code ? PeerState.CONNECTED : PeerState.CONNECTING,
          code && attempt === 0 ? { type: "path", path: "literate", resume: TOKEN } : null,
        ),
      ),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(<PairingJoinScreen />);
    await user.type(screen.getByTestId("pairing-code-input"), "ABC123");
    await user.click(screen.getByTestId("pairing-join-submit"));
    await waitFor(() => expect(loadGuestResume()?.token).toBe(TOKEN));

    usePeerChannel.mockImplementation(
      stable(({ attempt }) =>
        connection(attempt === 0 ? PeerState.CLOSED : PeerState.CONNECTING),
      ),
    );
    rerender(<PairingJoinScreen />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(usePeerChannel).toHaveBeenLastCalledWith({
      role: "guest",
      code: TOKEN,
      attempt: 1,
    });
  });

  it("is the end when there is no way back, as it always was", async () => {
    usePeerChannel.mockReturnValue(connection(PeerState.CONNECTED));
    const { rerender } = render(<PairingJoinScreen />);
    await screen.findByTestId("patient-waiting");

    usePeerChannel.mockReturnValue(connection(PeerState.CLOSED));
    rerender(<PairingJoinScreen />);

    expect(screen.getByTestId("pairing-ended")).toBeInTheDocument();
  });
});

describe("the doctor ending the consultation", () => {
  beforeEach(() => saveGuestResume({ token: TOKEN, path: "literate" }));

  it("says so, and stops looking for the doctor's device", async () => {
    usePeerChannel.mockReturnValue(connection(PeerState.CONNECTED, { type: "ended" }));

    render(<PairingJoinScreen />);

    expect(await screen.findByTestId("pairing-ended")).toBeInTheDocument();
    await waitFor(() =>
      expect(usePeerChannel).toHaveBeenLastCalledWith({
        role: "guest",
        code: null,
        attempt: 0,
      }),
    );
  });

  it("is remembered, so a reload comes back to the ended screen and its record", async () => {
    usePeerChannel.mockReturnValue(connection(PeerState.CONNECTED, { type: "ended" }));
    const { unmount } = render(<PairingJoinScreen />);
    await screen.findByTestId("pairing-ended");
    expect(loadGuestResume()).toMatchObject({ token: TOKEN, ended: true });
    unmount();

    usePeerChannel.mockReturnValue(connection(PeerState.CONNECTING));
    render(<PairingJoinScreen />);

    expect(screen.getByTestId("pairing-ended")).toBeInTheDocument();
    expect(screen.queryByTestId("pairing-join-form")).not.toBeInTheDocument();
  });

  it("is learned on coming back, when the doctor closed it while the phone was away", async () => {
    usePeerChannel.mockReturnValue(connection(PeerState.ENDED));

    render(<PairingJoinScreen />);

    expect(await screen.findByTestId("pairing-ended")).toBeInTheDocument();
    expect(loadGuestResume()?.ended).toBe(true);
  });

  it("does not try to reconnect to something that has ended", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    usePeerChannel.mockReturnValue(connection(PeerState.ENDED));
    render(<PairingJoinScreen />);
    await screen.findByTestId("pairing-ended");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });

    expect(usePeerChannel).not.toHaveBeenCalledWith(expect.objectContaining({ attempt: 1 }));
  });

  it("goes on to the code box for the next consultation, forgetting this one", async () => {
    // As the real hook answers: nothing connected once there is no code.
    usePeerChannel.mockImplementation(
      stable(({ code }) =>
        code
          ? connection(PeerState.CONNECTED, { type: "ended" })
          : connection(PeerState.CONNECTING),
      ),
    );
    render(<PairingJoinScreen />);

    await userEvent.click(await screen.findByTestId("join-another"));

    expect(screen.getByTestId("pairing-join-form")).toBeInTheDocument();
    expect(loadGuestResume()).toBeNull();
  });
});

describe("this phone having no network while it joins", () => {
  // Real: Wi-Fi dropped and came back in the middle of pairing.
  async function joinedWith(build) {
    usePeerChannel.mockImplementation(stable(build));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PairingJoinScreen />);
    await user.type(screen.getByTestId("pairing-code-input"), "ABC123");
    await user.click(screen.getByTestId("pairing-join-submit"));
  }

  const noNetwork = ({ code }) =>
    connection(code ? PeerState.FAILED : PeerState.CONNECTING);

  const withReason = ({ code, attempt }) => ({
    ...connection(code && attempt === 0 ? PeerState.FAILED : PeerState.CONNECTING),
    failure: code && attempt === 0 ? "no-network" : null,
  });

  it("says it is waiting for the connection, not that the code was wrong", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await joinedWith(({ code }) => ({
      ...connection(code ? PeerState.FAILED : PeerState.CONNECTING),
      failure: code ? "no-network" : null,
    }));

    expect(await screen.findByTestId("pairing-join-no-network")).toHaveTextContent(
      /no network connection/i,
    );
    expect(screen.queryByTestId("pairing-join-failed")).not.toBeInTheDocument();
  });

  it("looks again by itself under the same code", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await joinedWith(withReason);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(usePeerChannel).toHaveBeenLastCalledWith({ role: "guest", code: "ABC123", attempt: 1 });
  });

  it("is still a failed join when there was no such reason", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await joinedWith(noNetwork);

    expect(await screen.findByTestId("pairing-join-failed")).toBeInTheDocument();
  });
});

describe("emergency mode on the doctor's device", () => {
  it("is remembered, so a reload comes back to the emergency screen", async () => {
    usePeerChannel.mockReturnValue({
      ...connection(PeerState.CONNECTED),
      lastMessage: { type: "emergency", emergency: true, path: "literate", resume: TOKEN },
    });

    render(<PairingJoinScreen />);

    await waitFor(() => expect(loadGuestResume()).toMatchObject({ token: TOKEN, emergency: true }));
    expect(await screen.findByTestId("emergency-triage-guest")).toBeInTheDocument();
  });

  it("is forgotten when the doctor leaves it", async () => {
    saveGuestResume({ token: TOKEN, path: "literate", emergency: true });
    usePeerChannel.mockReturnValue({
      ...connection(PeerState.CONNECTED),
      lastMessage: { type: "path", path: "literate", emergency: false },
    });

    render(<PairingJoinScreen />);

    await waitFor(() => expect(loadGuestResume().emergency).toBe(false));
  });

  it("opens on the emergency screen when that is what it remembered", async () => {
    saveGuestResume({ token: TOKEN, path: "guided", emergency: true });
    usePeerChannel.mockReturnValue(connection(PeerState.CONNECTING));

    render(<PairingJoinScreen />);

    expect(await screen.findByTestId("emergency-triage-guest")).toBeInTheDocument();
    expect(screen.getByTestId("patient-reconnecting-banner")).toBeInTheDocument();
  });
});
