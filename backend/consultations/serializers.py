import base64

from rest_framework import serializers

from clips.serializers import SignSequenceSerializer
from core.language.base import Language

#: Languages a listener can be spoken to in. `MIXED` is excluded: it says an
#: utterance contains both languages, which is a fact about what was produced,
#: not a voice anything can be synthesized with.
SPEAKABLE_LANGUAGES = [
    language.value for language in Language if language.is_provider_language
]

ALL_LANGUAGES = [language.value for language in Language]


class CaptionRequestSerializer(serializers.Serializer):
    """
    Validates one doctor utterance, typed or spoken.

    FR 1.1 requires the doctor to choose the input language before speaking, so
    `source_language` is required rather than defaulted. Captioning in a
    language the doctor did not pick would produce confidently wrong Twi.
    """

    source_language = serializers.ChoiceField(choices=ALL_LANGUAGES)
    text = serializers.CharField(
        max_length=1000, trim_whitespace=True, required=False, allow_blank=False
    )
    audio = serializers.FileField(required=False)

    def validate(self, attrs):
        """
        Require exactly one input, and refuse mixed speech.

        Neither input means there is nothing to caption. Both is ambiguous, and
        guessing which the doctor meant risks captioning something they did not
        say, which in a clinical setting is worse than an error message.
        """
        has_text = bool(attrs.get("text"))
        has_audio = bool(attrs.get("audio"))

        if has_text == has_audio:
            raise serializers.ValidationError(
                "Provide exactly one of 'text' or 'audio'."
            )

        if has_audio and attrs["source_language"] == Language.MIXED:
            # Speech recognition runs one language at a time: there is no model
            # to ask for a sentence that switches. Refused with the reason
            # rather than transcribed as English, which would render the Twi
            # words as whatever English they happen to sound like and hand the
            # doctor a plausible sentence they never said.
            raise serializers.ValidationError(
                {
                    "source_language": (
                        "Mixed English and Twi can be typed but not spoken: "
                        "speech recognition handles one language at a time. "
                        "Choose the language you are speaking, or type the "
                        "message instead."
                    )
                }
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
    # The English text the clips were looked up from. Exposed because when a
    # sign is missing, the doctor needs to see which English word was searched
    # for, which is not always the word they typed.
    sign_lookup_text = serializers.CharField()
    # Whether the transcript came from speech or from typing. The interface
    # needs it because a stub transcript is fabricated, not just untranslated.
    transcript_source = serializers.CharField()
    translation_applied = serializers.BooleanField()
    language_provider = serializers.CharField()
    sequence = SignSequenceSerializer()


class SpeakRequestSerializer(serializers.Serializer):
    """
    Validates a patient response before speaking it.

    Both languages are required. The source is whichever the patient answered
    in, the output is the hearing listener's, set once per session per FR 3.4.
    Defaulting either would risk speaking Twi at someone who only reads English
    and calling that a successful exchange.
    """

    text = serializers.CharField(max_length=1000, trim_whitespace=True)
    # The patient's answer may itself mix the two languages, so the source
    # accepts it and the text is then spoken as written.
    source_language = serializers.ChoiceField(choices=ALL_LANGUAGES)
    # The output cannot. It chooses the voice, and there is no mixed voice;
    # accepting one would mean picking English or Twi arbitrarily and reporting
    # whichever was picked as though it had been asked for.
    output_language = serializers.ChoiceField(choices=SPEAKABLE_LANGUAGES)


class SpokenResponseSerializer(serializers.Serializer):
    """
    The spoken response, with the audio inline.

    Audio travels base64 encoded inside the JSON rather than as a separate
    binary response, so the text that was actually spoken and the provider that
    produced it arrive with it. That matters for ADR 011: the interface has to
    be able to say the audio is silence from the stub rather than real speech,
    and it cannot do that from a bare audio body.
    """

    source_language = serializers.CharField()
    output_language = serializers.CharField()
    spoken_text = serializers.CharField()
    translation_applied = serializers.BooleanField()
    language_provider = serializers.CharField()
    audio_base64 = serializers.SerializerMethodField()
    audio_media_type = serializers.CharField()

    def get_audio_base64(self, response) -> str:
        return base64.b64encode(response.audio).decode("ascii")
