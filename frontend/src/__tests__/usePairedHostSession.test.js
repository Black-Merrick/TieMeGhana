import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/pairing.js", () => ({
  createPairing: vi.fn(),
  endPairing: vi.fn(),
  registerResume: vi.fn(),
  closePairing: vi.fn(),
}));
vi.mock("../hooks/usePeerChannel.js", () => ({ default: vi.fn() }));

const { createPairing, endPairing, registerResume, closePairing } = await import(
  "../api/pairing.js"
);
const { default: usePeerChannel } = await import("../hooks/usePeerChannel.js");
const { PeerState } = await import("../webrtc/peerChannel.js");
const { loadHostResume, saveHostResume } = await import("../pairing/resume.js");
const { isResumeToken } = await import("../pairing/token.js");
const { default: usePairedHostSession } = await import(
  "../hooks/usePairedHostSession.js"
);

const TOKEN = "k3Jx9_-Qm2LpV8wZr5TnYA";

let channel;

beforeEach(() => {
  localStorage.clear();
  createPairing.mockReset().mockResolvedValue({ code: "ABC123", expires_in: 600 });
  endPairing.mockReset().mockResolvedValue(null);
  registerResume.mockReset().mockResolvedValue(null);
  closePairing.mockReset().mockResolvedValue(null);
  channel = {
    state: PeerState.CONNECTING,
    send: vi.fn(),
    lastMessage: null,
    failure: null,
    close: vi.fn(),
  };
  usePeerChannel.mockReset().mockImplementation(() => channel);
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("when the visit is not paired", () => {
  it("touches no network at all", () => {
    renderHook(() => usePairedHostSession({ enabled: false }));

    expect(createPairing).not.toHaveBeenCalled();
    expect(registerResume).not.toHaveBeenCalled();
    expect(closePairing).not.toHaveBeenCalled();
  });

  it("opens no connection", () => {
    renderHook(() => usePairedHostSession({ enabled: false }));

    expect(usePeerChannel).toHaveBeenCalledWith({ role: "host", code: null, attempt: 0 });
  });
});

describe("when the visit is paired", () => {
  it("mints a code", async () => {
    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() => expect(result.current.code).toBe("ABC123"));
  });

  it("opens a host connection on that code", async () => {
    renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() =>
      expect(usePeerChannel).toHaveBeenCalledWith({
        role: "host",
        code: "ABC123",
        attempt: 0,
      }),
    );
  });

  it("reports connecting while there is no code yet", () => {
    createPairing.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

    expect(result.current.state).toBe(PeerState.CONNECTING);
  });

  it("reports failed when a code cannot be minted", async () => {
    createPairing.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() => expect(result.current.state).toBe(PeerState.FAILED));
    expect(result.current.codeFailed).toBe(true);
  });

  it("follows the connection's own state once there is a code", async () => {
    channel.state = PeerState.CONNECTED;

    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() => expect(result.current.state).toBe(PeerState.CONNECTED));
  });

  it("hands back the connection, so screens can send through it", async () => {
    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() => expect(result.current.code).toBe("ABC123"));
    act(() => result.current.channel.send({ type: "path", path: "guided" }));

    expect(channel.send).toHaveBeenCalledWith({ type: "path", path: "guided" });
  });

  it("is not yet able to come back by itself, having never connected", async () => {
    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));
    await waitFor(() => expect(result.current.code).toBe("ABC123"));

    expect(result.current.resumable).toBe(false);
  });
});

describe("the code, once it has done its job", () => {
  it("is discarded on the server as soon as the devices connect", async () => {
    channel.state = PeerState.CONNECTED;

    renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() => expect(endPairing).toHaveBeenCalledWith("ABC123"));
  });

  it("is discarded once, not on every render afterward", async () => {
    channel.state = PeerState.CONNECTED;
    const { rerender } = renderHook(() => usePairedHostSession({ enabled: true }));
    await waitFor(() => expect(endPairing).toHaveBeenCalledTimes(1));

    rerender();
    rerender();

    expect(endPairing).toHaveBeenCalledTimes(1);
  });

  it("is not discarded while still waiting for the patient", async () => {
    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));
    await waitFor(() => expect(result.current.code).toBe("ABC123"));

    expect(endPairing).not.toHaveBeenCalled();
  });

  it("survives the server refusing to forget it", async () => {
    channel.state = PeerState.CONNECTED;
    endPairing.mockRejectedValue(new Error("gone"));

    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() => expect(result.current.state).toBe(PeerState.CONNECTED));
  });
});

