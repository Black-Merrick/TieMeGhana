"""Prescription endpoints, SRS FR 6.1 to FR 6.4."""

from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.response import Response

from prescriptions.models import Prescription
from prescriptions.serializers import IssuePrescriptionSerializer, PlaylistSerializer
from prescriptions.services import build_playlist, issue_prescription


@api_view(["POST"])
def issue(request):
    """
    Issue a prescription and return its playlist, FR 6.1.

    The response is the full playlist rather than just the new reference, so
    the doctor sees exactly what the patient will see before handing over the
    QR code. In particular they see `is_fully_signable`: if an instruction
    cannot be rendered in GhSL safely, that has to be visible while the patient
    is still in the room and someone can explain it another way.
    """
    request_serializer = IssuePrescriptionSerializer(data=request.data)
    request_serializer.is_valid(raise_exception=True)

    prescription = issue_prescription(request_serializer.validated_data["items"])

    return Response(PlaylistSerializer(build_playlist(prescription)).data, status=201)


@api_view(["GET"])
def playlist(request, reference):
    """
    Resolve a reference to its playlist, FR 6.2 and FR 6.3.

    What a scanned QR code reaches. Unauthenticated by design: the reference
    itself is the capability, and it is unguessable. Requiring an account would
    mean a Deaf patient could not replay their own prescription at home without
    one, which defeats the requirement, and it would protect nothing, because
    the payload identifies nobody. See ADR 044.

    Signs are resolved on every request rather than stored, per ADR 043, so a
    withdrawn clip stops playing here immediately and a newly filmed one starts.
    """
    prescription = get_object_or_404(
        Prescription.objects.prefetch_related("items"), reference=reference
    )

    return Response(PlaylistSerializer(build_playlist(prescription)).data)
