"""
The fixed phrases Emergency Visual Triage speaks aloud, in both languages.

Emergency mode has no typing and no free text, per FR 5.4, so everything it can
ever say is known in advance: two critical alerts, sixteen body locations and
five pain levels. Twenty three phrases that will not change.

Two decisions follow from that, and both were arrived at by measurement rather
than taste.

**They are whole sentences, not labels.** A tap on the head used to say "Pain
in the head", and a bare noun is both bad English and bad input to a
translator. Asked to translate "Waist" the service returned "Waist a ɔyɛ
ɔkwasea", and "Throat" came back as "Throat na ɔkyerɛwee": the English word
with unrelated Twi attached. Asked to translate "My waist hurts" it returned
"M'asensene yɛ me ya", which is a sentence. So each phrase is what a patient
would actually say, in the first person, using the idiom English has where it
has one: a headache and a sore throat rather than "pain in the head".

**They are translated once, here, not at the moment of a tap.** Translating
live cost two calls to a metered service per tap, and about five seconds
measured end to end, between a patient touching "cannot breathe" and a
clinician hearing it. Prepared in advance, a tap costs one synthesis call.

**None of this Twi has been reviewed by a Twi speaker.** It came from
GhanaNLP's Khaya service on 16 September 2026 and is recorded verbatim,
including where it is wrong, because hiding a bad translation makes it harder
to fix rather than safer. Each phrase carries its own reviewer, and until one
is named the phrase is spoken in English instead. Two automatic checks run
regardless, and both catch real failures seen in this very table: a
translation that kept its English word, and two different phrases that came
back as the same Twi.
"""

#: key -> (what the patient is saying, the Twi for it, who checked the Twi)
#:
#: The third element is the safety gate. An empty reviewer means nobody has
#: read the Twi, so it is served to be corrected and never spoken. Put a name
#: there and that one phrase starts being spoken in Twi, while the rest carry
#: on in English: per phrase rather than one switch for the set, because
#: holding back the ones that are plainly right helps nobody.
#:
#: Known to be wrong, and waiting for a reviewer rather than a guess:
#:
#:   BACK    "Mewɔ akyiwadeɛ" does not appear to mean a backache.
#:   PAIN_2  and PAIN_3 both came back as "Mete yea kakra", so a little pain
#:           and moderate pain would say the same thing. Caught automatically.
#:   ARM     and HAND both came back as "Me nsa yɛ me yaw". Twi may not
#:           separate them, but a clinician needs to. Caught automatically.
PHRASES: dict[str, tuple[str, str, str]] = {
    # Critical alerts, FR 5.3.
    "CANNOT_BREATHE": ("I cannot breathe", "Mintumi nhome", ""),
    "PREGNANCY": ("I am pregnant", "Menyinsɛn", ""),
    # Body locations, FR 5.2. Idiomatic where English has a word for it, the
    # universal "my X hurts" otherwise.
    "HEAD": ("I have a headache", "Me ti pae me", ""),
    "EYE": ("My eye hurts", "M'ani yɛ me ya", ""),
    "EAR": ("I have an earache", "M'aso mu yɛ me ya", ""),
    "NOSE": ("My nose hurts", "Me hwene yɛ me ya", ""),
    "MOUTH": ("My mouth hurts", "M'ano yɛ me ya", ""),
    "THROAT": ("I have a sore throat", "Me mene mu yɛ me ya", ""),
    "NECK": ("My neck hurts", "Me kɔn yɛ me yaw", ""),
    "CHEST": ("I have chest pain", "Me bo yɛ me ya", ""),
    "HEART": ("I have pain around my heart", "Me yam hyehye me wɔ m'akoma mu", ""),
    "STOMACH": ("I have a stomachache", "Me yafunu mu yɛ me ya", ""),
    "WAIST": ("My waist hurts", "M'asensene yɛ me ya", ""),
    "BACK": ("I have a backache", "Mewɔ akyiwadeɛ", ""),
    "ARM": ("My arm hurts", "Me nsa yɛ me yaw", ""),
    "HAND": ("My hand hurts", "Me nsa yɛ me yaw", ""),
    "LEG": ("My leg hurts", "Me nan yɛ me yaw", ""),
    "FOOT": ("My foot hurts", "Me nan ase yɛ me yaw", ""),
    # Pain scale, FR 5.1.
    "PAIN_1": ("I have no pain", "Biribiara nni hɔ a ɛyɛ me ya", ""),
    "PAIN_2": ("I have a little pain", "Mete yea kakra", ""),
    "PAIN_3": ("I have moderate pain", "Mete yea kakra", ""),
    "PAIN_4": ("I have severe pain", "Mete yea kɛse", ""),
    "PAIN_5": (
        "The pain is the worst I have felt",
        "Ɛyaw no ne ade a enye koraa a mate nka",
        "",
    ),
}


def _looks_untranslated(english: str, twi: str) -> bool:
    """
    Whether the English survived into the Twi, which means nothing happened.

    Catches a real and repeated failure of the translator on short input: asked
    for a bare clinical noun it sometimes returned it unchanged, or returned it
    with a fragment of unrelated Twi attached. Whole sentences do not fail this
    way, which is most of why the phrases above are sentences, but the check is
    kept because it costs nothing and the failure was not theoretical.

    It cannot catch a translation that is fluent and wrong, and does not
    pretend to. That is what a reviewer is for.
    """
    if not twi.strip():
        return True

    return any(word.lower() in twi.lower() for word in english.split() if len(word) > 3)


def _collides_with_another_phrase(key: str, twi: str) -> bool:
    """
    Whether some other phrase came back as exactly this Twi.

    The dangerous failure, and not a hypothetical one: "I have a little pain"
    and "I have moderate pain" both returned "Mete yea kakra". Two taps that
    mean different things must not say the same thing to a clinician, because
    a patient reporting mild pain and one reporting moderate pain would be
    indistinguishable, and the clinician would have no way to know.

    Both sides of a collision are withheld rather than one, because there is no
    way to tell from here which of the two the Twi actually means.
    """
    if not twi.strip():
        return False

    return any(
        other != key and other_twi.strip() == twi.strip()
        for other, (_, other_twi, _) in PHRASES.items()
    )


def spoken_phrase(key: str) -> dict:
    """
    One phrase, with both renderings and whether the Twi may be spoken.

    `tw_reviewed` is the gate, and it is deliberately conservative: a reviewer
    must have named themselves, the English must not have survived into the
    Twi, and no other phrase may share that Twi. The automatic checks stay on
    after review as a second pair of eyes, because a reviewer who signs off two
    pain levels that say the same thing has made a mistake worth catching.
    """
    english, twi, reviewed_by = PHRASES[key]
    untranslated = _looks_untranslated(english, twi)
    collides = _collides_with_another_phrase(key, twi)

    return {
        "key": key,
        "en": english,
        "tw": twi,
        "tw_reviewed": bool(reviewed_by.strip()) and not untranslated and not collides,
        "tw_looks_untranslated": untranslated,
        "tw_collides": collides,
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
