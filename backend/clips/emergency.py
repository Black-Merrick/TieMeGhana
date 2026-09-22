"""
The critical alerts a patient can raise in Emergency Visual Triage, FR 5.3.

A fixed, named set rather than anything the doctor composes. In an emergency
there is no time for a guided conversation, and the abstract is explicit that a
first responder unfamiliar with the app has to be able to use it within
seconds. A short list of one-tap alerts is the only thing that survives that
constraint.

FR 5.3 names three. Asthma was removed at the team's direction, leaving two:
see ADR 041. They are kept in the order a responder would scan them, the one
that stops a patient breathing first.
"""

# Gloss, the English label the clinician reads, and a stable key the frontend
# uses to pick an icon. The key is not the gloss, because an icon is a drawing
# decision and a gloss is a clinical identifier, and coupling them would mean
# renaming a sign to change a picture.
CRITICAL_ALERTS = [
    ("CANNOT_BREATHE", "Cannot breathe", "breathing"),
    ("PREGNANCY", "Pregnant", "pregnancy"),
]

CRITICAL_ALERT_GLOSSES = [gloss for gloss, _, _ in CRITICAL_ALERTS]


# The sentence each alert says, as the gloss of the phrase clip that says it.
#
# An alert is a named clinical identifier (PREGNANCY) and the footage is a
# recording of a sentence (I_am_pregnant.mp4). The two are kept apart because
# they answer different questions: a phrase clip is what the resolver plays
# when a doctor writes that sentence, and an alert is a card the patient taps
# in triage. Naming the link here means one recording can serve both without
# either feature guessing at the other's names, and it stays visible when the
# footage is replaced. See ADR 056.
ALERT_PHRASES = {
    "CANNOT_BREATHE": "I_CANNOT_BREATHE",
    "PREGNANCY": "I_AM_PREGNANT",
}
