"""
Deciding whether a resolved sentence is safe to show a patient.

A word that cannot be signed is currently just absent from playback, and
absence changes meaning. "Do you have no pain" becomes "pain". "Take two
tablets" becomes "tablets". "Stop the medicine" becomes "medicine". The patient
answers the sentence they were shown, the doctor never learns which sentence
that was, and nothing about it looks wrong.

So words are classified by what their absence does, and a sentence that would
change meaning is refused rather than shown. See ADR 033.

**These lists are clinical judgments, not engineering ones.** They are a
starting point for review by the team's Deaf member and a GhSL consultant, and
they should be expected to grow. Adding a word to BLOCKING is always safe;
adding one to SAFE_TO_DROP is a claim that its absence cannot change what a
patient understands.
"""

# Words whose absence cannot change clinical meaning, because Ghanaian Sign
# Language does not use them in the first place. GhSL, like every sign
# language, has no articles and no copula: "do you have pain" is signed roughly
# PAIN YOU. Dropping these produces more natural GhSL, not broken GhSL.
#
# Deliberately conservative. Prepositions are absent: "pain in chest" and "pain
# on chest" are different clinical statements, so they are not treated as
# noise. Deictics such as "this" and "here" are absent for the same reason.
SAFE_TO_DROP = frozenset(
    {
        "a",
        "an",
        "the",
        "am",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "do",
        "does",
        "did",
        "of",
        "and",
        "please",
    }
)

# Words whose absence inverts or rescales meaning. If one of these cannot be
# signed, the sentence is not shown at all.
NEGATION = {
    "no",
    "not",
    "none",
    "never",
    "without",
    "dont",
    "doesnt",
    "didnt",
    "cannot",
    "cant",
    "wont",
    "stop",
    "avoid",
    "refuse",
}

# Dosage and quantity. "Take two tablets" losing "two" is a dosing error.
QUANTITY = {
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "half",
    "double",
    "all",
}

# How often, and when. "Take after food" and "take before food" are different
# instructions, and losing either word leaves neither.
FREQUENCY = {
    "once",
    "twice",
    "daily",
    "weekly",
    "monthly",
    "hourly",
    "times",
    "every",
    "before",
    "after",
    "morning",
    "night",
}

# How much. Losing these turns a description of severity into a bare symptom,
# which is what a doctor uses to decide urgency.
INTENSITY = {
    "severe",
    "serious",
    "mild",
    "slight",
    "little",
    "very",
    "more",
    "less",
    "worse",
    "better",
    "only",
}

BLOCKING = frozenset(NEGATION | QUANTITY | FREQUENCY | INTENSITY)


class TokenRisk:
    """
    What the absence of a word would do to the sentence.

    Part of the API contract, because the interface has to explain the
    difference between a word it chose to leave out and one that stopped the
    sentence being shown at all.
    """

    #: Absence cannot change meaning. GhSL does not use it anyway.
    DROPPABLE = "droppable"
    #: Absence inverts or rescales meaning. The sentence must not be shown.
    BLOCKING = "blocking"
    #: Carries the meaning. Absence leaves the sentence incomplete.
    CONTENT = "content"


def classify(token: str) -> str:
    """Classify one lowercase token by what its absence would do."""
    if token in BLOCKING:
        return TokenRisk.BLOCKING

    # Any number is a quantity, whether written as digits or words. A dose,
    # a count of days, a temperature.
    if any(character.isdigit() for character in token):
        return TokenRisk.BLOCKING

    if token in SAFE_TO_DROP:
        return TokenRisk.DROPPABLE

    return TokenRisk.CONTENT