describe("making the way back", () => {
  it("makes a token once the two devices have met, and keeps it", async () => {
    channel.state = PeerState.CONNECTED;

    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() => expect(result.current.token).not.toBeNull());
    expect(isResumeToken(result.current.token)).toBe(true);
    expect(loadHostResume()).toBe(result.current.token);
    expect(result.current.resumable).toBe(true);
  });

  it("is not the short code, which is spent and would not be safe to keep", async () => {
    channel.state = PeerState.CONNECTED;

    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() => expect(result.current.token).not.toBeNull());
    expect(result.current.token).not.toBe("ABC123");
  });

  it("registers it with the server, so it exists for a phone that returns first", async () => {
    channel.state = PeerState.CONNECTED;

    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() => expect(registerResume).toHaveBeenCalledWith(result.current.token));
  });

  it("makes it once, not on every render", async () => {
    channel.state = PeerState.CONNECTED;
    const { result, rerender } = renderHook(() => usePairedHostSession({ enabled: true }));
    await waitFor(() => expect(result.current.token).not.toBeNull());
    const first = result.current.token;

    rerender();
    rerender();

    expect(result.current.token).toBe(first);
    expect(registerResume).toHaveBeenCalledTimes(1);
  });

  it("does not replace the live connection by making it", async () => {
    channel.state = PeerState.CONNECTED;

    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));
    await waitFor(() => expect(result.current.token).not.toBeNull());

    // Still the connection on the short code, attempt 0: nothing was re-armed.
    expect(usePeerChannel).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: result.current.token }),
    );
    expect(createPairing).toHaveBeenCalledTimes(1);
  });

  it("does not keep, or hand to the phone, a token the server would not take", async () => {
    // An older server has no such endpoint. A token kept anyway would leave the
    // phone reconnecting for good after its first reload.
    channel.state = PeerState.CONNECTED;
    registerResume.mockRejectedValue(Object.assign(new Error("405"), { status: 405 }));

    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() => expect(registerResume).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.token).toBeNull();
    expect(loadHostResume()).toBeNull();
    expect(result.current.resumable).toBe(false);
    expect(result.current.state).toBe(PeerState.CONNECTED);
  });

  it("closes a token that was registered just as the visit ended", async () => {
    channel.state = PeerState.CONNECTED;
    let finish;
    registerResume.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { rerender } = renderHook(({ enabled }) => usePairedHostSession({ enabled }), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(registerResume).toHaveBeenCalled());

    rerender({ enabled: false });
    await act(async () => finish(null));

    expect(loadHostResume()).toBeNull();
    expect(closePairing).toHaveBeenCalled();
  });

  it("carries on without one if it cannot be made or kept", async () => {
    channel.state = PeerState.CONNECTED;
    const original = globalThis.crypto.getRandomValues;
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(() => {
      throw new Error("no secure random source");
    });

    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() => expect(result.current.state).toBe(PeerState.CONNECTED));
    expect(result.current.token).toBeNull();
    globalThis.crypto.getRandomValues = original;
  });
});

describe("starting from a reload", () => {
  beforeEach(() => saveHostResume(TOKEN));

  it("goes back to the token, not to a new code", async () => {
    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() => expect(result.current.code).toBe(TOKEN));
    expect(createPairing).not.toHaveBeenCalled();
    expect(registerResume).toHaveBeenCalledWith(TOKEN);
  });

  it("is resumable from the first render", () => {
    createPairing.mockReturnValue(new Promise(() => {}));
    registerResume.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

    expect(result.current.resumable).toBe(true);
  });

  it("opens its connection on the token", async () => {
    renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() =>
      expect(usePeerChannel).toHaveBeenCalledWith({
        role: "host",
        code: TOKEN,
        attempt: 0,
      }),
    );
  });

  it("does not discard the token as though it were a spent code", async () => {
    channel.state = PeerState.CONNECTED;

    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));
    await waitFor(() => expect(result.current.code).toBe(TOKEN));

    expect(endPairing).not.toHaveBeenCalled();
    expect(loadHostResume()).toBe(TOKEN);
  });

  it("clears what the last connection left in the slots once connected again", async () => {
    channel.state = PeerState.CONNECTED;
    renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() => expect(registerResume).toHaveBeenCalledTimes(2));
  });

  it.each([404, 405])(
    "begins again with a fresh code when the server has no such endpoint (%i)",
    async (status) => {
      // A server older than the page, which happens in development when only
      // the frontend was updated. Retrying a name that cannot work for ever is
      // worse than pairing again.
      registerResume.mockRejectedValueOnce(Object.assign(new Error("x"), { status }));

      const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

      await waitFor(() => expect(result.current.code).toBe("ABC123"));
      expect(loadHostResume()).toBeNull();
      expect(result.current.resumable).toBe(false);
    },
  );

  it("begins again with a fresh code when the visit turns out to have been closed", async () => {
    const closed = Object.assign(new Error("gone"), { status: 410 });
    registerResume.mockRejectedValueOnce(closed);

    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() => expect(result.current.code).toBe("ABC123"));
    expect(loadHostResume()).toBeNull();
    expect(result.current.resumable).toBe(false);
  });

  it("keeps trying, and stays resumable, when the network is down", async () => {
    registerResume.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));

    await waitFor(() => expect(result.current.codeFailed).toBe(true));
    expect(result.current.resumable).toBe(true);
    expect(loadHostResume()).toBe(TOKEN);
  });
});

