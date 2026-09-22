import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InstallApp from "../components/InstallApp.jsx";
import { detectPlatform } from "../pwa/platform.js";

/**
 * Installing the app, NFR 5, on the devices that do it differently.
 *
 * Chrome on Android offers a dialog. Safari on an iPhone offers nothing: it is
 * the Share button and "Add to Home Screen", by hand, and only from Safari. A
 * patient shown the wrong steps for their device concludes the app cannot be
 * installed. Reported from a real iPhone, where it "did not work" while on an
 * Android phone it did.
 */

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1";
const IPHONE_FIREFOX =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15";
const IPHONE_INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.12.109";
const IPHONE_WEBVIEW =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const MAC_SAFARI = IPAD_AS_MAC;

const on = (userAgent, extra = {}) => ({ userAgent, platform: "", maxTouchPoints: 0, ...extra });

describe("which device this is", () => {
  it("knows Safari on an iPhone", () => {
    expect(detectPlatform(on(IPHONE_SAFARI))).toMatchObject({
      ios: true,
      iosSafari: true,
      iosOther: false,
    });
  });

  it.each([
    ["Chrome", IPHONE_CHROME],
    ["Firefox", IPHONE_FIREFOX],
    ["a page inside Instagram", IPHONE_INSTAGRAM],
    ["a bare web view", IPHONE_WEBVIEW],
  ])("knows %s on an iPhone is not Safari", (_name, ua) => {
    expect(detectPlatform(on(ua))).toMatchObject({ ios: true, iosSafari: false, iosOther: true });
  });

  it("knows an iPad that calls itself a Mac, by its touch screen", () => {
    expect(
      detectPlatform(on(IPAD_AS_MAC, { platform: "MacIntel", maxTouchPoints: 5 })),
    ).toMatchObject({ ios: true, iosSafari: true });
  });

  it("does not mistake a Mac for an iPad", () => {
    expect(detectPlatform(on(MAC_SAFARI, { platform: "MacIntel", maxTouchPoints: 0 }))).toMatchObject({
      ios: false,
    });
  });

  it("knows Android", () => {
    expect(detectPlatform(on(ANDROID_CHROME))).toMatchObject({ android: true, ios: false });
  });

  it("knows nothing special of a computer", () => {
    expect(detectPlatform(on(DESKTOP_CHROME))).toMatchObject({ android: false, ios: false });
  });
});

describe("the install control", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  function asDevice(userAgent, extra = {}) {
    vi.stubGlobal("navigator", { ...navigator, userAgent, platform: "", maxTouchPoints: 0, ...extra });
  }

  async function openHelp() {
    render(<InstallApp />);
    await userEvent.click(screen.getByTestId("install-app"));
    return screen.getByTestId("install-help");
  }

  it("on Safari on an iPhone, shows the Share and Add to Home Screen steps and nothing for other devices", async () => {
    asDevice(IPHONE_SAFARI);

    const help = await openHelp();

    expect(within(help).getByTestId("install-steps-ios")).toHaveTextContent(/Share/);
    expect(help).toHaveTextContent(/Add to Home Screen/);
    expect(within(help).queryByTestId("install-steps-android")).not.toBeInTheDocument();
    expect(within(help).queryByTestId("install-steps-computer")).not.toBeInTheDocument();
    expect(within(help).queryByTestId("install-steps-ios-other")).not.toBeInTheDocument();
  });

  it("draws the Share button the patient is to look for", async () => {
    asDevice(IPHONE_SAFARI);

    const help = await openHelp();

    expect(within(help).getByRole("img", { name: /share icon/i })).toBeInTheDocument();
  });

  it("warns that the installed app starts fresh, so it is not done mid consultation", async () => {
    asDevice(IPHONE_SAFARI);

    const help = await openHelp();

    expect(within(help).getByTestId("install-ios-note")).toHaveTextContent(/not in the middle of one/i);
  });

  it("in Chrome on an iPhone, says it has to be Safari, and offers the address to take there", async () => {
    asDevice(IPHONE_CHROME);

    const help = await openHelp();

    const other = within(help).getByTestId("install-steps-ios-other");
    expect(other).toHaveTextContent(/only be added to the home screen from Safari/i);
    expect(within(other).getByTestId("install-address")).toHaveTextContent(window.location.href);
    expect(other).toHaveTextContent(/Add to Home Screen/);
  });

  it("copies the address for the patient to paste into Safari", async () => {
    asDevice(IPHONE_CHROME, { clipboard: { writeText: vi.fn().mockResolvedValue() } });

    await openHelp();
    await userEvent.click(screen.getByTestId("copy-address"));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("on Android, shows the Android steps only", async () => {
    asDevice(ANDROID_CHROME);

    const help = await openHelp();

    expect(within(help).getByTestId("install-steps-android")).toHaveTextContent(/Install app/);
    expect(within(help).queryByTestId("install-steps-ios")).not.toBeInTheDocument();
  });

  it("on an unknown device, shows every set, since it cannot tell which is wanted", async () => {
    asDevice(DESKTOP_CHROME);

    const help = await openHelp();

    expect(within(help).getByTestId("install-steps-ios")).toBeInTheDocument();
    expect(within(help).getByTestId("install-steps-android")).toBeInTheDocument();
    expect(within(help).getByTestId("install-steps-computer")).toBeInTheDocument();
  });

  it("is a sheet over the screen, out of the bar the button sits in, so it can always be seen", async () => {
    asDevice(IPHONE_SAFARI);
    const { container } = render(<InstallApp />);

    await userEvent.click(screen.getByTestId("install-app"));

    expect(container.querySelector('[data-testid="install-help"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="install-help"]')).not.toBeNull();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("closes from its own button, and from the shaded screen around it", async () => {
    asDevice(IPHONE_SAFARI);
    await openHelp();

    await userEvent.click(screen.getByTestId("close-install-help"));
    expect(screen.queryByTestId("install-help")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("install-app"));
    await userEvent.click(screen.getByTestId("install-overlay"));
    expect(screen.queryByTestId("install-help")).not.toBeInTheDocument();
  });

  it("does not close when the sheet itself is tapped", async () => {
    asDevice(IPHONE_SAFARI);
    const help = await openHelp();

    await userEvent.click(help);

    expect(screen.getByTestId("install-help")).toBeInTheDocument();
  });

  it("is not offered once the app is installed, on an iPhone's own flag as well", () => {
    asDevice(IPHONE_SAFARI, { standalone: true });

    render(<InstallApp />);

    expect(screen.queryByTestId("install-app")).not.toBeInTheDocument();
  });
});
