import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import useVideoReadiness from "../hooks/useVideoReadiness.js";
import {
  crossOriginFor,
  mediaCorsVersion,
  recordMediaCors,
  subscribeMediaCors,
} from "../signs/mediaCors.js";
import PlayerStatus from "./PlayerStatus.jsx";

/**
 * Plays a resolved sign sequence as one continuous signed utterance.
 *
 * ADR 008 returns an ordered playlist rather than a server stitched video, so
 * making the joins invisible is this component's whole job.
 *
 * When the backend has stitched the sentence into a single file, that file is
 * played directly: one video, one timeline, one duration. See ADR 031. That is
 * the preferred path, because two clips played back to back still show two
 * lengths in the control bar and restart the timer at every word, which reads
 * as several videos however smooth the picture is.
 *
 * Without a stitched file, because ffmpeg is unavailable or the encode failed,
 * it falls back to two stacked video elements. Swapping the `src` of a single
 * element forces the browser to tear down the current video, load the next, and
 * decode its first frame, which shows as a flash of black between every word.
 * So while one element plays, the other already holds the next clip fully
 * loaded, and when the first ends they swap. See ADR 030.
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

  // One file for the whole sentence, when the backend could produce it.
  const stitched = sequence?.stitched_video_url ?? null;

  const [index, setIndex] = useState(0);
  const [active, setActive] = useState(0);
  const [playingSequence, setPlayingSequence] = useState(sequence);

  const bufferA = useRef(null);
  const bufferB = useRef(null);
  const buffers = [bufferA, bufferB];

  // Watches whichever source is actually on screen, so the wait is reported
  // for the stitched file and for each clip of the fallback alike. Keyed on
  // the source rather than on the sequence: in the fallback path the element
  // stays mounted and its `src` changes, and a readiness state that did not
  // reset would report the previous clip's.
  const onScreen = stitched ?? clips[Math.min(index, Math.max(clips.length - 1, 0))]?.video_url;
  const readiness = useVideoReadiness({ source: onScreen });

  // Whether to ask for each clip with CORS, which is what lets the service
  // worker keep it for offline replay and answer from that copy. Only from a
  // server the warm up has found to allow it: asking a server that does not
  // would refuse the video outright. Re-read whenever what is known changes.
  useSyncExternalStore(subscribeMediaCors, mediaCorsVersion);
  const corsFor = (url) => (url ? crossOriginFor(url) : undefined);

  // If a video that was asked for with CORS fails, the server has stopped
  // allowing it, or never did. Say so, and the element is remade without, which
  // plays as it always did. The patient sees a moment of "getting ready", not
  // "the sign video did not load".
  const failedWithCors = (url) => (event) => {
    if (event?.currentTarget?.crossOrigin && url) recordMediaCors(url, false);
    readiness.handlers.onError();
  };

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
  }, [active, safeIndex, clips.length, corsFor(current?.video_url), corsFor(next?.video_url)]);

  if (clips.length === 0) {
    return (
      <div className="player player--empty" data-testid="sign-video-empty">
        <p className="player__message">
          No sign video available for this message yet.
        </p>
      </div>
    );
  }

  // The whole sentence as one file. No handover, no second element, and the
  // control bar shows the sentence's own length rather than a single word's.
  if (stitched) {
    return (
      <div className="player">
        <div className="player__stage">
          <video
            key={corsFor(stitched) ?? "plain"}
            data-testid="sign-video"
            className="player__video"
            src={stitched}
            crossOrigin={corsFor(stitched)}
            onEnded={onFinished}
            controls={controls}
            loop={loop}
            playsInline
            autoPlay
            preload="auto"
            muted
            {...readiness.handlers}
            onError={failedWithCors(stitched)}
          />
          {readiness.showOverlay ? (
            <PlayerStatus phase={readiness.phase} />
          ) : null}
        </div>
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
              key={`${buffer}:${corsFor(clip?.video_url) ?? "plain"}`}
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
              crossOrigin={corsFor(clip?.video_url)}
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
              // Only the clip on screen reports readiness. The standby buffer
              // is loading too, and letting it fire these would clear the
              // overlay on the strength of a video nobody is watching yet.
              {...(isActive
                ? { ...readiness.handlers, onError: failedWithCors(clip?.video_url) }
                : {})}
            />
          );
        })}

        {readiness.showOverlay ? <PlayerStatus phase={readiness.phase} /> : null}
      </div>

      {controls ? (
        <p className="player__progress">
          Sign {safeIndex + 1} of {clips.length}, {current.gloss}
        </p>
      ) : null}
    </div>
  );
}
