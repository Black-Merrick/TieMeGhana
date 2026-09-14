"""
The body locations a patient can point to, FR 2.5.

This is the one structured answer set in the app. Everything else the doctor
asks is typed or spoken freely and answered yes or no, see ADR 023, but "where
does it hurt" needs the patient to indicate a place, and a place cannot be
answered yes or no.

Ordered head downwards, so the grid reads like a body rather than an
alphabetical list.
"""

# Gloss, and the English label the doctor reads.
BODY_LOCATIONS = [
    ("HEAD", "Head"),
    ("EYE", "Eye"),
    ("EAR", "Ear"),
    ("NOSE", "Nose"),
    ("MOUTH", "Mouth"),
    ("THROAT", "Throat"),
    ("NECK", "Neck"),
    ("CHEST", "Chest"),
    ("HEART", "Heart"),
    ("STOMACH", "Stomach"),
    ("WAIST", "Waist"),
    ("BACK", "Back"),
    ("ARM", "Arm"),
    ("HAND", "Hand"),
    ("LEG", "Leg"),
    ("FOOT", "Foot"),
]

BODY_LOCATION_GLOSSES = [gloss for gloss, _ in BODY_LOCATIONS]

#: What the doctor's "where does it hurt" action says, stitched from the clip
#: library like any other utterance.
WHERE_DOES_IT_HURT = "Where does it hurt?"
