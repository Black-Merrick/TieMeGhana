import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Plays a resolved sign sequence as one continuous signed utterance.
 *
 * ADR 008 returns an ordered playlist rather than a server stitched video, so
 * making the joins invisible is this component's whole job.
 *
 * It uses two stacked video elements rather than one. Swapping the `src` of a
 * single element forces the browser to tear down the current video, load the
 * next, and decode its first frame, which shows as a flash of black between
 * every word. Instead, while one element plays, the other already holds the
 * next clip fully loaded. When the first ends they swap, the next clip is
 * already decoded, and it starts on the following frame, so the sentence reads
 * as one video. See ADR 030.
 *
 * This is the only sign video player in the app, per SRS section 4.4. A
 * doctor's question, a patient's answer option, and a prescription instruction
 * all render through it, so a patient who learns one player knows them all.
 */
export default function SignSequencePlayer({
  sequence,
  onFinished,
  // Answer options in a selection grid are themselves the tap target, so the
  // card carries the control and the video must not. A video's own controls
  // inside a button would swallow the tap. Section 4.4 still holds: it is the
  // same player, presented without its controls.
  controls = true,
  loop = false,
}) {
  // Segments exist so the caller can explain coverage per word. Playback only
  // cares about the flat ordered run of clips.
  const clips = useMemo(
    () => (sequence?.segments ?? []).flatMap((segment) => segment.clips),
    [sequence],
  );

  const [index, setIndex] = useState(0);
  const [active, setActive] = useState(0);
  const [playingSequence, setPlayingSequence] = useState(sequence);

  const bufferA = useRef(null);
  const bufferB = useRef(null);
  const buffers = [bufferA, bufferB];

  // A new utterance starts at its own first clip rather than resuming from
  // wherever the previous sentence stopped. Adjusted during render rather than
  // in an effect: an effect runs after the render that needed the new value,
  // so a shorter sequence would be indexed out of bounds for one frame.
  if (playingSequence !== sequence) {
    setPlayingSequence(sequence);
    setIndex(0);
    setActive(0);
  }

  // Clamped, because a render-phase state adjustment re-renders but does not
  // abort the pass that triggered it.
  const safeIndex = Math.min(index, Math.max(clips.length - 1, 0));
  const current = clips[safeIndex];
  const next = clips[safeIndex + 1];

  useEffect(() => {
    const video = buffers[active].current;
    if (!video || clips.length === 0) return;

    // play() rejects when autoplay is blocked or the clip is missing. That is
    // recoverable, the patient can press play, so it must not surface as an
    // unhandled rejection.
    const played = video.play();
    if (played?.catch) played.catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, safeIndex, clips.length]);

  if (clips.length === 0) {
    return (
      <div className="player player--empty" data-testid="sign-video-empty">
        <p className="player__message">
          No sign video available for this message yet.
        </p>
      </div>
    );
  }

  /**
   * Hand over to the buffer already holding the next clip.
   *
   * The newly active buffer keeps the same `src` it had while standing by, so
   * React does not reload it and playback continues on the next frame. The
   * buffer just vacated is the one that takes the clip after this.
   */
  const handleEnded = () => {
    if (safeIndex + 1 < clips.length) {
      setIndex(safeIndex + 1);
      setActive((showing) => 1 - showing);
      return;
    }
    onFinished?.();
  };

  return (
    <div className="player">
      <div className="player__stage">
        {[0, 1].map((buffer) => {
          const isActive = buffer === active;
          // The active buffer shows the current clip. The standby buffer holds
          // the next one, already loading, so the swap has nothing to wait for.
          const clip = isActive ? current : next;

          return (
            <video
              key={buffer}
              ref={buffers[buffer]}
              // The testids follow the roles rather than the elements, so a
              // caller always finds the clip on screen under one name.
              data-testid={isActive ? "sign-video" : "sign-video-preload"}
              className={
                isActive
                  ? "player__video"
                  : "player__video player__video--standby"
              }
              src={clip?.video_url}
              onEnded={isActive ? handleEnded : undefined}
              controls={controls && isActive}
              loop={loop}
              playsInline
              // Fully buffered while standing by, which is what removes the
              // gap. The browser will not decode a frame it has not fetched.
              preload="auto"
              // muted because these are sign clips with no meaningful audio,
              // and an unmuted autoplay would be blocked outright.
              muted
              aria-hidden={!isActive}
            />
          );
        })}
      </div>

      {controls ? (
        <p className="player__progress">
          Sign {safeIndex + 1} of {clips.length}, {current.gloss}
        </p>
      ) : null}
    </div>
  );
}
