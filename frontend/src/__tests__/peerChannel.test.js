import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/pairing.js", () => ({
  postOffer: vi.fn(),
  fetchOffer: vi.fn(),
  postAnswer: vi.fn(),
  fetchAnswer: vi.fn(),
}));

const { postOffer, fetchOffer, postAnswer, fetchAnswer } = await import(
  "../api/pairing.js"
);
const {
  createPeerChannel,
  PeerRole,
  PeerState,
  ICE_GATHERING_TIMEOUT_MS,
  CLOSE_GRACE_MS,
  hasCandidates,
  CANDIDATE_QUIET_MS,
  CANDIDATE_HOST_ONLY_MS,
  FAST_POLL_MS,
  SLOW_POLL_MS,
} = await import("../webrtc/peerChannel.js");

/**
 * jsdom has no WebRTC implementation at all, so this stands in for the real
 * one. It is deliberately controllable by hand (`finishIceGathering`,
 * `simulateConnectionFailure`) rather than behaving like a real connection,
 * because what these tests are proving is peerChannel's own sequencing and
 * state machine, not WebRTC negotiation itself. The real negotiation is
 * proven separately, against two real browsers.
 */
// What a description looks like when the device had a network to offer. Without
// a candidate line a description cannot lead to a connection, and the channel
// treats it as a device with no network. See hasCandidates.
const CANDIDATE = "\r\na=candidate:1 1 udp 2113937151 192.0.2.1 50000 typ host";
const OFFER = `offer-sdp${CANDIDATE}`;
const ANSWER = `answer-sdp${CANDIDATE}`;
const ANSWER_FROM_GUEST = `answer-sdp-from-guest${CANDIDATE}`;
const OFFER_FROM_HOST = `offer-sdp-from-host${CANDIDATE}`;

class FakeDataChannel extends EventTarget {
  readyState = "connecting";
  sent = [];

  send(data) {
    if (this.readyState !== "open") throw new Error("channel not open");
    this.sent.push(data);
  }

  close() {
    this.readyState = "closed";
    this.dispatchEvent(new Event("close"));
  }

  simulateOpen() {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }

  simulateMessage(data) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

class FakePeerConnection extends EventTarget {
  static instances = [];

  iceGatheringState = "new";
  connectionState = "new";
  localDescription = null;
  remoteDescription = null;

  constructor(config) {
    super();
    this.config = config;
    FakePeerConnection.instances.push(this);
  }

  createDataChannel(label) {
    this.dataChannel = new FakeDataChannel();
    this.dataChannel.label = label;
    return this.dataChannel;
  }

  // Set to a description with no candidates to make a device that had no
  // network when it gathered, which is what a Wi-Fi drop looks like from here.
  static describeAs = null;

  async createOffer() {
    return { type: "offer", sdp: FakePeerConnection.describeAs ?? OFFER };
  }

  async createAnswer() {
    return { type: "answer", sdp: FakePeerConnection.describeAs ?? ANSWER };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
  }

  async setRemoteDescription(description) {
    this.remoteDescription = description;
  }

  close() {
    this.connectionState = "closed";
  }

  /** A candidate turning up while gathering carries on, as a real browser's do. */
  emitCandidate(type) {
    const event = new Event("icecandidate");
    event.candidate = { type };
    this.dispatchEvent(event);
  }

  finishIceGathering() {
    this.iceGatheringState = "complete";
    this.dispatchEvent(new Event("icegatheringstatechange"));
  }

  simulateConnectionFailure() {
    this.connectionState = "failed";
    this.dispatchEvent(new Event("connectionstatechange"));
  }

