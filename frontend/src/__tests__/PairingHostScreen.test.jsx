import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import PairingHostScreen from "../components/PairingHostScreen.jsx";
import { PeerState } from "../webrtc/peerChannel.js";

/**
 * What the doctor sees while the patient's phone is not connected. The
 * session itself is owned by App (usePairedHostSession, tested on its own),
 * so this only has to show it honestly.
 */

function session(overrides = {}) {
  return {
    code: "ABC123",
    state: PeerState.CONNECTING,
    codeFailed: false,
    retry: vi.fn(),
    ...overrides,
  };
}

describe("waiting for the patient's phone", () => {
  it("shows the code", () => {
    render(<PairingHostScreen session={session()} />);

    expect(screen.getByTestId("pairing-code")).toHaveTextContent("ABC123");
  });

  it("says it is still getting a code before there is one", () => {
    render(<PairingHostScreen session={session({ code: null })} />);

    expect(screen.queryByTestId("pairing-code")).not.toBeInTheDocument();
    expect(screen.getByText(/getting a code/i)).toBeInTheDocument();
  });

  it("tells the doctor exactly where the patient goes, and what to tap", () => {
    render(<PairingHostScreen session={session()} />);

    // The address as this page is served, not a path the patient has to know
    // is on the end of one.
    expect(screen.getByText(window.location.host)).toBeInTheDocument();
    expect(screen.getByText(/i'm a patient/i)).toBeInTheDocument();
  });

  it("lets the doctor give up and use this device instead", async () => {
    const onUseThisDeviceInstead = vi.fn();
    render(
      <PairingHostScreen
        session={session()}
        onUseThisDeviceInstead={onUseThisDeviceInstead}
      />,
    );

    await userEvent.click(screen.getByTestId("pairing-use-this-device"));

    expect(onUseThisDeviceInstead).toHaveBeenCalled();
  });

  it("is a first pairing by default", () => {
    render(<PairingHostScreen session={session()} />);

    expect(
      screen.getByRole("heading", { name: /pair the patient's phone/i }),
    ).toBeInTheDocument();
  });

  it("says reconnect, not pair, when a visit is already under way", () => {
    render(<PairingHostScreen session={session()} reconnecting />);

    expect(
      screen.getByRole("heading", { name: /reconnect the patient's phone/i }),
    ).toBeInTheDocument();
  });
});

describe("when the two devices cannot connect", () => {
  it("says so plainly rather than hanging", () => {
    render(<PairingHostScreen session={session({ state: PeerState.FAILED })} />);

    expect(screen.getByTestId("pairing-failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't connect/i);
  });

  it("offers to try again and to carry on with this device", () => {
    render(<PairingHostScreen session={session({ state: PeerState.FAILED })} />);

    expect(screen.getByTestId("pairing-try-again")).toBeInTheDocument();
    expect(screen.getByTestId("pairing-use-this-device")).toBeInTheDocument();
  });

  it("asks the session for a fresh code on try again", async () => {
    const retry = vi.fn();
    render(
      <PairingHostScreen session={session({ state: PeerState.FAILED, retry })} />,
    );

    await userEvent.click(screen.getByTestId("pairing-try-again"));

    expect(retry).toHaveBeenCalled();
  });

  it("reports a code that could not be minted differently from a failed connection", () => {
    render(<PairingHostScreen session={session({ code: null, codeFailed: true })} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/could not open a pairing code/i);
  });

  it("says the patient's device was disconnected when the visit was already going", () => {
    render(
      <PairingHostScreen
        session={session({ state: PeerState.CLOSED })}
        reconnecting
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/was disconnected/i);
  });

  it("treats a connection that closed as failed, not as still waiting", () => {
    render(<PairingHostScreen session={session({ state: PeerState.CLOSED })} />);

    expect(screen.getByTestId("pairing-failed")).toBeInTheDocument();
    expect(screen.queryByTestId("pairing-host-waiting")).not.toBeInTheDocument();
  });
});

describe("when this device has no network just now", () => {
  const offline = () =>
    session({ state: PeerState.FAILED, failure: "no-network" });

  it("is not called a failure: it is tried again by itself", () => {
    render(<PairingHostScreen session={offline()} />);

    expect(screen.queryByTestId("pairing-failed")).not.toBeInTheDocument();
    expect(screen.getByTestId("pairing-host-waiting")).toBeInTheDocument();
  });

  it("says what is happening and that the code stays the same", () => {
    render(<PairingHostScreen session={offline()} />);

    expect(screen.getByTestId("pairing-no-network")).toHaveTextContent(/no network connection/i);
    expect(screen.getByTestId("pairing-no-network")).toHaveTextContent(/code stays the same/i);
  });

  it("keeps the code on screen, since the patient may be typing it", () => {
    render(<PairingHostScreen session={offline()} />);

    expect(screen.getByTestId("pairing-code")).toHaveTextContent("ABC123");
  });

  it("does not say it when there is nothing wrong", () => {
    render(<PairingHostScreen session={session()} />);

    expect(screen.queryByTestId("pairing-no-network")).not.toBeInTheDocument();
  });

  it("still calls an ordinary failure a failure", () => {
    render(<PairingHostScreen session={session({ state: PeerState.FAILED, failure: null })} />);

    expect(screen.getByTestId("pairing-failed")).toBeInTheDocument();
  });
});
