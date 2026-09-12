"""
Turning caption text into an ordered sequence of GhSL clips.

This is FR 1.5, FR 1.6, and FR 1.7. It is deliberately a plain function over
plain data rather than a method on a model, because the doctor to patient flow,
the clinical question bank, and prescription playback all need the same
resolution and none of them should reimplement it.
"""

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from clips.models import ClipAlias, ClipKind, SignClip, gloss_tokens
from clips.safety import TokenRisk, classify

# Letters and digits, plus apostrophes inside a word so a contraction survives
# tokenizing as one piece. Digits are kept because dosage instructions like
# "2 times daily" are real content, and the character class is unicode aware so
# Twi letters such as ɛ and ɔ survive.
_TOKEN_PATTERN = re.compile(r"[^\W_]+(?:['’][^\W_]+)*", re.UNICODE)

# Contractions are expanded before anything else looks at a token.
#
# This is a safety fix, not tidying. "don't" split into "don" and "t", so the
# negation disappeared: `classify` never saw a blocking word, the sentence
# passed the ADR 033 gate, and "don't take the medicine" would have played as
# TAKE MEDICINE, the opposite instruction. Meanwhile "do not take the medicine"
# was correctly refused. Two ways of writing the same sentence, one caught and
# one not. See ADR 037.
_CONTRACTIONS = {
    "don't": ("do", "not"),
    "doesn't": ("does", "not"),
    "didn't": ("did", "not"),
    "can't": ("cannot",),
    "won't": ("will", "not"),
    "shan't": ("shall", "not"),
    "isn't": ("is", "not"),
    "aren't": ("are", "not"),
    "wasn't": ("was", "not"),
    "weren't": ("were", "not"),
    "haven't": ("have", "not"),
    "hasn't": ("has", "not"),
    "hadn't": ("had", "not"),
    "couldn't": ("could", "not"),
    "shouldn't": ("should", "not"),
    "wouldn't": ("would", "not"),
    "mustn't": ("must", "not"),
    "what's": ("what", "is"),
    "who's": ("who", "is"),
    "where's": ("where", "is"),
    "it's": ("it", "is"),
    "that's": ("that", "is"),
    "there's": ("there", "is"),
    "he's": ("he", "is"),
    "she's": ("she", "is"),
    "i'm": ("i", "am"),
    "you're": ("you", "are"),
    "they're": ("they", "are"),
    "we're": ("we", "are"),
    "i've": ("i", "have"),
    "you've": ("you", "have"),
    "i'll": ("i", "will"),
    "you'll": ("you", "will"),
    "let's": ("let", "us"),
}


