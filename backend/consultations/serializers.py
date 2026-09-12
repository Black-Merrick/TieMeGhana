from rest_framework import serializers

from clips.serializers import SignSequenceSerializer
from core.language.base import Language


class CaptionRequestSerializer(serializers.Serializer):
    """
    Validates one doctor utterance, typed or spoken.

    FR 1.1 requires the doctor to choose the input language before speaking, so
    `source_language` is required rather than defaulted. Captioning in a
    language the doctor did not pick would produce confidently wrong Twi.
    """

    source_language = serializers.ChoiceField(choices=[lang.value for lang in Language])
    text = serializers.CharField(
        max_length=1000, trim_whitespace=True, required=False, allow_blank=False
    )
    audio = serializers.FileField(required=False)

    def validate(self, attrs):
        """
        Require exactly one input.

        Neither means there is nothing to caption. Both is ambiguous, and
        guessing which the doctor meant risks captioning something they did not
        say, which in a clinical setting is worse than an error message.
        """
        has_text = bool(attrs.get("text"))
        has_audio = bool(attrs.get("audio"))

        if has_text == has_audio:
            raise serializers.ValidationError(
                "Provide exactly one of 'text' or 'audio'."
            )

        return attrs


class CaptionResponseSerializer(serializers.Serializer):
    """
    The caption pipeline result, as the doctor's screen consumes it.

    `language_provider` is part of the contract on purpose. It is what lets the
    interface warn that output came from the development stub rather than real
    Twi translation, so a demo cannot accidentally overclaim. See ADR 011.
    """

    source_language = serializers.CharField()
    transcript = serializers.CharField()
    caption = serializers.CharField()
    caption_language = serializers.CharField()
    translation_applied = serializers.BooleanField()
    language_provider = serializers.CharField()
    sequence = SignSequenceSerializer()
