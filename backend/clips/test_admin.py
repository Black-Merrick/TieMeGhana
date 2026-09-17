"""
Tests for the clip review actions in the admin: approve, reject, rework.

Approve and rework had shipped with no tests at all. Reject is new: the model
has carried a REJECTED status since the beginning, and nothing anywhere ever
set it. Written together because the three share the one property that
actually matters here, that they cannot be confused with one another: pending
means unreviewed, approved means cleared, rejected means a specific recording
was watched and refused, and none of the three should be reachable by
accident from either of the others.
"""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from clips.models import ClipKind, ReviewStatus, SignClip


def make_clip(gloss, *, kind=ClipKind.WORD, filmed=True, **extra):
    clip = SignClip.objects.create(gloss=gloss, kind=kind, **extra)
    if filmed:
        clip.video.save(
            f"{gloss.lower()}.webm",
            SimpleUploadedFile(f"{gloss.lower()}.webm", b"pretend-video"),
            save=True,
        )
    return clip


@pytest.fixture
def admin_client(django_user_model, client):
    django_user_model.objects.create_superuser(
        username="reviewer", email="r@example.com", password="pw", first_name="Ama"
    )
    client.login(username="reviewer", password="pw")
    return client


def selected(*clips):
    """Query string selecting these rows for an admin action, POST form shape."""
    data = {"action": "", "_selected_action": [str(c.pk) for c in clips]}
    return data


@pytest.mark.django_db
class TestApprove:
    def test_approves_a_filmed_clip_and_records_the_reviewer(self, admin_client):
        clip = make_clip("HEAD")

        admin_client.post(
            "/admin/clips/signclip/",
            {**selected(clip), "action": "approve_for_clinical_use"},
        )

        clip.refresh_from_db()
        assert clip.review_status == ReviewStatus.APPROVED
        assert clip.reviewed_by == "Ama"
        assert clip.is_resolvable

    def test_skips_a_clip_with_no_footage_rather_than_approving_it(self, admin_client):
        # Approving a gloss with no video would create a row that claims to
        # be reviewed while having nothing to play.
        clip = make_clip("HEAD", filmed=False)

        admin_client.post(
            "/admin/clips/signclip/",
            {**selected(clip), "action": "approve_for_clinical_use"},
        )

        clip.refresh_from_db()
        assert clip.review_status == ReviewStatus.PENDING

    def test_approving_a_previously_rejected_clip_clears_the_rejection(
        self, admin_client
    ):
        # A reviewer reconsidering, or a second opinion. Approve still means
        # approve regardless of what the status was before.
        clip = make_clip("HEAD", review_status=ReviewStatus.REJECTED)

        admin_client.post(
            "/admin/clips/signclip/",
            {**selected(clip), "action": "approve_for_clinical_use"},
        )

        clip.refresh_from_db()
        assert clip.review_status == ReviewStatus.APPROVED