class SegmentMatch:
    """
    How a token was resolved. These strings are part of the API contract the
    frontend player branches on, so they are named constants, not literals
    scattered through the code.
    """

    GLOSS = "gloss"
    #: A whole phrase covered by one clip, preferred over stitching its words.
    PHRASE = "phrase"
    FINGERSPELL = "fingerspell"
    #: A word GhSL does not use, left out deliberately. See ADR 033.
    OMITTED = "omitted"
    #: A word whose absence would change the meaning. Stops the sentence.
    BLOCKED = "blocked"
    #: A content word that can be neither signed nor spelled.
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
        Content words that could not be rendered at all, not even by spelling.

        Reported rather than silently dropped, so the interface can show an
        honest gap instead of a sentence that reads as complete but is not.
        """
        return self._tokens_matching(SegmentMatch.UNAVAILABLE)

    @property
    def omitted_tokens(self) -> list[str]:
        """
        Words deliberately left out because GhSL does not use them.

        Reported so the doctor can see exactly what the patient will and will
        not see, but their absence is safe: dropping an article or a copula
        produces more natural GhSL, not a different sentence. See ADR 033.
        """
        return self._tokens_matching(SegmentMatch.OMITTED)

    @property
    def blocking_tokens(self) -> list[str]:
        """
        Words whose absence would change the meaning of the sentence.

        A negation, a dose, a frequency, a severity. If any of these could not
        be signed, the sentence is not safe to show at any quality, because the
        patient would answer something the doctor did not ask.
        """
        return self._tokens_matching(SegmentMatch.BLOCKED)

    @property
    def back_translation(self) -> list[str]:
        """
        The glosses the patient will actually see, in order.

        This is what the doctor reads back before sending. Showing the input
        text would prove nothing: the point is to surface the difference
        between what was typed and what will be signed.
        """
        return [clip.gloss for segment in self.segments for clip in segment.clips]

    @property
    def is_safe_to_show(self) -> bool:
        """
        Whether this sentence can be shown to a patient at all.

        Refused when a blocking word is missing, because the meaning would
        change, and when a content word is missing entirely, because the
        patient would be answering a fragment and might guess at the rest.
        Both are the same rule ADR 022 applies to a partial answer grid.
        """
        if not self.back_translation:
            return False

        return not self.blocking_tokens and not self.unavailable_tokens

    @property
    def needs_confirmation(self) -> bool:
        """
        Whether the doctor should read it back before the patient sees it.

        Only when something differs between what was typed and what will be
        signed. A sentence rendered entirely in reviewed signs goes straight
        through, so the friction lands exactly where the risk is.
        """
        return self.is_safe_to_show and bool(
            self.omitted_tokens or self.fingerspelled_tokens
        )

    def _tokens_matching(self, match: str) -> list[str]:
        return [segment.token for segment in self.segments if segment.match == match]


def with_appended_clip(sequence: SignSequence, clip) -> SignSequence:
    """
    Return the sequence with one more clip played at the end.

    Used to attach the FR 2.6 instruction to nod or shake to a yes or no
    question, so the patient is told how to answer in GhSL rather than only in
    text the doctor can read.
    """
    extra = SignSegment(
        token=clip.gloss.lower(),
        match=SegmentMatch.GLOSS,
        clips=(_to_resolved_clip(clip),),
    )
    return SignSequence(
        source_text=sequence.source_text, segments=(*sequence.segments, extra)
    )


def tokenize(text: str) -> list[str]:
    """
    Split text into lowercase word tokens, expanding contractions.

    Contractions are expanded rather than split on the apostrophe, because
    splitting loses the negation in "don't" and everything downstream, the
    safety classification included, then sees a sentence that does not contain
    one. See ADR 037.
    """
    tokens: list[str] = []

    for match in _TOKEN_PATTERN.finditer(text):
        # Curly apostrophes arrive from phone keyboards and word processors,
        # and are the same character as far as meaning goes.
        raw = match.group(0).lower().replace("’", "'")

        if raw in _CONTRACTIONS:
            tokens.extend(_CONTRACTIONS[raw])
            continue

        tokens.append(_strip_possessive(raw))

    return tokens


def _strip_possessive(token: str) -> str:
    """
    Reduce "patient's" to "patient", and drop any other stray apostrophe.

    GhSL does not mark possession with an affix, so the 's carries nothing to
    sign. Left in place it would make the token unmatchable and unspellable,
    since there is no letter clip for an apostrophe, and the whole sentence
    would be refused over punctuation.
    """
    if token.endswith("'s"):
        token = token[:-2]

    return token.replace("'", "")


def resolve_sign_sequence(text: str) -> SignSequence:
    """
    Resolve caption text into the clips that render it, in order.

    Lookups are batched into at most two queries regardless of sentence
    length. NFR 1 allows five seconds for the whole speech to sign pipeline,
    and almost all of that budget belongs to speech recognition and
    translation, so a per token query here would be the thing that breaks it.
    """
    return resolve_sign_sequences([text])[0]


def resolve_sign_sequences(texts: Sequence[str]) -> list[SignSequence]:
    """
    Resolve several texts while looking the clip library up only once.

    The clinical question bank needs every question resolved at the moment the
    doctor opens it. Resolving them one at a time would be two queries per
    question, so a bank of a few dozen questions would be slow to open mid
    consultation. Sharing one lookup across all of them keeps it at two
    queries for the whole bank.
    """
    tokenized = [tokenize(text) for text in texts]
    every_token = [token for tokens in tokenized for token in tokens]

    if not every_token:
        return [SignSequence(source_text=text, segments=()) for text in texts]

    wanted = {token.upper() for token in every_token}
    word_clips = _resolvable_clips_by_gloss(ClipKind.WORD, wanted)

    # Reviewed aliases fill the gaps a literal gloss lookup leaves, so a doctor
    # writing "doing" reaches the FEELING sign when a consultant has recorded
    # that they mean the same thing. One extra query, and only when something
    # did not match. See ADR 034.
    unmatched_terms = wanted - word_clips.keys()
    if unmatched_terms:
        word_clips |= _reviewed_alias_clips(unmatched_terms)

    # The alphabet is only needed for tokens that had no sign of their own, so
    # fully covered text costs one query rather than two.
    unmatched = [token for token in every_token if token.upper() not in word_clips]
    letter_clips = (
        _resolvable_clips_by_gloss(
            ClipKind.LETTER, {char.upper() for token in unmatched for char in token}
        )
        if unmatched
        else {}
    )

    # Every resolvable phrase clip, unfiltered. A phrase spans several tokens,
    # so it cannot be narrowed by an IN clause on the tokens we have, and there
    # will only ever be a few dozen of them. One query for the whole call.
    phrase_clips = _resolvable_phrase_clips()

    return [
        SignSequence(
            source_text=text,
            segments=_resolve_tokens(tokens, phrase_clips, word_clips, letter_clips),
        )
        for text, tokens in zip(texts, tokenized, strict=True)
    ]


def _resolve_tokens(
    tokens: list[str],
    phrase_clips: dict[tuple[str, ...], SignClip],
    word_clips: dict[str, SignClip],
    letter_clips: dict[str, SignClip],
) -> tuple[SignSegment, ...]:
    """
    Resolve a token list, preferring the longest phrase available.

    Longest match first, because a clip of a whole phrase signed by a native
    signer is better GhSL than the same words stitched together. Sign languages
    have their own grammar, so word signs played in English order produce
    something closer to signed English, and a filmed phrase carries the facial
    expression and rhythm that individual word clips cannot. See ADR 038.
    """
    longest = max((len(phrase) for phrase in phrase_clips), default=0)

    segments: list[SignSegment] = []
    position = 0

    while position < len(tokens):
        phrase = _longest_phrase_at(tokens, position, phrase_clips, longest)

        if phrase is not None:
            length, clip = phrase
            segments.append(
                SignSegment(
                    token=" ".join(tokens[position : position + length]),
                    match=SegmentMatch.PHRASE,
                    clips=(_to_resolved_clip(clip),),
                )
            )
            position += length
            continue

        segments.append(_resolve_token(tokens[position], word_clips, letter_clips))
        position += 1

    return tuple(segments)


def _longest_phrase_at(
    tokens: list[str],
    position: int,
    phrase_clips: dict[tuple[str, ...], SignClip],
    longest: int,
) -> tuple[int, SignClip] | None:
    """
    The longest phrase clip starting at this position, if any.

    Counts down from the longest so "what is your name" wins over a shorter
    "your name" that happens to also be filmed. Stops at two tokens, because a
    single token is a word sign and is handled by the ordinary lookup.
    """
    available = min(longest, len(tokens) - position)

    for length in range(available, 1, -1):
        key = tuple(tokens[position : position + length])
        clip = phrase_clips.get(key)
        if clip is not None:
            return length, clip

    return None


def _resolvable_phrase_clips() -> dict[tuple[str, ...], SignClip]:
    """
    Phrase clips keyed by the token sequence they cover.

    The gloss carries the phrase with underscores, WHAT_IS_YOUR_NAME, so the
    tokens it matches are recovered by splitting it. That keeps one field as
    the single identifier for a clip rather than storing the phrase twice and
    letting the two drift.
    """
    return {
        gloss_tokens(clip.gloss): clip
        for clip in SignClip.objects.resolvable().filter(kind=ClipKind.PHRASE)
    }


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

    # Both checks below come before fingerspelling, deliberately.
    risk = classify(token)

    # A blocking word is never spelled. Fingerspelling a negation to a patient
    # who may not be print literate is not a rendering of "no", and assuming
    # they followed it is the same risk in a different shape. The sentence
    # stops instead.
    if risk == TokenRisk.BLOCKING:
        return SignSegment(token=token, match=SegmentMatch.BLOCKED, clips=())

    # GhSL does not use articles or copulas, so leaving one out is not a loss.
    # Spelling it letter by letter would be worse than leaving it out: it
    # spends the patient's attention on a word that carries nothing.
    if risk == TokenRisk.DROPPABLE:
        return SignSegment(token=token, match=SegmentMatch.OMITTED, clips=())

    spelled = [letter_clips.get(char.upper()) for char in token]
    if spelled and all(clip is not None for clip in spelled):
        return SignSegment(
            token=token,
            match=SegmentMatch.FINGERSPELL,
            clips=tuple(_to_resolved_clip(clip) for clip in spelled),
        )

    # A partially spellable content word is treated as unavailable rather than
    # played with gaps, since a patient would read the gap as part of the word.
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


def _reviewed_alias_clips(terms: Iterable[str]) -> dict[str, SignClip]:
    """
    Map alternative words to the clips they stand for.

    Only aliases a consultant has signed off, and only where the clip itself is
    resolvable. An unreviewed alias is nobody's clinical judgment, and an alias
    pointing at unreviewed footage would route around the review gate.
    """
    terms = sorted(terms)
    if not terms:
        return {}

    aliases = (
        ClipAlias.objects.filter(term__in=terms)
        .exclude(reviewed_by="")
        .select_related("clip")
    )

    return {
        alias.term: alias.clip
        for alias in aliases
        if alias.clip.is_resolvable and alias.clip.kind == ClipKind.WORD
    }


def _to_resolved_clip(clip: SignClip) -> ResolvedClip:
    return ResolvedClip(
        gloss=clip.gloss,
        video_url=clip.video.url,
        duration_ms=clip.duration_ms or 0,
    )
