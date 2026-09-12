import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toWavFile } from "../audio/wav.js";
import useAudioRecorder, {
  isRecordingSupported,
  pickMimeType,
  recordingSupport,
} from "../hooks/useAudioRecorder.js";

vi.mock("../audio/wav.js", () => ({ toWavFile: vi.fn() }));

/**
 * FR 1.2, capturing the doctor's speech in the browser.
 *
 * jsdom has no MediaRecorder and no microphone, so these tests stand one in.
 * That is honest about what they prove: the state machine, the format choice,
 * and crucially that the microphone is released. They do not prove audio
 * actually records, which needs a real device.
 */

class FakeMediaRecorder {
  static supported = ["audio/webm;codecs=opus", "audio/webm"];
  static isTypeSupported = (type) => FakeMediaRecorder.supported.includes(type);

  constructor(stream, options = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType ?? "audio/webm";
    this.state = "inactive";
    FakeMediaRecorder.last = this;
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    // A real recorder emits any buffered audio before firing onstop.
    this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function fakeStream() {
  const track = { stop: vi.fn(), kind: "audio" };
  return { getTracks: () => [track], _track: track };
}

let stream;

beforeEach(() => {
  stream = fakeStream();
  toWavFile.mockResolvedValue(new Blob(["RIFFWAVE"], { type: "audio/wav" }));
  FakeMediaRecorder.supported = ["audio/webm;codecs=opus", "audio/webm"];
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("navigator", {
    ...globalThis.navigator,
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("recording support detection", () => {
  it("reports support when the browser has both pieces", () => {
    expect(isRecordingSupported()).toBe(true);
  });

  it("reports no support when MediaRecorder is missing", () => {
    // NFR 6 lists Safari and Firefox on both Android and iOS. The app must
    // fall back to typing rather than offering a button that cannot work.
    vi.stubGlobal("MediaRecorder", undefined);

    expect(isRecordingSupported()).toBe(false);
  });

  it("reports no support when microphone access is unavailable", () => {
    vi.stubGlobal("navigator", { ...globalThis.navigator, mediaDevices: undefined });

    expect(isRecordingSupported()).toBe(false);
  });
});

describe("secure context requirement", () => {
  it("reports ok on a secure origin with the APIs present", () => {
    vi.stubGlobal("window", { ...globalThis.window, isSecureContext: true });

    expect(recordingSupport()).toBe("ok");
  });

  it("blames the connection, not the browser, on an insecure origin", () => {
    // getUserMedia is gated on a secure context. A phone opening the app over
    // plain http on a hospital network gets no microphone and no error, and
    // ADR 007 deliberately leaves HTTPS off for demos, so this is the case a
    // hospital demo actually lands in.
    vi.stubGlobal("window", { ...globalThis.window, isSecureContext: false });

    expect(recordingSupport()).toBe("insecure");
    expect(isRecordingSupported()).toBe(false);
  });
});

describe("audio format choice", () => {
  it("prefers opus in webm when the browser supports it", () => {
    expect(pickMimeType()).toBe("audio/webm;codecs=opus");
  });

  it("falls back to a format Safari supports", () => {
    // Safari on iOS records audio/mp4, not webm. Hardcoding webm would make
    // the microphone silently unusable on every iPhone.
    FakeMediaRecorder.supported = ["audio/mp4"];

    expect(pickMimeType()).toBe("audio/mp4");
  });

  it("lets the browser choose when it supports none of our candidates", () => {
    FakeMediaRecorder.supported = [];

    expect(pickMimeType()).toBe("");
  });
});

describe("useAudioRecorder", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useAudioRecorder());

    expect(result.current.status).toBe("idle");
  });

  it("reports recording once the microphone is granted", async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.status).toBe("recording");
  });

  it("resolves with WAV audio when stopped", async () => {
    // No browser records a format speech recognition reliably accepts, so the
    // recording is converted before it ever leaves the device. ADR 018.
    const { result } = renderHook(() => useAudioRecorder());
    await act(async () => {
      await result.current.start();
    });

    let audio;
    await act(async () => {
      audio = await result.current.stop();
    });

    expect(toWavFile).toHaveBeenCalledOnce();
    expect(audio.type).toBe("audio/wav");
  });

  it("reports a failure rather than uploading audio it could not convert", async () => {
    // Uploading the raw recording would spend a metered transcription call on
    // a format the service cannot read.
    toWavFile.mockRejectedValue(new Error("cannot decode"));
    const { result } = renderHook(() => useAudioRecorder());
    await act(async () => {
      await result.current.start();
    });

    let audio;
    await act(async () => {
      audio = await result.current.stop();
    });

    expect(audio).toBeNull();
    expect(result.current.status).toBe("failed");
  });

  it("releases the microphone even when conversion fails", async () => {
    toWavFile.mockRejectedValue(new Error("cannot decode"));
    const { result } = renderHook(() => useAudioRecorder());
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await result.current.stop();
    });

    expect(stream._track.stop).toHaveBeenCalled();
  });

  it("releases the microphone when recording stops", async () => {
    // If the track is left running the browser keeps showing the microphone as
    // live. In a consultation about something private, a recording indicator
    // that stays on after the doctor stopped speaking is a real problem, not a
    // cosmetic one.
    const { result } = renderHook(() => useAudioRecorder());
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await result.current.stop();
    });

    expect(stream._track.stop).toHaveBeenCalled();
  });

  it("returns to idle after stopping", async () => {
    const { result } = renderHook(() => useAudioRecorder());
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.status).toBe("idle");
  });

  it("reports a refused microphone instead of appearing to record", async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValue(
      new DOMException("denied", "NotAllowedError"),
    );
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => {
      expect(result.current.status).toBe("denied");
    });
  });

  it("releases the microphone if the recorder fails to start", async () => {
    vi.stubGlobal(
      "MediaRecorder",
      class Broken {
        static isTypeSupported = () => true;
        constructor() {
          throw new Error("cannot record");
        }
      },
    );
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current.start();
    });

    // Permission was already granted at this point, so the stream exists and
    // would stay open forever without explicit cleanup.
    expect(stream._track.stop).toHaveBeenCalled();
    expect(result.current.status).toBe("failed");
  });

  it("releases the microphone if the component unmounts mid recording", async () => {
    const { result, unmount } = renderHook(() => useAudioRecorder());
    await act(async () => {
      await result.current.start();
    });

    unmount();

    expect(stream._track.stop).toHaveBeenCalled();
  });

  it("stopping without recording resolves with nothing", async () => {
    const { result } = renderHook(() => useAudioRecorder());

    let audio;
    await act(async () => {
      audio = await result.current.stop();
    });

    expect(audio).toBeNull();
  });
});