  /** The host's side dispatches a data channel the guest can attach to. */
  receiveDataChannel(channel) {
    const event = new Event("datachannel");
    event.channel = channel;
    this.dispatchEvent(event);
  }
}

function statesSeen(channel) {
  const seen = [];
  channel.subscribeState((state) => seen.push(state));
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakePeerConnection.instances = [];
  FakePeerConnection.describeAs = null;
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  postOffer.mockReset().mockResolvedValue(null);
  fetchOffer.mockReset();
  postAnswer.mockReset().mockResolvedValue(null);
  fetchAnswer.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the host role", () => {
  it("creates a data channel, an offer, and posts it once ICE gathering finishes", async () => {
    fetchAnswer.mockResolvedValue({ sdp: null });

    createPeerChannel({ role: PeerRole.HOST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];

    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());
    expect(postOffer).not.toHaveBeenCalled();

    pc.finishIceGathering();

    await vi.waitFor(() =>
      expect(postOffer).toHaveBeenCalledWith("ABC123", OFFER),
    );
  });

  it("polls for the answer and connects once the channel opens", async () => {
    fetchAnswer
      .mockResolvedValueOnce({ sdp: null })
      .mockResolvedValueOnce({ sdp: ANSWER_FROM_GUEST });

    const channel = createPeerChannel({ role: PeerRole.HOST, code: "ABC123" });
    const seen = statesSeen(channel);
    const pc = FakePeerConnection.instances[0];

    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());
    pc.finishIceGathering();
    await vi.waitFor(() => expect(postOffer).toHaveBeenCalled());

    // First poll finds nothing, waits, polls again.
    await vi.waitFor(() => expect(fetchAnswer).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(fetchAnswer).toHaveBeenCalledTimes(2));

    await vi.waitFor(() =>
      expect(pc.remoteDescription).toEqual({
        type: "answer",
        sdp: ANSWER_FROM_GUEST,
      }),
    );

    expect(channel.state).toBe(PeerState.CONNECTING);
    pc.dataChannel.simulateOpen();

    expect(channel.state).toBe(PeerState.CONNECTED);
    expect(seen).toContain(PeerState.CONNECTED);
  });

  it("falls back to whatever was gathered after its own timeout, independent of the overall one", async () => {
    fetchAnswer.mockResolvedValue({ sdp: null });

    // A connection timeout much larger than the ICE gathering timeout,
    // deliberately: this is the exact bug a real two-device test caught.
    // Gathering used to share timeoutMs with the overall connection timer,
    // so a slow gather could expire both at once and kill the connection
    // before the offer it had just produced was ever posted.
    createPeerChannel({
      role: PeerRole.HOST,
      code: "ABC123",
      timeoutMs: ICE_GATHERING_TIMEOUT_MS * 4,
    });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());

    // Gathering never completes on its own; its own fallback timer fires
    // instead, well before the overall connection timeout would.
    await vi.advanceTimersByTimeAsync(ICE_GATHERING_TIMEOUT_MS);

    await vi.waitFor(() => expect(postOffer).toHaveBeenCalled());
  });

  it("fails outright when this browser has no RTCPeerConnection at all", () => {
    vi.stubGlobal("RTCPeerConnection", undefined);

    const channel = createPeerChannel({ role: PeerRole.HOST, code: "ABC123" });

    expect(channel.state).toBe(PeerState.FAILED);
  });

  it("fails when the overall connection timeout elapses", async () => {
    fetchAnswer.mockResolvedValue({ sdp: null });

    const channel = createPeerChannel({
      role: PeerRole.HOST,
      code: "ABC123",
      timeoutMs: 3000,
    });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());
    pc.finishIceGathering();
    await vi.waitFor(() => expect(postOffer).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(3000);

    expect(channel.state).toBe(PeerState.FAILED);
  });

  it("fails when the underlying connection reports failed", async () => {
    fetchAnswer.mockResolvedValue({ sdp: null });

    const channel = createPeerChannel({ role: PeerRole.HOST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());

    pc.simulateConnectionFailure();

    expect(channel.state).toBe(PeerState.FAILED);
  });

  it("fails when the signaling server cannot be reached", async () => {
    postOffer.mockRejectedValue(new Error("network down"));

    const channel = createPeerChannel({ role: PeerRole.HOST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());
    pc.finishIceGathering();

    await vi.waitFor(() => expect(channel.state).toBe(PeerState.FAILED));
  });
});

