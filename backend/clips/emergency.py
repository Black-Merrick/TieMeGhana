"""
The critical alerts a patient can raise in Emergency Visual Triage, FR 5.3.

A fixed, named set rather than anything the doctor composes. In an emergency
there is no time for a guided conversation, and the abstract is explicit that a
first responder unfamiliar with the app has to be able to use it within
seconds. A short list of one-tap alerts is the only thing that survives that
constraint.

FR 5.3 names the three. They are kept in the order a responder would scan
them: the one that stops a patient breathing first.
"""

# Gloss, the English label the clinician reads, and a stable key the frontend
# uses to pick an icon. The key is not the gloss, because an icon is a drawing
# decision and a gloss is a clinical identifier, and coupling them would mean
# renaming a sign to change a picture.
CRITICAL_ALERTS = [
    ("CANNOT_BREATHE", "Cannot breathe", "breathing"),
    ("ASTHMA", "Asthma", "asthma"),
    ("PREGNANCY", "Pregnant", "pregnancy"),
]

CRITICAL_ALERT_GLOSSES = [gloss for gloss, _, _ in CRITICAL_ALERTS]
