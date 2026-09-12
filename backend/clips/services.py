"""
Turning caption text into an ordered sequence of GhSL clips.

This is FR 1.5, FR 1.6, and FR 1.7. It is deliberately a plain function over
plain data rather than a method on a model, because the doctor to patient flow,
the clinical question bank, and prescription playback all need the same
resolution and none of them should reimplement it.
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass

from clips.models import ClipKind, SignClip

# Letters and digits only, so punctuation never becomes a token. Digits are
# kept because dosage instructions like "2 times daily" are real content, and
# the character class is unicode aware so Twi letters such as ɛ and ɔ survive.
_TOKEN_PATTERN = re.compile(r"[^\W_]+", re.UNICODE)


class SegmentMatch:
    """
    How a token was resolved. These strings are part of the API contract the
    frontend player branches on, so they are named constants, not literals
    scattered through the code.
    """

    GLOSS = "gloss"
    FINGERSPELL = "fingerspell"
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class ResolvedClip:
    """A single playable clip, flattened to just what a player needs."""

    gloss: str
    video_url: str
    duration_ms: int


@dataclass(frozen=True)
class SignSegment:
    """
    One caption token and the clips that render it.

    A segment holds a list rather than a single clip because a fingerspelled
    word is several letter clips that together stand for one token.
    """

    token: str
    match: str
    clips: tuple[ResolvedClip, ...]


@dataclass(frozen=True)
class SignSequence:
    """
    The full rendering of one caption, in order.

    FR 1.7 describes this as a single stitched video. We keep it as an ordered
    sequence and let one player play it back seamlessly, see ADR 008.
    """

    source_text: str
    segments: tuple[SignSegment, ...]

    @property
    def total_duration_ms(self) -> int:
        return sum(
            clip.duration_ms for segment in self.segments for clip in segment.clips
        )

    @property
    def fingerspelled_tokens(self) -> list[str]:
        """
        Words that had no sign and were spelled out instead.

        Surfaced so the doctor can tell a spelled clinical term apart from a
        signed one, since a patient may not recognize the spelled version.
        """
        return [
            segment.token
            for segment in self.segments
            if segment.match == SegmentMatch.FINGERSPELL
        ]

    @property
    def unavailable_tokens(self) -> list[str]:
        """
        Words that could not be rendered at all, not even letter by letter.

        Reported rather than silently dropped, so the interface can show an
        honest gap instead of a sentence that reads as complete but is not.
        """
        return [
            segment.token
            for segment in self.segments
            if segment.match == SegmentMatch.UNAVAILABLE
        ]


def tokenize(text: str) -> list[str]:
    """Split caption text into lowercase word tokens, discarding punctuation."""
    return [match.group(0).lower() for match in _TOKEN_PATTERN.finditer(text)]


def resolve_sign_sequence(text: str) -> SignSequence:
    """
    Resolve caption text into the clips that render it, in order.

    Lookups are batched into at most two queries regardless of sentence
    length. NFR 1 allows five seconds for the whole speech to sign pipeline,
    and almost all of that budget belongs to speech recognition and
    translation, so a per token query here would be the thing that breaks it.
    """
    tokens = tokenize(text)
    if not tokens:
        return SignSequence(source_text=text, segments=())

    word_clips = _resolvable_clips_by_gloss(ClipKind.WORD, {t.upper() for t in tokens})

    # The alphabet is only needed for tokens that had no sign of their own, so
    # a fully covered sentence costs one query rather than two.
    unmatched = [token for token in tokens if token.upper() not in word_clips]
    letter_clips = (
        _resolvable_clips_by_gloss(
            ClipKind.LETTER, {char.upper() for token in unmatched for char in token}
        )
        if unmatched
        else {}
    )

    segments = tuple(
        _resolve_token(token, word_clips, letter_clips) for token in tokens
    )
    return SignSequence(source_text=text, segments=segments)


def _resolve_token(
    token: str,
    word_clips: dict[str, SignClip],
    letter_clips: dict[str, SignClip],
) -> SignSegment:
    """
    Resolve one token: its own sign, else fingerspelling, else nothing.

    The order matters. A word sign is always preferable to spelling the word,
    because a Deaf patient reads the sign natively and may not be print
    literate enough to follow the spelling at all.
    """
    word_clip = word_clips.get(token.upper())
    if word_clip is not None:
        return SignSegment(
            token=token,
            match=SegmentMatch.GLOSS,
            clips=(_to_resolved_clip(word_clip),),
        )

    spelled = [letter_clips.get(char.upper()) for char in token]
    if spelled and all(clip is not None for clip in spelled):
        return SignSegment(
            token=token,
            match=SegmentMatch.FINGERSPELL,
            clips=tuple(_to_resolved_clip(clip) for clip in spelled),
        )

    # A partially spellable word is treated as unavailable rather than played
    # with gaps, since a patient would read the gap as part of the word.
    return SignSegment(token=token, match=SegmentMatch.UNAVAILABLE, clips=())


def _resolvable_clips_by_gloss(
    kind: str, glosses: Iterable[str]
) -> dict[str, SignClip]:
    """Fetch every requested gloss of one kind in a single query."""
    glosses = sorted(glosses)
    if not glosses:
        return {}

    clips = SignClip.objects.resolvable().filter(kind=kind, gloss__in=glosses)
    return {clip.gloss: clip for clip in clips}


def _to_resolved_clip(clip: SignClip) -> ResolvedClip:
    return ResolvedClip(
        gloss=clip.gloss,
        video_url=clip.video.url,
        duration_ms=clip.duration_ms or 0,
    )
