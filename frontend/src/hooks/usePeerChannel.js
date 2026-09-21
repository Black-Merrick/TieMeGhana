import { useCallback, useEffect, useRef, useState } from "react";

import { PeerState, createPeerChannel } from "../webrtc/peerChannel.js";

/**
 * The React side of a device to device connection: opens one on mount,
 * closes it on unmount, and turns its state and incoming messages into
 * values a component can render from.
 *
 * `attempt` opens a fresh connection under the same code, for a device
 * coming back to a rendezvous it has used before. Part of the key state is
 * scoped to, so nothing from the attempt before leaks into the next.
 *
 * `lastMessage` rather than a subscribe function. A callback handed back
 * from this hook would only be safe to call once the component's own effects
 * have run, and the peer connection can otherwise open and receive a message
 * before that happens. Putting the newest message in state instead means a
 * `useEffect` watching it fires correctly no matter when it was added,
 * because React re-renders regardless of when a component started watching.
 */
export default function usePeerChannel({ role, code, attempt = 0 }) {
  // State and message are kept together with the connection they belong to,
  // and only handed out while that is still the current one. Held as plain
  // values they outlived their connection: after one pairing ended, the next
  // code's first render still read "connected" and the previous patient's
  // last message, which discarded the new code the instant it was minted and
  // would have spoken an old reply to the next patient. Found running two
  // real browsers through two pairings in a row.
  const key = code ? `${role}:${code}:${attempt}` : null;
  const [snapshot, setSnapshot] = useState({
    key: null,
    state: PeerState.CONNECTING,
    failure: null,
    message: null,
  });
  const channelRef = useRef(null);

  useEffect(() => {
    if (!code) return undefined;

    const channel = createPeerChannel({ role, code });
    const own = `${role}:${code}:${attempt}`;
    channelRef.current = channel;
    setSnapshot({ key: own, state: channel.state, failure: null, message: null });

    const update = (change) =>
      setSnapshot((previous) =>
        previous.key === own ? { ...previous, ...change } : previous,
      );
    const unsubscribeState = channel.subscribeState((next) =>
      update({ state: next, failure: channel.failure ?? null }),
    );
    const unsubscribeMessage = channel.onMessage((message) =>
      update({ message }),
    );

    return () => {
      unsubscribeState();
      unsubscribeMessage();
      channel.close();
      channelRef.current = null;
    };
  }, [role, code, attempt]);

  const send = useCallback((message) => {
    channelRef.current?.send(message);
  }, []);

  const close = useCallback(() => {
    channelRef.current?.close();
  }, []);

  const current = key && snapshot.key === key ? snapshot : null;
  return {
    state: current?.state ?? PeerState.CONNECTING,
    // Why it failed, when there is a reason worth telling apart. See peerChannel.
    failure: current?.failure ?? null,
    send,
    lastMessage: current?.message ?? null,
    close,
  };
}
