import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Plays a resolved sign sequence as one continuous signed utterance.
 *
 * ADR 008 returns an ordered playlist rather than a server stitched video, so
 * making the seam between clips invisible is this component's job. It holds one
 * visible video element and a hidden one that preloads whatever comes next.
 *
 * This is the only sign video player in the app, per SRS section 4.4. A
 * doctor's question, a patient's answer option, and a prescription instruction
 * all render through it, so a patient who learns one player knows them all.
 */
export default function SignSequencePlayer({ sequence, onFinished }) {
  // Segments exist so the caller can explain coverage per word. Playback only
  // cares about the flat ordered run of clips.
  const clips = useMemo(
    () => (sequence?.segments ?? []).flatMap((segment) => segment.clips),
    [sequence],
  );

  const [index, setIndex] = useState(0);
  const [playingSequence, setPlayingSequence] = useState(sequence);
  const videoRef = useRef(null);

  // A new utterance must start at its own first clip rather than resuming from
  // wherever the previous sentence stopped. Adjusted during render rather than
  // in an effect: an effect runs after the render that needed the new value, so
  // a shorter sequence would be indexed out of bounds for one frame and the
  // player would crash before the reset ever applied.
  if (playingSequence !== sequence) {
    setPlayingSequence(sequence);
    setIndex(0);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // play() rejects when autoplay is blocked or the clip is missing. That is
    // recoverable, the patient can press play, so it must not surface as an
    // unhandled rejection.
    const played = video.play();
    if (played?.catch) played.catch(() => {});
  }, [index, clips]);

  if (clips.length === 0) {
    return (
      <div className="player player--empty" data-testid="sign-video-empty">
        <p className="player__message">
          No sign video available for this message yet.
        </p>
      </div>
    );
  }

  // Clamped, because a render-phase state adjustment re-renders but does not
  // abort the pass that triggered it. Without this, the render that first sees
  // a shorter sequence still reads the old, now out of range index and throws
  // before React discards its output.
  const safeIndex = Math.min(index, clips.length - 1);
  const current = clips[safeIndex];
  const next = clips[safeIndex + 1];

  const handleEnded = () => {
    if (safeIndex + 1 < clips.length) {
      setIndex(safeIndex + 1);
      return;
    }
    onFinished?.();
  };

  return (
    <div className="player">
      <video
        ref={videoRef}
        data-testid="sign-video"
        className="player__video"
        src={current.video_url}
        onEnded={handleEnded}
        controls
        playsInline
        // muted because these are sign clips with no meaningful audio, and an
        // unmuted autoplay would be blocked by the browser outright.
        muted
      />

      {/* Preloading the next clip is what keeps the seam invisible. */}
      {next ? (
        <video
          data-testid="sign-video-preload"
          src={next.video_url}
          preload="auto"
          muted
          hidden
        />
      ) : null}

      <p className="player__progress">
        Sign {safeIndex + 1} of {clips.length}, {current.gloss}
      </p>
    </div>
  );
}
