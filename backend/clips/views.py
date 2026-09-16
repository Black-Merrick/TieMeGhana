from django.shortcuts import get_object_or_404
from rest_framework import viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from clips.body_locations import BODY_LOCATIONS
from clips.emergency import CRITICAL_ALERTS
from clips.emergency_speech import all_spoken_phrases, pending_review
from clips.models import SignClip
from clips.serializers import (
    SignClipSerializer,
    SignSequenceRequestSerializer,
    SignSequenceSerializer,
)
from clips.services import resolve_sign_sequence


class SignClipViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read only access to the reviewed clip library.

    Read only is a clinical safety decision, not an oversight. The library is
    admin managed and consultant reviewed, so an endpoint that accepted new
    clips would be a route for an unreviewed medical sign to reach a patient.
    A test asserts that writes are rejected.
    """

    serializer_class = SignClipSerializer

    def get_queryset(self):
        # Only clips that are both approved and filmed are ever exposed.
        return SignClip.objects.resolvable()

    @action(detail=False, url_path="alerts")
    def alerts(self, request):
        """
        The critical alerts for Emergency Visual Triage, FR 5.3.

        Every alert is returned whether its GhSL clip is filmed or not, and
        each reports whether the clip can be played. Unlike the body location
        grid in ADR 022, an unfilmed alert is still offered: it carries an icon
        and a label, and in an emergency an icon a patient half recognises
        beats no way to say "cannot breathe" at all. See ADR 040.
        """
        filmed = {
            clip.gloss: clip
            for clip in SignClip.objects.resolvable().filter(
                gloss__in=[gloss for gloss, _, _ in CRITICAL_ALERTS]
            )
        }

        return Response(
            [
                {
                    "id": gloss,
                    "english_text": label,
                    "icon": icon,
                    "is_playable": gloss in filmed,
                    "clip": (
                        SignClipSerializer(filmed[gloss]).data
                        if gloss in filmed
                        else None
                    ),
                }
                for gloss, label, icon in CRITICAL_ALERTS
            ]
        )

    @action(detail=False, url_path="emergency-speech")
    def emergency_speech(self, request):
        """
        Every phrase Emergency Visual Triage can say, in both languages.

        Emergency mode has no free text, so its whole vocabulary is known in
        advance and is translated once rather than at the moment of a tap.
        That is the difference between a tap speaking immediately and one
        costing two calls to a metered service and about five seconds, which
        is not an emergency tool. See clips/emergency_speech.py.

        `tw_reviewed` is the part the caller must honour. Unreviewed Twi is
        served so it can be seen and corrected, never so it can be spoken: the
        machine returned "Nose" for "Nose" and "Waist a ɔyɛ ɔkwasea" for
        "Waist", and reading either to a clinician during triage is worse than
        reading English.
        """
        return Response(
            {
                "phrases": all_spoken_phrases(),
                "pending_review": pending_review(),
            }
        )

    @action(detail=False, url_path="body-locations")
    def body_locations(self, request):
        """
        The body locations a patient can point to, FR 2.5.

        Every location is returned, filmed or not, each reporting whether it
        can be shown. The caller withholds the whole grid unless all of them
        can: a patient offered three body parts when their pain is in a fourth
        taps the nearest available one, and that wrong answer looks exactly
        like a right one. See ADR 022.
        """
        filmed = {
            clip.gloss: clip
            for clip in SignClip.objects.resolvable().filter(
                gloss__in=[gloss for gloss, _ in BODY_LOCATIONS]
            )
        }

        return Response(
            [
                {
                    "id": gloss,
                    "english_text": label,
                    "is_playable": gloss in filmed,
                    "clip": (
                        SignClipSerializer(filmed[gloss]).data
                        if gloss in filmed
                        else None
                    ),
                }
                for gloss, label in BODY_LOCATIONS
            ]
        )

    @action(detail=False, url_path=r"by-gloss/(?P<gloss>[^/]+)")
    def by_gloss(self, request, gloss=None):
        """
        Fetch one clip by its gloss rather than by database id.

        The frontend needs specific clips by name, for example the FR 2.1
        literacy prompt, and it should not have to know or store primary keys
        to find them. A missing clip is a 404 rather than an empty response,
        so a caller cannot mistake "not filmed yet" for "played successfully".
        """
        clip = get_object_or_404(self.get_queryset(), gloss=gloss.strip().upper())
        return Response(self.get_serializer(clip).data)


@api_view(["POST"])
def sign_sequence(request):
    """
    Resolve caption text into the ordered GhSL clips that render it.

    POST rather than GET because the caption is user content that can be long
    and can contain characters awkward in a URL, and because a caption should
    not end up in server access logs or browser history.
    """
    request_serializer = SignSequenceRequestSerializer(data=request.data)
    request_serializer.is_valid(raise_exception=True)

    sequence = resolve_sign_sequence(request_serializer.validated_data["text"])
    return Response(SignSequenceSerializer(sequence).data)
