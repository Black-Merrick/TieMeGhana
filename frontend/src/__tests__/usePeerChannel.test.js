import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../webrtc/peerChannel.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createPeerChannel: vi.fn() };
});

const { createPeerChannel, PeerState } = await import("../webrtc/peerChannel.js");
const { default: usePeerChannel } = await import("../hooks/usePeerChannel.js");

/** A stand in for what peerChannel.js's real return value looks like. */
function fakeChannel(initialState = PeerState.CONNECTING) {
  const stateListeners = new Set();
  const messageListeners = new Set();
  return {
    state: initialState,
    failure: null,
    subscribeState: vi.fn((listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    }),
    onMessage: vi.fn((listener) => {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    }),
    send: vi.fn(),
    close: vi.fn(),
    emitState(next) {
      stateListeners.forEach((listener) => listener(next));
    },
    emitMessage(message) {
      messageListeners.forEach((listener) => listener(message));
    },
  };
}

beforeEach(() => {
  createPeerChannel.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePeerChannel", () => {
  it("opens a channel with the role and code it was given", () => {
    const channel = fakeChannel();
    createPeerChannel.mockReturnValue(channel);

    renderHook(() => usePeerChannel({ role: "host", code: "ABC123" }));

    expect(createPeerChannel).toHaveBeenCalledWith({
      role: "host",
      code: "ABC123",
    });
  });

  it("opens no channel until a code is given", () => {
    renderHook(() => usePeerChannel({ role: "guest", code: null }));

    expect(createPeerChannel).not.toHaveBeenCalled();
  });

  it("starts in the channel's own current state", () => {
    const channel = fakeChannel(PeerState.CONNECTED);
    createPeerChannel.mockReturnValue(channel);

    const { result } = renderHook(() =>
      usePeerChannel({ role: "host", code: "ABC123" }),
    );

    expect(result.current.state).toBe(PeerState.CONNECTED);
  });

  it("tracks state changes the channel reports afterward", () => {
    const channel = fakeChannel();
    createPeerChannel.mockReturnValue(channel);
    const { result } = renderHook(() =>
      usePeerChannel({ role: "host", code: "ABC123" }),
    );

    act(() => channel.emitState(PeerState.CONNECTED));

    expect(result.current.state).toBe(PeerState.CONNECTED);
  });

  it("exposes the newest message, even one that arrives right after mount", () => {
    const channel = fakeChannel();
    createPeerChannel.mockReturnValue(channel);
    const { result } = renderHook(() =>
      usePeerChannel({ role: "guest", code: "ABC123" }),
    );

    act(() => channel.emitMessage({ type: "question", result: { caption: "hi" } }));

    expect(result.current.lastMessage).toEqual({
      type: "question",
      result: { caption: "hi" },
    });
  });

  it("sends through the underlying channel", () => {
    const channel = fakeChannel();
    createPeerChannel.mockReturnValue(channel);
    const { result } = renderHook(() =>
      usePeerChannel({ role: "host", code: "ABC123" }),
    );

    act(() => result.current.send({ type: "answer", value: "Yes" }));

    expect(channel.send).toHaveBeenCalledWith({ type: "answer", value: "Yes" });
  });

  it("closes the channel on unmount", () => {
    const channel = fakeChannel();
    createPeerChannel.mockReturnValue(channel);
    const { unmount } = renderHook(() =>
      usePeerChannel({ role: "host", code: "ABC123" }),
    );

    unmount();

    expect(channel.close).toHaveBeenCalled();
  });

  it("opens a new channel and closes the old one when the code changes", () => {
    const first = fakeChannel();
    const second = fakeChannel();
    createPeerChannel.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { rerender } = renderHook(
      ({ code }) => usePeerChannel({ role: "guest", code }),
      { initialProps: { code: "FIRST1" } },
    );

    rerender({ code: "SECOND" });

    expect(first.close).toHaveBeenCalled();
    expect(createPeerChannel).toHaveBeenLastCalledWith({
      role: "guest",
      code: "SECOND",
    });
  });

  it("does not carry the last connection's state or message into the next code", () => {
    const first = fakeChannel(PeerState.CONNECTED);
    const second = fakeChannel(PeerState.CONNECTING);
    createPeerChannel.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const seen = [];
    const { rerender } = renderHook(
      ({ code }) => {
        const channel = usePeerChannel({ role: "host", code });
        seen.push({ code, state: channel.state, message: channel.lastMessage });
        return channel;
      },
      { initialProps: { code: "FIRST1" } },
    );
    act(() => first.emitMessage({ type: "reply", text: "old patient" }));

    rerender({ code: "SECOND" });

    // Every render made for the new code, including the very first one, before
    // any effect has had a chance to correct it.
    const forSecond = seen.filter((entry) => entry.code === "SECOND");
    expect(forSecond.length).toBeGreaterThan(0);
    for (const entry of forSecond) {
      expect(entry.state).toBe(PeerState.CONNECTING);
      expect(entry.message).toBeNull();
    }
  });

  it("reports connecting again once the code is taken away", () => {
    const channel = fakeChannel(PeerState.CONNECTED);
    createPeerChannel.mockReturnValue(channel);
    const { result, rerender } = renderHook(
      ({ code }) => usePeerChannel({ role: "host", code }),
      { initialProps: { code: "ABC123" } },
    );
    expect(result.current.state).toBe(PeerState.CONNECTED);

    rerender({ code: null });

    expect(result.current.state).toBe(PeerState.CONNECTING);
    expect(result.current.lastMessage).toBeNull();
  });

  it("ignores a late message from a connection that has been replaced", () => {
    const first = fakeChannel();
    const second = fakeChannel();
    createPeerChannel.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { result, rerender } = renderHook(
      ({ code }) => usePeerChannel({ role: "host", code }),
      { initialProps: { code: "FIRST1" } },
    );
    rerender({ code: "SECOND" });

    act(() => first.emitMessage({ type: "reply", text: "too late" }));

    expect(result.current.lastMessage).toBeNull();
  });

  it("hands out why a connection failed, for that connection only", () => {
    const first = fakeChannel();
    const second = fakeChannel();
    createPeerChannel.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { result, rerender } = renderHook(
      ({ code }) => usePeerChannel({ role: "host", code }),
      { initialProps: { code: "FIRST1" } },
    );
    expect(result.current.failure).toBeNull();

    first.failure = "no-network";
    act(() => first.emitState(PeerState.FAILED));
    expect(result.current.failure).toBe("no-network");

    rerender({ code: "SECOND" });

    expect(result.current.failure).toBeNull();
  });
});
