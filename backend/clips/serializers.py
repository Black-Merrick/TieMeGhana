from rest_framework import serializers

from clips.models import SignClip
from clips.stitching import stitched_video_url


class SignClipSerializer(serializers.ModelSerializer):
    """
    A clip as the frontend needs it: enough to play, nothing more.

    Review fields are deliberately absent. They are operational data for the
    admin review workflow, and the patient facing app has no use for them.
    """

    video_url = serializers.SerializerMethodField()

    class Meta:
        model = SignClip
        fields = ["id", "gloss", "kind", "video_url", "duration_ms"]

    def get_video_url(self, clip: SignClip) -> str | None:
        """
        The clip's playable URL, or null when it has not been filmed.

        FileField.url raises when the field is empty, so this cannot simply
        return it. A clip without footage is a normal state, see ADR 009, and
        it reaches this serializer wherever clips are nested inside something
        else, such as an answer option in the question bank.
        """
        return clip.video.url if clip.video else None


class ResolvedClipSerializer(serializers.Serializer):
    """One playable clip inside a resolved sequence."""

    gloss = serializers.CharField()
    video_url = serializers.CharField()
    duration_ms = serializers.IntegerField()


class SignSegmentSerializer(serializers.Serializer):
    """One caption token and the clips that render it."""

    token = serializers.CharField()
    match = serializers.CharField()
    clips = ResolvedClipSerializer(many=True)


class SignSequenceSerializer(serializers.Serializer):
    """
    The response contract for a resolved caption.

    `fingerspelled_tokens` and `unavailable_tokens` are included so the
    interface can show coverage honestly rather than presenting a sentence as
    fully signed when part of it was spelled or dropped.
    """

    source_text = serializers.CharField()
    segments = SignSegmentSerializer(many=True)
    total_duration_ms = serializers.IntegerField()
    fingerspelled_tokens = serializers.ListField(child=serializers.CharField())
    unavailable_tokens = serializers.ListField(child=serializers.CharField())
    stitched_video_url = serializers.SerializerMethodField()

    def get_stitched_video_url(self, sequence) -> str | None:
        """
        One video file containing the whole sentence, FR 1.7 and ADR 031.

        Null when there is nothing to stitch, when ffmpeg is unavailable, or
        when encoding fails. The player falls back to playing the clips in
        sequence, so the patient still sees every sign either way.

        Encoding happens here, on first request for a given sentence, and is
        cached by the exact ordered clips it contains. Every later request for
        the same sentence is served from disk.
        """
        return stitched_video_url(sequence)


class SignSequenceRequestSerializer(serializers.Serializer):
    """
    Validates a caption before resolving it.

    Whitespace only input is rejected rather than resolved to an empty
    sequence, because that almost always means the caller has a bug and a
    silent empty response would hide it.
    """

    text = serializers.CharField(max_length=1000, trim_whitespace=True)