@pytest.mark.django_db
class TestReject:
    """
    The action the model was always meant to support. `REJECTED` has been a
    choice on `review_status` since the start; nothing anywhere ever set it.
    """

    def test_a_get_shows_a_confirmation_and_rejects_nothing(self, admin_client):
        clip = make_clip("HEAD")

        response = admin_client.post(
            "/admin/clips/signclip/", {**selected(clip), "action": "reject_clips"}
        )

        assert response.status_code == 200
        clip.refresh_from_db()
        assert clip.review_status == ReviewStatus.PENDING

    def test_confirming_with_a_reason_rejects_the_clip(self, admin_client):
        clip = make_clip("HEAD")

        admin_client.post(
            "/admin/clips/signclip/",
            {
                **selected(clip),
                "action": "reject_clips",
                "post": "yes",
                "reason": "Wrong handshape for this sign in GhSL.",
            },
        )

        clip.refresh_from_db()
        assert clip.review_status == ReviewStatus.REJECTED
        assert clip.reviewed_by == "Ama"

    def test_the_reason_is_recorded_in_the_notes_with_attribution(self, admin_client):
        # What lets a second reviewer see this was already tried, and what
        # lets whoever re-films it know what to fix, rather than repeating
        # the same mistake.
        clip = make_clip("HEAD")

        admin_client.post(
            "/admin/clips/signclip/",
            {
                **selected(clip),
                "action": "reject_clips",
                "post": "yes",
                "reason": "Signer's face is out of frame.",
            },
        )

        clip.refresh_from_db()
        assert "Signer's face is out of frame." in clip.notes
        assert "Ama" in clip.notes

    def test_a_reason_is_required_and_nothing_is_rejected_without_one(
        self, admin_client
    ):
        clip = make_clip("HEAD")

        response = admin_client.post(
            "/admin/clips/signclip/",
            {
                **selected(clip),
                "action": "reject_clips",
                "post": "yes",
                "reason": "",
            },
        )

        assert response.status_code == 200
        clip.refresh_from_db()
        assert clip.review_status == ReviewStatus.PENDING

    def test_a_reason_of_only_whitespace_is_also_refused(self, admin_client):
        clip = make_clip("HEAD")

        admin_client.post(
            "/admin/clips/signclip/",
            {
                **selected(clip),
                "action": "reject_clips",
                "post": "yes",
                "reason": "   ",
            },
        )

        clip.refresh_from_db()
        assert clip.review_status == ReviewStatus.PENDING

    def test_rejecting_an_unfilmed_clip_is_allowed(self, admin_client):
        # Rejecting the concept before it is filmed is a legitimate outcome:
        # a consultant saying this is not how the idea is actually signed, so
        # do not film it as worded. Unlike approval, there is nothing here
        # that requires footage to exist.
        clip = make_clip("HEAD", filmed=False)

        admin_client.post(
            "/admin/clips/signclip/",
            {
                **selected(clip),
                "action": "reject_clips",
                "post": "yes",
                "reason": "This is not the right gloss for the concept.",
            },
        )

        clip.refresh_from_db()
        assert clip.review_status == ReviewStatus.REJECTED

    def test_rejecting_an_approved_clip_pulls_it_out_of_clinical_use(
        self, admin_client
    ):
        clip = make_clip("HEAD", review_status=ReviewStatus.APPROVED)
        assert clip.is_resolvable

        admin_client.post(
            "/admin/clips/signclip/",
            {
                **selected(clip),
                "action": "reject_clips",
                "post": "yes",
                "reason": "Later found to be the wrong sign entirely.",
            },
        )

        clip.refresh_from_db()
        assert not clip.is_resolvable
        assert clip.review_status == ReviewStatus.REJECTED

    def test_rejecting_several_clips_records_the_reason_on_each(self, admin_client):
        head = make_clip("HEAD")
        chest = make_clip("CHEST")

        admin_client.post(
            "/admin/clips/signclip/",
            {
                **selected(head, chest),
                "action": "reject_clips",
                "post": "yes",
                "reason": "Batch re-shoot: lighting made the hands hard to see.",
            },
        )

        head.refresh_from_db()
        chest.refresh_from_db()
        assert head.review_status == ReviewStatus.REJECTED
        assert chest.review_status == ReviewStatus.REJECTED
        assert "lighting" in head.notes
        assert "lighting" in chest.notes

    def test_a_second_rejection_appends_rather_than_overwrites_the_notes(
        self, admin_client
    ):
        # A clip can be filmed, rejected, refilmed, and rejected again. The
        # history of what went wrong each time is worth more kept than lost.
        clip = make_clip("HEAD", notes="Pre-existing note from filming.")

        admin_client.post(
            "/admin/clips/signclip/",
            {
                **selected(clip),
                "action": "reject_clips",
                "post": "yes",
                "reason": "First attempt: wrong hand used.",
            },
        )
        admin_client.post(
            "/admin/clips/signclip/",
            {
                **selected(clip),
                "action": "reject_clips",
                "post": "yes",
                "reason": "Second attempt: still out of frame.",
            },
        )

        clip.refresh_from_db()
        assert "Pre-existing note from filming." in clip.notes
        assert "First attempt: wrong hand used." in clip.notes
        assert "Second attempt: still out of frame." in clip.notes

    def test_it_needs_a_logged_in_admin(self, client):
        clip = make_clip("HEAD")

        client.post(
            "/admin/clips/signclip/",
            {
                **selected(clip),
                "action": "reject_clips",
                "post": "yes",
                "reason": "Should never reach this.",
            },
        )

        clip.refresh_from_db()
        assert clip.review_status == ReviewStatus.PENDING


@pytest.mark.django_db
class TestReturnForRework:
    """
    Distinct from reject: for a recording that simply is not finished, rather
    than one a reviewer is actively refusing. Setting REJECTED here would
    leave a false "somebody said no" mark on a clip nobody has judged yet.
    """

    def test_returns_an_approved_clip_to_pending(self, admin_client):
        clip = make_clip(
            "HEAD", review_status=ReviewStatus.APPROVED, reviewed_by="Someone"
        )

        admin_client.post(
            "/admin/clips/signclip/",
            {**selected(clip), "action": "return_for_rework"},
        )

        clip.refresh_from_db()
        assert clip.review_status == ReviewStatus.PENDING
        assert clip.reviewed_by == ""

    def test_does_not_touch_the_notes(self, admin_client):
        # Unlike reject, this carries no reason, so it must not invent one by
        # writing into the one field a rejection's reason lives in.
        clip = make_clip(
            "HEAD", review_status=ReviewStatus.APPROVED, notes="Original note."
        )

        admin_client.post(
            "/admin/clips/signclip/",
            {**selected(clip), "action": "return_for_rework"},
        )

        clip.refresh_from_db()
        assert clip.notes == "Original note."


@pytest.mark.django_db
class TestVideoPreview:
    """The inline player on the change form, so a reviewer can watch a clip
    without downloading the file first."""

    def test_the_change_form_embeds_a_video_element_for_a_filmed_clip(
        self, admin_client
    ):
        clip = make_clip("HEAD")

        response = admin_client.get(f"/admin/clips/signclip/{clip.pk}/change/")

        assert response.status_code == 200
        assert b"<video" in response.content

    def test_an_unfilmed_clip_shows_no_video_element(self, admin_client):
        clip = make_clip("HEAD", filmed=False)

        response = admin_client.get(f"/admin/clips/signclip/{clip.pk}/change/")

        assert response.status_code == 200
        assert b"<video" not in response.content
        assert b"Not filmed yet" in response.content

    def test_the_add_form_loads_with_no_clip_to_preview(self, admin_client):
        # No pk yet, so there is nothing to render a preview of. Exercised
        # because a readonly field that assumes an instance exists is a
        # common way to break the add form while only ever testing change.
        response = admin_client.get("/admin/clips/signclip/add/")

        assert response.status_code == 200
