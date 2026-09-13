"""
The prescription API contract, SRS FR 6.1 to FR 6.4.

FR 6.4 lives here as much as in the model. The response serializer names every
field it will ever emit, so a field added to the model later does not appear in
the QR payload by accident. A test pins the field list for the same reason.
"""

from rest_framework import serializers

from clips.serializers import SignSequenceSerializer


class PrescriptionItemRequestSerializer(serializers.Serializer):
    """One medicine as the doctor enters it."""

    medicine = serializers.CharField(max_length=120)
    dosage = serializers.CharField(max_length=120)
    frequency = serializers.CharField(max_length=120)


class IssuePrescriptionSerializer(serializers.Serializer):
    """
    A whole prescription being issued, FR 6.1.

    `allow_empty=False`, because an empty prescription produces a QR code that
    resolves to nothing. The patient would scan it, see an empty screen, and
    have no way to tell that from a technical failure.
    """

    items = PrescriptionItemRequestSerializer(many=True, allow_empty=False)

    def validate_items(self, items):
        # A duplicated medicine on one list is far more likely to be a double
        # submission than a genuine instruction to take two lots of the same
        # drug, and the patient cannot tell which it was.
        names = [item["medicine"].strip().casefold() for item in items]
        if len(set(names)) != len(names):
            raise serializers.ValidationError(
                "The same medicine appears more than once on this prescription."
            )
        return items


class PlaylistItemSerializer(serializers.Serializer):
    """
    One medicine, ready to play, FR 6.1.

    Medicine, dosage and frequency are sent separately as well as inside the
    instruction, so the patient's screen can show the dosage as its own line
    rather than expecting them to parse a sentence.
    """

    position = serializers.IntegerField()
    medicine = serializers.CharField()
    dosage = serializers.CharField()
    frequency = serializers.CharField()
    instruction = serializers.CharField()
    caption = serializers.CharField()
    caption_language = serializers.CharField()
    # Which provider produced the caption, per ADR 011. The stub returns its
    # input unchanged, and a caption it produced must not be presented as a
    # translation. Sent on replay as well as at issue time, because the patient
    # reading it at home needs the same warning the doctor got.
    caption_provider = serializers.CharField()
    sequence = SignSequenceSerializer()


class PlaylistSerializer(serializers.Serializer):
    """
    The whole playlist, FR 6.1 and FR 6.3.

    This is the entire payload a scanned QR code resolves to. There is no
    patient name, no visit, and no transcript, and there is no field here that
    could carry one. That is FR 6.4, enforced by the shape of the response
    rather than by a permission check.
    """

    reference = serializers.CharField()
    items = PlaylistItemSerializer(many=True)
    # The whole prescription as one file the patient saves to their phone's
    # gallery, ADR 046. Null unless every item can be signed safely, because a
    # single file cannot say that one medicine is missing from it.
    video_url = serializers.CharField(allow_null=True)
    # Told to the doctor at issue time and to the patient on replay. An item
    # that cannot be signed safely needs explaining another way, and neither
    # party can arrange that if the interface stays quiet about it.
    is_fully_signable = serializers.BooleanField()
    unsignable_positions = serializers.ListField(child=serializers.IntegerField())
