from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.exceptions import APIException
from rest_framework.response import Response

from consultations.serializers import (
    CaptionRequestSerializer,
    CaptionResponseSerializer,
)
from consultations.services import build_caption
from core.language import Language, LanguageError


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
        )
    except LanguageError as error:
        raise LanguageServiceUnavailable() from error

    return Response(CaptionResponseSerializer(result).data)
