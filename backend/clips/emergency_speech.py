"""
The fixed phrases Emergency Visual Triage speaks aloud, in both languages.

Emergency mode has no typing and no free text, per FR 5.4, so everything it can
ever say is known in advance: two critical alerts, sixteen body locations and
five pain levels. Twenty three phrases that will not change.

That fact is worth using. Translating them at the moment of a tap was the
obvious implementation and it is the wrong one, for three separate reasons:

- It costs two calls to a metered service per tap, one to translate and one to
  speak, when one would do.
- It is slow exactly when speed matters. Measured against the live service, a
  translation is about 1.6 seconds and a synthesis about 3.1. Nearly five
  seconds between a patient touching "cannot breathe" and a clinician hearing
  it is not an emergency tool.
- It produces unreviewed machine Twi at the moment accuracy matters most, and
  the machine is visibly unreliable on single clinical words. Asked for
  "Waist" it returned "Waist a ɔyɛ ɔkwasea", and for "Nose" it returned "Nose".

So they are translated once, kept here, and served with the payload. A tap then
costs one synthesis call and speaks immediately.

**None of this Twi has been reviewed by a Twi speaker.** It was produced by
GhanaNLP's Khaya service on 16 September 2026 and is recorded verbatim below,
including where it plainly failed, because hiding a bad translation makes it
harder to fix rather than safer. `is_usable` decides what may actually be
spoken, and everything else falls back to English rather than reading nonsense
to a clinician during triage. Fill in `REVIEWED_BY` when a Twi speaker has been
through them, at which point the fallback stops applying.
"""

#: key -> (English, Twi, the Twi speaker who checked it)
#:
#: The third element is the whole safety gate. An empty reviewer means the Twi
#: is machine output nobody has read, and it is served so it can be corrected
#: but never spoken. Put a name there and that phrase starts being spoken in
#: Twi; the rest carry on in English until someone does the same for them.
#:
#: Per phrase rather than one switch for the set, for the same reason each clip
#: carries its own reviewer: "Ti" for "Head" is plainly right and "Waist a ɔyɛ
#: ɔkwasea" for "Waist" is plainly not, and holding the good ones back until
#: every bad one is fixed helps nobody.
#:
#: Recorded exactly as it came back. Five are obviously wrong and are caught by
#: `_looks_untranslated`. Two more, CHEST and ARM, look wrong to an English
#: reader but cannot be judged without Twi, so they wait for a reviewer rather
#: than for a guess.
PHRASES: dict[str, tuple[str, str, str]] = {
    # Critical alerts, FR 5.3.
    "CANNOT_BREATHE": ("Cannot breathe", "ɔhome ntumi nhome", ""),
    "PREGNANCY": ("Pregnant", "nyinsɛn", ""),
    # Body locations, FR 5.2.
    "HEAD": ("Head", "Ti", ""),
    "EYE": ("Eye", "Aniwa", ""),
    "EAR": ("Ear", "Aso", ""),
    "NOSE": ("Nose", "Nose", ""),
    "MOUTH": ("Mouth", "Ano", ""),
    "THROAT": ("Throat", "Throat na ɔkyerɛwee", ""),
    "NECK": ("Neck", "Neck na ɔkyerɛwee", ""),
    "CHEST": ("Chest", "Ɔpɔnkɔsotefo", ""),
    "HEART": ("Heart", "Akoma", ""),
    "STOMACH": ("Stomach", "Stomach na ɔkyerɛwee", ""),
    "WAIST": ("Waist", "Waist a ɔyɛ ɔkwasea", ""),
    "BACK": ("Back", "Akyire", ""),
    "ARM": ("Arm", "Ahyɛnsodeɛ", ""),
    "HAND": ("Hand", "Nsa", ""),
    "LEG": ("Leg", "Nan", ""),
    "FOOT": ("Foot", "Nansoaa", ""),
    # Pain scale, FR 5.1.
    "PAIN_1": ("No pain", "ɛyeaa biara nni hɔ", ""),
    "PAIN_2": ("A little pain", "Ɛyaw kakra", ""),
    "PAIN_3": ("Moderate pain", "ɛyaw a ano nyɛ den", ""),
    "PAIN_4": ("Severe pain", "ɛyaw a ano yɛ den", ""),
    "PAIN_5": ("Worst pain", "Ɛyaw a ano yɛ den pa ara", ""),
}


def _looks_untranslated(english: str, twi: str) -> bool:
    """
    Whether the English survived into the Twi, which means nothing happened.

    A crude check that catches a real and repeated failure: asked for a single
    clinical noun the translator sometimes returns it unchanged, or returns it
    with a fragment of unrelated Twi attached. "Nose" came back as "Nose", and
    "Throat" as "Throat na ɔkyerɛwee".

    It cannot catch a translation that is fluent and wrong, and it is not
    pretending to. That is what review is for. This only catches the cases
    where the output is self evidently not a translation, so those never reach
    a clinician's ear.
    """
    if not twi.strip():
        return True

    return any(word.lower() in twi.lower() for word in english.split() if len(word) > 2)


def spoken_phrase(key: str) -> dict:
    """
    One phrase, with both renderings and whether the Twi may be spoken.

    `is_usable` is the safety gate for speech, and it is deliberately
    conservative: a phrase is only speakable in Twi once a reviewer has signed
    the set off and the automatic check has not flagged it. Until then the
    caller speaks English, which a Twi speaking clinician understands as a
    limitation rather than mishearing as a symptom.
    """
    english, twi, reviewed_by = PHRASES[key]
    flagged = _looks_untranslated(english, twi)

    return {
        "key": key,
        "en": english,
        "tw": twi,
        # Both conditions, and the automatic one still applies after review: a
        # reviewer who signs off a phrase that kept its English word has made a
        # mistake, and the cheap check is worth keeping as a second pair of
        # eyes.
        "tw_reviewed": bool(reviewed_by.strip()) and not flagged,
        "tw_looks_untranslated": flagged,
        "reviewed_by": reviewed_by,
    }


def all_spoken_phrases() -> list[dict]:
    """Every phrase emergency mode can say, in the order they are defined."""
    return [spoken_phrase(key) for key in PHRASES]


def pending_review() -> list[str]:
    """
    Keys whose Twi must not be spoken yet.

    Used by the API so the interface can say so once, quietly, rather than
    leaving a clinician to wonder why some taps are read in English.
    """
    return [
        phrase["key"] for phrase in all_spoken_phrases() if not phrase["tw_reviewed"]
    ]
