import { describe, expect, it } from "vitest";

import { TARGET_SAMPLE_RATE, encodeWav, encodeWavBuffer } from "../audio/wav.js";

/**
 * The WAV header is a binary contract. If a field is wrong, the recording
 * either fails to decode or decodes as noise, and the error surfaces from the
 * speech service as an unhelpful 400 rather than from here. So it is asserted
 * byte by byte.
 */

function readHeader(samples, sampleRate) {
  return new DataView(encodeWavBuffer(samples, sampleRate));
}

function ascii(view, offset, length) {
  return Array.from({ length }, (_, i) =>
    String.fromCharCode(view.getUint8(offset + i)),
  ).join("");
}

describe("encodeWav", () => {
  it("writes a RIFF WAVE container", () => {
    const view = readHeader(new Float32Array(4));

    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(ascii(view, 8, 4)).toBe("WAVE");
    expect(ascii(view, 12, 4)).toBe("fmt ");
    expect(ascii(view, 36, 4)).toBe("data");
  });

  it("declares uncompressed mono PCM at 16 bits", () => {
    const view = readHeader(new Float32Array(4));

    expect(view.getUint16(20, true)).toBe(1); // 1 means PCM, not compressed
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });

  it("declares the sample rate it was given", () => {
    const view = readHeader(new Float32Array(4), 16000);

    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(16000 * 2); // bytes per second
    expect(view.getUint16(32, true)).toBe(2); // bytes per frame
  });

  it("defaults to the rate speech recognition expects", () => {
    const view = readHeader(new Float32Array(4));

    expect(TARGET_SAMPLE_RATE).toBe(16000);
    expect(view.getUint32(24, true)).toBe(16000);
  });

  it("reports sizes that match the sample count", () => {
    const view = readHeader(new Float32Array(10));

    // 10 samples at 2 bytes each.
    expect(view.getUint32(40, true)).toBe(20);
    // Everything after the first 8 bytes.
    expect(view.getUint32(4, true)).toBe(36 + 20);
  });

  it("converts float samples to signed 16 bit values", () => {
    const view = readHeader(Float32Array.from([0, 1, -1]));

    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
  });

  it("clamps samples beyond full scale instead of letting them wrap", () => {
    // Without clamping, a sample above 1 overflows into a large negative
    // number, so the loudest part of a word becomes a burst of noise, which is
    // exactly the part a transcriber needs most.
    const view = readHeader(Float32Array.from([1.8, -2.5]));

    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  it("produces a blob a server will recognize as WAV", () => {
    const wav = encodeWav(new Float32Array(8));

    expect(wav.type).toBe("audio/wav");
    expect(wav.size).toBe(44 + 16);
  });

  it("handles an empty recording without producing a malformed file", () => {
    const wav = encodeWav(new Float32Array(0));
    const view = readHeader(new Float32Array(0));

    expect(wav.size).toBe(44);
    expect(view.getUint32(40, true)).toBe(0);
  });
});