describe("the guest role", () => {
  it("polls for the offer, answers it, and connects once the channel opens", async () => {
    fetchOffer
      .mockResolvedValueOnce({ sdp: null })
      .mockResolvedValueOnce({ sdp: OFFER_FROM_HOST });

    const channel = createPeerChannel({ role: PeerRole.GUEST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];

    await vi.waitFor(() => expect(fetchOffer).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => expect(fetchOffer).toHaveBeenCalledTimes(2));

    await vi.waitFor(() =>
      expect(pc.remoteDescription).toEqual({
        type: "offer",
        sdp: OFFER_FROM_HOST,
      }),
    );

    pc.finishIceGathering();
    await vi.waitFor(() =>
      expect(postAnswer).toHaveBeenCalledWith("ABC123", ANSWER),
    );

    expect(channel.state).toBe(PeerState.CONNECTING);

    const incoming = new FakeDataChannel();
    pc.receiveDataChannel(incoming);
    incoming.simulateOpen();

    expect(channel.state).toBe(PeerState.CONNECTED);
  });

  it("connects even when the channel is already open the moment it arrives", async () => {
    // The bug a real two-device test caught: SCTP can already have the
    // channel open by the time the guest's `datachannel` event fires, since
    // that event only fires once the channel exists, not before it is
    // usable. The `open` event that would normally trigger CONNECTED has
    // already happened by then, and a listener attached this late never
    // sees an event that already fired. In the real test this meant the
    // host always reached "connected" and the guest never did.
    fetchOffer.mockResolvedValueOnce({ sdp: OFFER_FROM_HOST });

    const channel = createPeerChannel({ role: PeerRole.GUEST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.remoteDescription).not.toBeNull());
    pc.finishIceGathering();
    await vi.waitFor(() => expect(postAnswer).toHaveBeenCalled());

    const incoming = new FakeDataChannel();
    incoming.readyState = "open"; // already open, no "open" event to come
    pc.receiveDataChannel(incoming);

    expect(channel.state).toBe(PeerState.CONNECTED);
  });
});

describe("sending and receiving messages", () => {
  async function connectedHostChannel() {
    fetchAnswer.mockResolvedValue({ sdp: ANSWER });
    const channel = createPeerChannel({ role: PeerRole.HOST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());
    pc.finishIceGathering();
    await vi.waitFor(() => expect(pc.remoteDescription).not.toBeNull());
    return { channel, dataChannel: pc.dataChannel };
  }

  it("queues a message sent before the channel opens, then delivers it once open", async () => {
    const { channel, dataChannel } = await connectedHostChannel();

    channel.send({ type: "question", result: { caption: "wo tiri" } });
    expect(dataChannel.sent).toHaveLength(0);

    dataChannel.simulateOpen();

    expect(dataChannel.sent).toEqual([
      JSON.stringify({ type: "question", result: { caption: "wo tiri" } }),
    ]);
  });

  it("sends immediately once already open", async () => {
    const { channel, dataChannel } = await connectedHostChannel();
    dataChannel.simulateOpen();

    channel.send({ type: "answer", value: "Yes" });

    expect(dataChannel.sent).toEqual([
      JSON.stringify({ type: "answer", value: "Yes" }),
    ]);
  });

  it("delivers a parsed message to every listener", async () => {
    const { channel, dataChannel } = await connectedHostChannel();
    dataChannel.simulateOpen();
    const received = [];
    channel.onMessage((message) => received.push(message));

    dataChannel.simulateMessage(JSON.stringify({ type: "answer", value: "No" }));

    expect(received).toEqual([{ type: "answer", value: "No" }]);
  });

  it("ignores a message that is not valid JSON rather than throwing", async () => {
    const { channel, dataChannel } = await connectedHostChannel();
    dataChannel.simulateOpen();
    const received = [];
    channel.onMessage((message) => received.push(message));

    expect(() => dataChannel.simulateMessage("not json")).not.toThrow();
    expect(received).toEqual([]);
  });

  it("stops delivering to a listener that unsubscribed", async () => {
    const { channel, dataChannel } = await connectedHostChannel();
    dataChannel.simulateOpen();
    const received = [];
    const unsubscribe = channel.onMessage((message) => received.push(message));
    unsubscribe();

    dataChannel.simulateMessage(JSON.stringify({ type: "answer", value: "Yes" }));

    expect(received).toEqual([]);
  });
});

describe("closing with something still on its way out", () => {
  // A real data channel spends a moment "closing", finishing what was queued
  // before it reports closed, and closing the connection in that moment throws
  // the queued messages away. The fake normally skips straight to closed.
  async function openChannel() {
    fetchAnswer.mockResolvedValue({ sdp: null });
    const channel = createPeerChannel({ role: PeerRole.HOST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());
    return { channel, pc, dc: pc.dataChannel };
  }

  it("keeps the connection up until the channel has finished closing", async () => {
    const { channel, pc, dc } = await openChannel();
    dc.simulateOpen();
    dc.close = function () {
      this.readyState = "closing";
    };

    channel.close();

    expect(channel.state).toBe(PeerState.CLOSED);
    expect(pc.connectionState).not.toBe("closed");

    dc.readyState = "closed";
    dc.dispatchEvent(new Event("close"));
    expect(pc.connectionState).toBe("closed");
  });

  it("closes the connection anyway if the channel never finishes", async () => {
    const { channel, pc, dc } = await openChannel();
    dc.simulateOpen();
    dc.close = function () {
      this.readyState = "closing";
    };

    channel.close();
    await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS + 50);

    expect(pc.connectionState).toBe("closed");
  });
});

describe("closing", () => {
  it("moves to closed and stops reacting to further events", async () => {
    fetchAnswer.mockResolvedValue({ sdp: null });
    const channel = createPeerChannel({ role: PeerRole.HOST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());

    channel.close();

    expect(channel.state).toBe(PeerState.CLOSED);
    expect(pc.connectionState).toBe("closed");

    // A late failure must not overwrite the deliberate close.
    pc.connectionState = "new";
    pc.simulateConnectionFailure();
    expect(channel.state).toBe(PeerState.CLOSED);
  });

  it("stops the answer/offer poll loop once closed", async () => {
    fetchAnswer.mockResolvedValue({ sdp: null });
    const channel = createPeerChannel({ role: PeerRole.HOST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());
    pc.finishIceGathering();
    await vi.waitFor(() => expect(fetchAnswer).toHaveBeenCalledTimes(1));

    channel.close();
    const callsAtClose = fetchAnswer.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);

    expect(fetchAnswer.mock.calls.length).toBe(callsAtClose);
  });

  it("does nothing the second time it is called", async () => {
    fetchAnswer.mockResolvedValue({ sdp: null });
    const channel = createPeerChannel({ role: PeerRole.HOST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());

    channel.close();
    expect(() => channel.close()).not.toThrow();
    expect(channel.state).toBe(PeerState.CLOSED);
  });
});

describe("hasCandidates", () => {
  it("is true for a description that offers an address", () => {
    expect(hasCandidates(OFFER)).toBe(true);
  });

  it("is false for one that offers none, which cannot lead to a connection", () => {
    expect(hasCandidates("v=0\r\na=ice-options:trickle\r\na=mid:0")).toBe(false);
  });

  it.each([null, undefined, "", 42, {}])("is false for %s", (value) => {
    expect(hasCandidates(value)).toBe(false);
  });

  it("does not mistake the word for a candidate line", () => {
    expect(hasCandidates("a=x-note: no candidate here")).toBe(false);
  });
});

describe("a device with no network when it gathers", () => {
  // Real: a laptop's Wi-Fi dropped and came back in the middle of pairing, both
  // browsers posted descriptions with no candidates in them, and each sat
  // "connecting" until the timeout, waiting to reach an address neither had
  // offered. The description is checked before it is sent.
  const NONE = "v=0\r\na=ice-options:trickle\r\na=mid:0";

  it("the host fails at once, saying why, and posts nothing", async () => {
    FakePeerConnection.describeAs = NONE;
    fetchAnswer.mockResolvedValue({ sdp: null });

    const channel = createPeerChannel({ role: PeerRole.HOST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());
    pc.finishIceGathering();

    await vi.waitFor(() => expect(channel.state).toBe(PeerState.FAILED));
    expect(channel.failure).toBe("no-network");
    expect(postOffer).not.toHaveBeenCalled();
  });

  it("the guest fails at once, saying why, and posts nothing", async () => {
    fetchOffer.mockResolvedValue({ sdp: OFFER_FROM_HOST });
    FakePeerConnection.describeAs = NONE;

    const channel = createPeerChannel({ role: PeerRole.GUEST, code: "ABC123" });
    await vi.waitFor(() => expect(FakePeerConnection.instances[0].localDescription).not.toBeNull());
    FakePeerConnection.instances[0].finishIceGathering();

    await vi.waitFor(() => expect(channel.state).toBe(PeerState.FAILED));
    expect(channel.failure).toBe("no-network");
    expect(postAnswer).not.toHaveBeenCalled();
  });

  it("says nothing about why when it simply timed out", async () => {
    fetchAnswer.mockResolvedValue({ sdp: null });
    const channel = createPeerChannel({ role: PeerRole.HOST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());
    pc.finishIceGathering();

    await vi.advanceTimersByTimeAsync(30000);

    expect(channel.state).toBe(PeerState.FAILED);
    expect(channel.failure).toBeNull();
  });

  it("the host does not act on an answer with no candidates, and waits for a real one", async () => {
    fetchAnswer
      .mockResolvedValueOnce({ sdp: NONE })
      .mockResolvedValueOnce({ sdp: NONE })
      .mockResolvedValue({ sdp: ANSWER_FROM_GUEST });

    createPeerChannel({ role: PeerRole.HOST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());
    pc.finishIceGathering();
    await vi.advanceTimersByTimeAsync(5000);

    expect(pc.remoteDescription).toEqual({ type: "answer", sdp: ANSWER_FROM_GUEST });
  });

  it("the guest does not act on an offer with no candidates, such as a leftover", async () => {
    fetchOffer
      .mockResolvedValueOnce({ sdp: NONE })
      .mockResolvedValue({ sdp: OFFER_FROM_HOST });

    createPeerChannel({ role: PeerRole.GUEST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];
    await vi.advanceTimersByTimeAsync(5000);

    expect(pc.remoteDescription).toEqual({ type: "offer", sdp: OFFER_FROM_HOST });
  });

  it("the guest never answers an offer with no candidates", async () => {
    fetchOffer.mockResolvedValue({ sdp: NONE });

    createPeerChannel({ role: PeerRole.GUEST, code: "ABC123" });
    await vi.advanceTimersByTimeAsync(5000);

    expect(postAnswer).not.toHaveBeenCalled();
    expect(FakePeerConnection.instances[0].remoteDescription).toBeNull();
  });
});

describe("not waiting for gathering to finish", () => {
  // Measured in two real browsers: gathering routinely never reports complete,
  // so waiting for it made every connection and every reconnection after a
  // refresh take the whole ICE budget on each side, about ten seconds, for a
  // message whose useful contents were there in a fraction of a second.
  async function hostGathering() {
    fetchAnswer.mockResolvedValue({ sdp: null });
    createPeerChannel({ role: PeerRole.HOST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());
    return pc;
  }

  it("goes as soon as an address that works across networks has arrived and gone quiet", async () => {
    const pc = await hostGathering();

    pc.emitCandidate("host");
    pc.emitCandidate("srflx");
    await vi.advanceTimersByTimeAsync(CANDIDATE_QUIET_MS + 20);

    expect(postOffer).toHaveBeenCalledWith("ABC123", OFFER);
  });

  it("does not go the instant one arrives: more may be about to", async () => {
    const pc = await hostGathering();

    pc.emitCandidate("host");
    pc.emitCandidate("srflx");
    await vi.advanceTimersByTimeAsync(CANDIDATE_QUIET_MS - 50);

    expect(postOffer).not.toHaveBeenCalled();
  });

  it("waits for a late one, each new candidate restarting the quiet time", async () => {
    const pc = await hostGathering();

    pc.emitCandidate("srflx");
    await vi.advanceTimersByTimeAsync(CANDIDATE_QUIET_MS - 50);
    pc.emitCandidate("srflx");
    await vi.advanceTimersByTimeAsync(CANDIDATE_QUIET_MS - 50);
    expect(postOffer).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(postOffer).toHaveBeenCalled();
  });

  it("holds out a little for one that works across networks when only local ones have come", async () => {
    // A host address alone only ever works on the same network, so posting it
    // at once would make the internet case fail. The wait is short, though.
    const pc = await hostGathering();

    pc.emitCandidate("host");
    await vi.advanceTimersByTimeAsync(CANDIDATE_HOST_ONLY_MS - 200);
    expect(postOffer).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    expect(postOffer).toHaveBeenCalled();
  });

  it("goes early when the late one turns up", async () => {
    const pc = await hostGathering();

    pc.emitCandidate("host");
    await vi.advanceTimersByTimeAsync(400);
    pc.emitCandidate("srflx");
    await vi.advanceTimersByTimeAsync(CANDIDATE_QUIET_MS + 20);

    expect(postOffer).toHaveBeenCalled();
  });

  it("counts a relayed address as one that works across networks", async () => {
    const pc = await hostGathering();

    pc.emitCandidate("relay");
    await vi.advanceTimersByTimeAsync(CANDIDATE_QUIET_MS + 20);

    expect(postOffer).toHaveBeenCalled();
  });

  it("still goes the moment gathering says it is complete", async () => {
    const pc = await hostGathering();

    pc.finishIceGathering();

    await vi.waitFor(() => expect(postOffer).toHaveBeenCalled());
  });

  it("with no candidate at all, waits for complete or the hard limit, as before", async () => {
    await hostGathering();

    await vi.advanceTimersByTimeAsync(ICE_GATHERING_TIMEOUT_MS - 500);
    expect(postOffer).not.toHaveBeenCalled();
  });

  it("the guest is as quick as the host", async () => {
    fetchOffer.mockResolvedValue({ sdp: OFFER_FROM_HOST });
    createPeerChannel({ role: PeerRole.GUEST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());

    pc.emitCandidate("host");
    pc.emitCandidate("srflx");
    await vi.advanceTimersByTimeAsync(CANDIDATE_QUIET_MS + 20);

    expect(postAnswer).toHaveBeenCalledWith("ABC123", ANSWER);
  });
});

describe("how often the other device's message is looked for", () => {
  it("looks quickly to begin with", async () => {
    fetchAnswer.mockResolvedValue({ sdp: null });
    createPeerChannel({ role: PeerRole.HOST, code: "ABC123" });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());
    pc.finishIceGathering();
    await vi.waitFor(() => expect(fetchAnswer).toHaveBeenCalledTimes(1));
    fetchAnswer.mockClear();

    await vi.advanceTimersByTimeAsync(FAST_POLL_MS * 5 + 50);

    expect(fetchAnswer.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("settles to the old pace when the other device is genuinely not there", async () => {
    fetchAnswer.mockResolvedValue({ sdp: null });
    createPeerChannel({ role: PeerRole.HOST, code: "ABC123", timeoutMs: 120000 });
    const pc = FakePeerConnection.instances[0];
    await vi.waitFor(() => expect(pc.localDescription).not.toBeNull());
    pc.finishIceGathering();
    await vi.advanceTimersByTimeAsync(FAST_POLL_MS * 32);
    fetchAnswer.mockClear();

    await vi.advanceTimersByTimeAsync(SLOW_POLL_MS * 4 + 100);

    expect(fetchAnswer.mock.calls.length).toBeLessThanOrEqual(5);
  });
});

describe("going back to a consultation by its long token", () => {
  const TOKEN = "k3Jx9_-Qm2LpV8wZr5TnYA";
  const notFound = () => Object.assign(new Error("404"), { status: 404 });

  it("waits out a doctor's device that is not there yet, rather than giving up", async () => {
    fetchOffer
      .mockRejectedValueOnce(notFound())
      .mockRejectedValueOnce(notFound())
      .mockResolvedValue({ sdp: OFFER_FROM_HOST });

    const channel = createPeerChannel({ role: PeerRole.GUEST, code: TOKEN });
    const pc = FakePeerConnection.instances[0];
    await vi.advanceTimersByTimeAsync(2000);

    expect(pc.remoteDescription).toEqual({ type: "offer", sdp: OFFER_FROM_HOST });
    expect(channel.state).toBe(PeerState.CONNECTING);
  });

  it("still fails at once for a wrong code typed in by hand", async () => {
    fetchOffer.mockRejectedValue(notFound());

    const channel = createPeerChannel({ role: PeerRole.GUEST, code: "ABC123" });
    await vi.advanceTimersByTimeAsync(1000);

    expect(channel.state).toBe(PeerState.FAILED);
  });

  it("still fails on any other error, even by token", async () => {
    fetchOffer.mockRejectedValue(Object.assign(new Error("500"), { status: 500 }));

    const channel = createPeerChannel({ role: PeerRole.GUEST, code: TOKEN });
    await vi.advanceTimersByTimeAsync(1000);

    expect(channel.state).toBe(PeerState.FAILED);
  });

  it("learns that the doctor ended it, which is a 410 and not a wait", async () => {
    fetchOffer.mockRejectedValue(Object.assign(new Error("410"), { status: 410 }));

    const channel = createPeerChannel({ role: PeerRole.GUEST, code: TOKEN });
    await vi.advanceTimersByTimeAsync(1000);

    expect(channel.state).toBe(PeerState.ENDED);
  });
});