describe("waiting for the phone to come back", () => {
  beforeEach(() => saveHostResume(TOKEN));

  async function connected() {
    channel.state = PeerState.CONNECTED;
    const view = renderHook(() => usePairedHostSession({ enabled: true }));
    await waitFor(() => expect(view.result.current.code).toBe(TOKEN));
    return view;
  }

  it("registers the rendezvous again and opens a new attempt when the connection drops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { rerender } = await connected();
    registerResume.mockClear();

    channel.state = PeerState.CLOSED;
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(registerResume).toHaveBeenCalledWith(TOKEN);
    expect(usePeerChannel).toHaveBeenLastCalledWith({ role: "host", code: TOKEN, attempt: 1 });
  });

  it("looks for the phone almost at once the first time, since a refresh is by far the commonest reason", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { rerender } = await connected();

    channel.state = PeerState.CLOSED;
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(usePeerChannel).toHaveBeenLastCalledWith({ role: "host", code: TOKEN, attempt: 1 });
  });

  it("does the same when an attempt times out with nobody there", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { rerender } = await connected();
    registerResume.mockClear();

    channel.state = PeerState.FAILED;
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(usePeerChannel).toHaveBeenLastCalledWith({ role: "host", code: TOKEN, attempt: 1 });
  });

  it("does not hammer the server while nobody comes: each wait is longer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { rerender } = await connected();

    const attempts = [];
    for (let round = 0; round < 3; round += 1) {
      channel.state = PeerState.CLOSED;
      rerender();
      let waited = 0;
      while (
        usePeerChannel.mock.lastCall[0].attempt === round &&
        waited < 130000
      ) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(500);
        });
        waited += 500;
      }
      attempts.push(waited);
      channel.state = PeerState.CONNECTING;
      rerender();
    }

    expect(attempts[1]).toBeGreaterThan(attempts[0]);
    expect(attempts[2]).toBeGreaterThan(attempts[1]);
  });

  it("stays out of the way of a live connection", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await connected();
    registerResume.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });

    expect(registerResume).not.toHaveBeenCalled();
  });

  it("does not wait for a phone it has no way back to", async () => {
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    channel.state = PeerState.FAILED;
    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));
    await waitFor(() => expect(result.current.code).toBe("ABC123"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });

    expect(createPairing).toHaveBeenCalledTimes(1);
    expect(usePeerChannel).not.toHaveBeenCalledWith(expect.objectContaining({ attempt: 1 }));
  });
});

describe("telling the patient's phone the visit is over", () => {
  it("does NOT say the visit is over when the app merely unmounts", async () => {
    // A screen crashing, or a development server reloading a module, unmounts
    // the app without the visit having ended. The phone was being told it was
    // over, when the doctor had done nothing of the kind.
    const { result, unmount } = renderHook(() =>
      usePairedHostSession({ enabled: true }),
    );
    await waitFor(() => expect(result.current.code).toBe("ABC123"));

    unmount();

    expect(channel.send).not.toHaveBeenCalledWith({ type: "ended" });
  });

  it("sends ended when the next patient starts, without the app unmounting", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => usePairedHostSession({ enabled }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.code).toBe("ABC123"));

    rerender({ enabled: false });

    expect(channel.send).toHaveBeenCalledWith({ type: "ended" });
  });

  it("says nothing when it was never paired", () => {
    const { unmount } = renderHook(() => usePairedHostSession({ enabled: false }));

    unmount();

    expect(channel.send).not.toHaveBeenCalled();
  });

  it("closes the rendezvous and forgets the token when the visit ends, so an offline phone is told", async () => {
    saveHostResume(TOKEN);
    const { result, rerender } = renderHook(
      ({ enabled }) => usePairedHostSession({ enabled }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.code).toBe(TOKEN));

    rerender({ enabled: false });

    expect(closePairing).toHaveBeenCalledWith(TOKEN);
    expect(loadHostResume()).toBeNull();
    expect(result.current.token).toBeNull();
  });

  it("does NOT close it when the page merely goes away: that is a reload", async () => {
    // The whole point. An unmount is what a reload looks like from in here
    // in a test, and the phone must still be able to find its way back.
    saveHostResume(TOKEN);
    const { result, unmount } = renderHook(() => usePairedHostSession({ enabled: true }));
    await waitFor(() => expect(result.current.code).toBe(TOKEN));

    unmount();

    expect(closePairing).not.toHaveBeenCalled();
    expect(loadHostResume()).toBe(TOKEN);
  });

  it("does not try to close anything it never had", () => {
    const { rerender } = renderHook(({ enabled }) => usePairedHostSession({ enabled }), {
      initialProps: { enabled: true },
    });

    rerender({ enabled: false });

    expect(closePairing).not.toHaveBeenCalled();
  });
});

