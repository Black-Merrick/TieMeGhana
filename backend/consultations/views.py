import logging

from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.exceptions import APIException
from rest_framework.response import Response

from consultations.response_service import speak_response
from consultations.serializers import (
    CaptionRequestSerializer,
    CaptionResponseSerializer,
    SpeakRequestSerializer,
    SpokenResponseSerializer,
)
from consultations.services import build_caption
from core.language import Language, LanguageError

logger = logging.getLogger(__name__)


class LanguageServiceUnavailable(APIException):
    """
    Speech recognition or translation could not be reached.

    A distinct 503 rather than a generic 500, because the doctor's next action
    differs: an outage means type the message instead, and the interface can
    only offer that if it can tell the two apart.
    """

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = (
        "The language service is unavailable. Type the message instead, "
        "or try again."
    )


@api_view(["POST"])
def caption(request):
    """
    Caption one doctor utterance and resolve it to GhSL clips.

    FR 1.1 through FR 1.7 in a single request, so the five second budget in
    NFR 1 is spent on the work rather than on repeated round trips.
    """
    request_serializer = CaptionRequestSerializer(data=request.data)
    request_serializer.is_valid(raise_exception=True)
    validated = request_serializer.validated_data

    audio_file = validated.get("audio")

    try:
        result = build_caption(
            source_language=Language(validated["source_language"]),
            text=validated.get("text"),
            audio=audio_file.read() if audio_file is not None else None,
            # The browser records WebM on Chrome and Firefox but MP4 on iOS
            # Safari, so the format is reported rather than assumed.
            audio_content_type=(
                getattr(audio_file, "content_type", None)
                if audio_file is not None
                else None
            ),
        )
    except LanguageError as error:
        # Log what the provider actually said. The doctor gets a short, useful
        # message, but discarding the provider's own error made a failure
        # impossible to diagnose without guessing, which cost real credit on a
        # metered account to rediscover. Logged server side only, never
        # returned, because a provider message could quote the utterance and
        # the utterance is clinical content.
        logger.warning(
            "Caption failed, provider=%s source_language=%s input=%s: %s",
            getattr(settings, "LANGUAGE_PROVIDER", "auto"),
            validated["source_language"],
            "audio" if audio_file is not None else "text",
            error,
        )
        raise LanguageServiceUnavailable() from error

    return Response(CaptionResponseSerializer(result).data)


@api_view(["POST"])
def speak(request):
    """
    Speak a patient response aloud to the hearing listener, FR 3.1 to FR 3.5.

    Used for typed responses and for tapped ones alike. FR 3.5 requires the
    tapped case to be audible too, because the doctor's hands are on the
    patient rather than the screen.
    """
    request_serializer = SpeakRequestSerializer(data=request.data)
    request_serializer.is_valid(raise_exception=True)
    validated = request_serializer.validated_data

    try:
        result = speak_response(
            text=validated["text"],
            source_language=Language(validated["source_language"]),
            output_language=Language(validated["output_language"]),
        )
    except LanguageError as error:
        # Same reasoning as the caption endpoint: the provider's own message is
        # logged so a failure can be diagnosed without spending metered credit
        # reproducing it, but never returned, because it can quote the
        # utterance and the utterance is clinical content.
        logger.warning(
            "Speaking a response failed, provider=%s %s to %s: %s",
            getattr(settings, "LANGUAGE_PROVIDER", "auto"),
            validated["source_language"],
            validated["output_language"],
            error,
        )
        raise LanguageServiceUnavailable() from error

    return Response(SpokenResponseSerializer(result).data)
