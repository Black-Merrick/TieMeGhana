"""
Reaching a sign from the plural or "-s" form of its word.

GhSL, like most sign languages, does not mark plural on a noun or the third
person on a verb: the sign for GO is the sign for GOES, and BRING is BRING
whether one thing is brought or several. The clip library is filmed once per
sign, so a doctor typing "brings" (or saying it, which arrives as the same
text) should be shown the BRING clip and not have the word spelled out letter
by letter, or refused, for want of a clip named "brings".

This is deliberately narrow. It reduces a word by the one ending English adds
for a plural or a third person singular, and nothing else: no "-ing", no "-ed",
no guessing at a root. Each candidate it offers is only ever a *reading of the
same word*, and the resolver still has to find a filmed, reviewed clip with that
exact gloss before it uses one.

**Nothing that carries clinical meaning is reduced.** A word the safety
classifier knows (a negation, a number, a frequency, a severity, a droppable
word) is never rewritten into another, because that classification is what
decides whether the sentence is safe to show, and "times" reading as "time"
would turn "three times a day" into a sentence with no frequency in it. And the
other way round: a word whose reduced form *is* one of those, "halves",
"doubles", "stops", "avoids", is treated as that word for safety even when there
is no clip, so it stops the sentence and is not fingerspelled to a patient who
may not read it. See ADR 033 and ADR 055.
"""

import re

from clips.safety import TokenRisk, classify

# English words only. A Twi token is left exactly as it is: these endings mean
# nothing in Twi, and a Twi word that happens to end in "s" is not a plural.
_ENGLISH_WORD = re.compile(r"^[a-z]+$")

# The shortest word, and the shortest reduced form, this will work on. "is",
# "us", "as", "bus", "gas" and "yes" end in "s" and are not plurals; a stem of
# one or two letters is nearly always wrong ("toes" is not "to").
_MIN_WORD = 4
_MIN_STEM = 3

# Two short stems that are real words and take an "-es": "goes", and "does",
# which the classifier already treats as droppable and so never reaches here.
_SHORT_STEMS = frozenset({"go", "do"})

# Words that end like a plural and are not one, where the reduced form is a real
# word with a different meaning ("news" is not "new"), or where reducing is
# simply not right. Endings that are never plurals are handled below.
_NOT_INFLECTED = frozenset(
    {
        "news",
        "lens",
        "series",
        "species",
        "always",
        "sometimes",
        "perhaps",
        "towards",
        "afterwards",
        "besides",
        "whereas",
        "thus",
        "plus",
        "physics",
        "mumps",
        "measles",
        "diabetes",
        "this",
        "his",
        "its",
    }
)

# Endings of words that are not plurals: "class", "virus", "diagnosis",
# "nervous", "arthritis".
_NEVER_PLURAL_ENDINGS = ("ss", "us", "is", "ous", "ics")

# The few English plurals that are not made with an "s", for words a clinic
# actually says. Mapped to the singular.
_IRREGULAR = {
    "children": "child",
    "men": "man",
    "women": "woman",
    "teeth": "tooth",
    "feet": "foot",
    "mice": "mouse",
    "has": "have",
}

# After these, the plural adds "es": watches, boxes, buzzes, glasses, tomatoes.
_ES_AFTER = ("ch", "sh", "x", "z", "ss", "o")


def _plausible(stem: str) -> bool:
    return len(stem) >= _MIN_STEM or stem in _SHORT_STEMS


def _all_readings(token: str) -> list[str]:
    """
    Every reading of `token` as the plural or "-s" form of another word, most
    likely first, without regard to what the classifier thinks of it. Empty for
    a word that is not, or might not be, one.
    """
    if token in _IRREGULAR:
        return [_IRREGULAR[token]]

    if (
        len(token) < _MIN_WORD
        or not _ENGLISH_WORD.match(token)
        or token in _NOT_INFLECTED
        or token.endswith(_NEVER_PLURAL_ENDINGS)
        or not token.endswith("s")
    ):
        return []

    readings: list[str] = []

    if token.endswith("ies") and len(token) > 4:
        # allergies -> allergy; and movies -> movie, which is the "s" alone.
        readings.append(token[:-3] + "y")

    if token.endswith("ves"):
        # leaves -> leave, and knives -> knife, halves -> half.
        readings += [token[:-1], token[:-3] + "fe", token[:-3] + "f"]
    elif token.endswith("es"):
        stem = token[:-2]
        if stem.endswith(_ES_AFTER):
            # goes -> go, watches -> watch, boxes -> box.
            readings += [stem, token[:-1]]
        else:
            # horses -> horse, medicines -> medicine.
            readings += [token[:-1], stem]

    readings.append(token[:-1])

    seen: set[str] = set()
    return [
        reading
        for reading in readings
        if _plausible(reading) and not (reading in seen or seen.add(reading))
    ]


def readings(token: str) -> list[str]:
    """
    The words `token` may be a plural or "-s" form of, to look a clip up under
    when there is none for `token` itself. Empty for anything the safety
    classifier has a view on: a word that carries meaning is never rewritten.
    """
    if classify(token) != TokenRisk.CONTENT:
        return []

    return _all_readings(token)


def blocking_reading(token: str) -> bool:
    """
    Whether `token` is the plural or "-s" form of a word that stops a sentence
    being shown, such as "halves", "doubles", "stops" or "avoids".

    For when there is no clip: such a word is refused like the word it is, not
    fingerspelled as though it were an unknown noun.
    """
    return any(
        classify(reading) == TokenRisk.BLOCKING for reading in _all_readings(token)
    )


def base_form(token: str) -> str:
    """
    One form to compare a word by, for matching whole phrases.

    A phrase clip is named by its words (WHAT_IS_YOUR_NAME), and "what is your
    names" should reach it. Both the clip's words and the typed ones are put
    through this, so two forms of a word meet on the same one. Only the
    likeliest reading is used, and only for words the classifier is silent on.
    """
    found = readings(token)
    return found[0] if found else token