describe("trying again", () => {
  it("mints a fresh code", async () => {
    createPairing
      .mockResolvedValueOnce({ code: "FIRST1" })
      .mockResolvedValueOnce({ code: "SECOND" });
    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));
    await waitFor(() => expect(result.current.code).toBe("FIRST1"));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.code).toBe("SECOND"));
    expect(createPairing).toHaveBeenCalledTimes(2);
  });

  it("does not report the old failure while the new code is being minted", async () => {
    channel.state = PeerState.FAILED;
    createPairing
      .mockResolvedValueOnce({ code: "FIRST1" })
      .mockReturnValueOnce(new Promise(() => {}));
    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));
    await waitFor(() => expect(result.current.state).toBe(PeerState.FAILED));

    act(() => result.current.retry());

    expect(result.current.state).toBe(PeerState.CONNECTING);
  });

  it("gives up the way back, and tells the old rendezvous, so the old phone is not left waiting", async () => {
    saveHostResume(TOKEN);
    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));
    await waitFor(() => expect(result.current.code).toBe(TOKEN));

    act(() => result.current.retry());

    expect(closePairing).toHaveBeenCalledWith(TOKEN);
    expect(loadHostResume()).toBeNull();
    await waitFor(() => expect(result.current.code).toBe("ABC123"));
  });
});

describe("this device having no network while a code is on screen", () => {
  // Real: the doctor's Wi-Fi dropped and came back mid pairing. The attempt had
  // no address to offer and failed, and the patient, typing the code, was left
  // waiting on a device that could not be reached.
  async function withCode() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    channel.state = PeerState.FAILED;
    channel.failure = "no-network";
    const view = renderHook(() => usePairedHostSession({ enabled: true }));
    await waitFor(() => expect(view.result.current.code).toBe("ABC123"));
    return view;
  }

  it("tries again by itself, under the same code", async () => {
    await withCode();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(usePeerChannel).toHaveBeenLastCalledWith({ role: "host", code: "ABC123", attempt: 1 });
  });

  it("does not mint a new code for it: the patient is already typing this one", async () => {
    const { result } = await withCode();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(createPairing).toHaveBeenCalledTimes(1);
    expect(result.current.code).toBe("ABC123");
  });

  it("says why", async () => {
    const { result } = await withCode();

    expect(result.current.failure).toBe("no-network");
  });

  it("waits longer each time it does not work", async () => {
    await withCode();

    const attempts = [];
    for (let round = 0; round < 3; round += 1) {
      let waited = 0;
      while (usePeerChannel.mock.lastCall[0].attempt === round && waited < 40000) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(250);
        });
        waited += 250;
      }
      attempts.push(waited);
    }

    expect(attempts[1]).toBeGreaterThan(attempts[0]);
    expect(attempts[2]).toBeGreaterThan(attempts[1]);
  });

  it("does not do it for an ordinary failure to connect, which needs a decision from the doctor", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    channel.state = PeerState.FAILED;
    channel.failure = null;
    const { result } = renderHook(() => usePairedHostSession({ enabled: true }));
    await waitFor(() => expect(result.current.code).toBe("ABC123"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });

    expect(usePeerChannel).not.toHaveBeenCalledWith(expect.objectContaining({ attempt: 1 }));
  });

  it("stops when the visit does", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    channel.state = PeerState.FAILED;
    channel.failure = "no-network";
    const { result, rerender } = renderHook(({ enabled }) => usePairedHostSession({ enabled }), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current.code).toBe("ABC123"));

    rerender({ enabled: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(usePeerChannel).not.toHaveBeenCalledWith(expect.objectContaining({ attempt: 1 }));
  });
});
