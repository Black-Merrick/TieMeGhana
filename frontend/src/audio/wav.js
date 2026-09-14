/**
 * Converting a browser recording into 16 kHz mono WAV.
 *
 * MediaRecorder cannot produce WAV or MP3 in any browser. Chrome and Firefox
 * record WebM with Opus, Safari records MP4 with AAC, and a speech recognition
 * service generally wants neither. Khaya's own client examples transcribe from
 * plain audio files, so we convert before uploading. See ADR 018.
 *
 * 16 kHz mono is deliberate rather than arbitrary. It is the standard input
 * rate for speech recognition, so it is what the model expects, and it is
 * about a tenth the size of 48 kHz stereo, which matters on the hospital
 * connections NFR 5 describes.
 */

// Speech recognition models are trained at this rate. Sending more is wasted
// bandwidth, sending less loses intelligibility.
export const TARGET_SAMPLE_RATE = 16000;

const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2; // 16 bit PCM

/**
 * Build the bytes of a 16 bit PCM WAV file from mono float samples.
 *
 * Separate from `encodeWav` so the header layout can be asserted byte by byte
 * without a Blob in the way. The WAV header is a binary contract, and a wrong
 * field surfaces as an unhelpful 400 from the speech service rather than as an
 * error here, so it is worth testing directly.
 */
export function encodeWavBuffer(samples, sampleRate = TARGET_SAMPLE_RATE) {
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const view = new DataView(new ArrayBuffer(WAV_HEADER_BYTES + dataBytes));

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true); // size of everything after this field
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk length
  view.setUint16(20, 1, true); // 1 means uncompressed PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true); // bytes per second
  view.setUint16(32, BYTES_PER_SAMPLE, true); // bytes per frame
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true); // bits per sample

  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i += 1) {
    // Clamped because a sample above 1 would wrap around to a large negative
    // value, turning a loud word into a burst of noise.
    const sample = Math.max(-1, Math.min(1, samples[i]));
    const scaled = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(WAV_HEADER_BYTES + i * BYTES_PER_SAMPLE, scaled, true);
  }

  return view.buffer;
}

/** Encode mono float samples as a WAV file ready to upload. */
export function encodeWav(samples, sampleRate = TARGET_SAMPLE_RATE) {
  return new Blob([encodeWavBuffer(samples, sampleRate)], { type: "audio/wav" });
}

/**
 * Decode a recording and re encode it as 16 kHz mono WAV.
 *
 * Decoding is done by the browser's own audio stack, which is why this works
 * on both Chrome and Safari: each can decode the format it just recorded,
 * whatever that was. Resampling and downmixing are handed to
 * OfflineAudioContext rather than done by hand, because a naive resampler
 * aliases and makes speech harder to transcribe, not easier.
 */
export async function toWavFile(recording) {
  const encoded = await recording.arrayBuffer();

  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  const decoder = new AudioContextClass();

  let decoded;
  try {
    decoded = await decoder.decodeAudioData(encoded);
  } finally {
    // Every AudioContext holds an audio device open. Leaking them eventually
    // exhausts the browser's limit and later recordings fail for no visible
    // reason.
    decoder.close?.();
  }

  const frames = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  if (frames <= 0) return null;

  // One output channel, so a stereo or multi microphone recording is
  // downmixed rather than silently losing everything but the first channel.
  const resampler = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
  const source = resampler.createBufferSource();
  source.buffer = decoded;
  source.connect(resampler.destination);
  source.start();

  const rendered = await resampler.startRendering();

  return encodeWav(rendered.getChannelData(0), TARGET_SAMPLE_RATE);
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
