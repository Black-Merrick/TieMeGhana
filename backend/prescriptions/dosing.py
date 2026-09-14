"""
The vocabulary a prescription is written in, FR 6.1.

A doctor used to type "how much" and "how often" as free text, which put the
whole safety gate on a knife edge: any wording at all could be entered, most of
it had no chance of resolving to signs, and the doctor found out only after the
prescription was issued. Real prescriptions are not free text anyway. They are a
dose, a time, a relation to food, and sometimes a length of course: one tablet,
morning and evening, after food, for five days.

Writing that structure down here does three things.

The sentence is generated rather than typed, so it is always drawn from words
that are known in advance. Once these clips are filmed, every prescription the
app can produce is signable, instead of some of them being refused for reasons
the doctor has to guess at.

The filming list becomes exact. Everything below is the complete vocabulary a
prescription can use, and nothing else can appear in one.

And the caption and the signs come from the same sentence, so what the
pharmacist reads and what the patient watches cannot drift apart.
"""

# How much. Halves are common enough on a paediatric dose to be worth their own
# word rather than being typed as "0.5", which no one signs.
AMOUNTS = {
    "HALF": "half",
    "1": "one",
    "2": "two",
    "3": "three",
    "4": "four",
    "5": "five",
    "6": "six",
    "7": "seven",
    "8": "eight",
    "9": "nine",
    "10": "ten",
}

# Singular and plural, because the caption is read by a pharmacist and "two
# tablet" reads as a mistake in a document people have to trust. The plural is
# a separate word to the resolver, so both forms are on the filming list.
UNITS = {
    "TABLET": ("tablet", "tablets"),
    "CAPSULE": ("capsule", "capsules"),
    "SPOON": ("spoon", "spoons"),
    "DROP": ("drop", "drops"),
    "ML": ("millilitre", "millilitres"),
    "INJECTION": ("injection", "injections"),
    "SACHET": ("sachet", "sachets"),
}

# When. A time of day is a different instruction from a count: "one in the
# morning and one at night" is not the same prescription as "twice a day", and
# a patient who is told the second may take both together.
TIMES_OF_DAY = {
    "MORNING": "morning",
    "AFTERNOON": "afternoon",
    "EVENING": "evening",
    "NIGHT": "night",
}

# How often, when no particular time is given.
FREQUENCIES = {
    "ONCE": "once a day",
    "TWICE": "twice a day",
    "THREE_TIMES": "three times a day",
    "FOUR_TIMES": "four times a day",
}

# Relation to food. Left out entirely when it does not matter, rather than
# saying so, because a sentence that says less is a sentence with less to lose
# in the signing.
MEALS = {
    "BEFORE": "before food",
    "AFTER": "after food",
    "WITH": "with food",
}


def dosage_phrase(amount: str, unit: str) -> str:
    """
    "one tablet", "two tablets", "half tablet".

    Half takes the singular, which is what English does and what a pharmacist
    expects to read.
    """
    singular, plural = UNITS[unit]
    word = AMOUNTS[amount]
    plural_wanted = amount not in ("HALF", "1")

    return f"{word} {plural if plural_wanted else singular}"


def frequency_phrase(
    times: list[str] | None,
    frequency: str | None,
    meal: str | None,
    days: int | None,
) -> str:
    """
    "morning and evening, after food, for five days".

    Specific times win over a count when both are given, because they say
    strictly more: a patient told "morning and evening" knows when, where one
    told "twice a day" has to decide.
    """
    parts = []

    if times:
        # In the order of the day rather than the order they were ticked, so
        # the sentence reads the way the day runs.
        ordered = [TIMES_OF_DAY[key] for key in TIMES_OF_DAY if key in times]
        parts.append(_joined(ordered))
    elif frequency:
        parts.append(FREQUENCIES[frequency])

    if meal:
        parts.append(MEALS[meal])

    if days:
        # "for five days" rather than "for 5 days": the resolver matches words,
        # and a digit has no sign to match.
        parts.append(f"for {AMOUNTS.get(str(days), str(days))} days")

    return ", ".join(parts)


def _joined(words: list[str]) -> str:
    """
    "morning", "morning and evening", "morning, afternoon and evening".

    "and" is used rather than a bare comma list because the caption is prose
    that a pharmacist reads aloud. It costs nothing in the signing: the safety
    gate already classifies "and" as droppable, so it is left out of the signed
    sentence rather than needing a clip of its own.
    """
    if len(words) <= 1:
        return words[0] if words else ""

    return f"{', '.join(words[:-1])} and {words[-1]}"


def filming_vocabulary() -> list[str]:
    """
    Every word a prescription needs a clip for.

    Derived from the tables above rather than written out again, so the list
    cannot fall behind the vocabulary it describes. A test walks every sentence
    the builders can produce and asserts each word is here, which is how "for"
    was found missing: it comes from the duration phrase rather than from any
    table, and would have been left off a filming list assembled by eye.

    Droppable words are excluded. The safety gate leaves "a" and "and" out of a
    signed sentence because GhSL does not use them, so filming them would be
    work that nothing ever plays.
    """
    from clips.safety import TokenRisk, classify

    words = set(AMOUNTS.values())

    for singular, plural in UNITS.values():
        words.add(singular)
        words.add(plural)

    words |= set(TIMES_OF_DAY.values())

    for phrase in list(FREQUENCIES.values()) + list(MEALS.values()):
        words |= set(phrase.split())

    # Added by `frequency_phrase` rather than by a table above.
    words |= {"for", "days"}

    return sorted(word for word in words if classify(word) != TokenRisk.DROPPABLE)
