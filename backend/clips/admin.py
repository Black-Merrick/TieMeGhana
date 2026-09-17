"""
The consultant review interface for the clip library, ADR 001.

Everything here answers one of three questions a reviewer actually has: what
still needs filming, what has been filmed but not looked at, and is this
particular recording good enough to show a patient. The list columns, the
filters, and the two upload paths all exist because one of those three came up
in practice and the previous shape of this file made it awkward to answer.
"""

from django.conf import settings
from django.contrib import admin, messages
from django.contrib.admin.helpers import ACTION_CHECKBOX_NAME
from django.http import HttpResponseRedirect
from django.shortcuts import redirect, render
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils import timezone
from django.utils.html import format_html

from clips.importing import (
    MAX_UPLOAD_BYTES,
    MAX_UPLOAD_FILES,
    VIDEO_SUFFIXES,
    ImportReport,
    import_footage,
    import_uploads,
)
from clips.models import ClipAlias, ClipKind, ReviewStatus, SignClip


class ClipAliasInline(admin.TabularInline):
    """
    Alternative words for a sign, edited alongside it.

    Inline because an alias only means anything against a specific sign, and
    because a reviewer looking at a clip is the person best placed to say which
    other words it covers.
    """

    model = ClipAlias
    extra = 0
    fields = ["term", "reviewed_by", "notes"]


@admin.register(SignClip)
class SignClipAdmin(admin.ModelAdmin):
    """
    Where clips enter the system and are cleared for clinical use.

    ADR 001 makes the library a reviewed clinical asset rather than user
    generated content, and every design decision below follows from what that
    review actually needs: a way to see a recording without downloading it, a
    way to reject one with a reason attached rather than silently, and a way to
    get footage into a deployment that has no shell to drop files into.
    """

    list_display = [
        "gloss",
        "kind",
        "footage",
        "review_status",
        "reviewed_by",
        "updated_at",
    ]
    list_filter = ["kind", "review_status"]
    search_fields = ["gloss", "notes", "reviewed_by"]
    ordering = ["kind", "gloss"]
    readonly_fields = ["video_preview", "source_checksum", "created_at", "updated_at"]
    actions = ["approve_for_clinical_use", "reject_clips", "return_for_rework"]
    inlines = [ClipAliasInline]
    change_list_template = "admin/clips/signclip/change_list.html"

    fieldsets = [
        (None, {"fields": ["gloss", "kind"]}),
        (
            "Footage",
            {
                "fields": ["video_preview", "video", "duration_ms"],
                "description": (
                    "One recording per gloss. Uploading a new file here "
                    "replaces the current one and resets its approval, for "
                    "the same reason a bulk upload does: whoever approved "
                    "the old recording did not see this one."
                ),
            },
        ),
        (
            "Review",
            {
                "fields": ["review_status", "reviewed_by", "notes"],
                "description": (
                    "Set by the actions in the clip list, not usually edited "
                    "here directly. A clip is only shown to a patient once it "
                    "is both filmed and Approved."
                ),
            },
        ),
        (
            "Record",
            {
                "fields": ["source_checksum", "created_at", "updated_at"],
                "classes": ["collapse"],
            },
        ),
    ]

    # ------------------------------------------------------------------
    # List display
    # ------------------------------------------------------------------

    @admin.display(boolean=True, description="Filmed")
    def footage(self, clip: SignClip) -> bool:
        return bool(clip.video)

    def get_list_display(self, request):
        # The alphabet is bulk data nobody reviews individually, so reviewer
        # and timestamp columns only clutter the list when filtering to
        # letters.
        if request.GET.get("kind") == ClipKind.LETTER:
            return ["gloss", "kind", "footage", "review_status"]
        return self.list_display

    # ------------------------------------------------------------------
    # Change form: watch the clip without leaving the admin
    # ------------------------------------------------------------------

    @admin.display(description="Preview")
    def video_preview(self, clip: SignClip):
        """
        Play the current recording inline.

        A reviewer's actual job is watching the sign and judging it, and
        making them download the file to do that is friction on the one step
        that matters most. Rendered only when a file exists: an empty
        `<video>` tag for an unfilmed gloss would look like a player that is
        broken rather than a clip that does not exist yet.
        """
        if not clip.video:
            return "Not filmed yet."

        # controls, not autoplay: a reviewer opening a list of clips to check
        # metadata should not have every tab start talking at once.
        return format_html(
            '<video src="{}" controls preload="metadata" '
            'style="max-width: 420px; max-height: 320px; background: #000; '
            'border-radius: 4px;"></video>',
            clip.video.url,
        )

    # ------------------------------------------------------------------
    # Approve / reject / rework
    # ------------------------------------------------------------------

    @admin.action(description="Approve selected clips for clinical use")
    def approve_for_clinical_use(self, request, queryset):
        """
        Mark clips reviewed, recording who approved them.

        Unfilmed clips are skipped rather than approved, since approving a
        gloss with no footage would create a row that claims to be reviewed
        while having nothing to play.
        """
        unfilmed = queryset.awaiting_footage()
        if unfilmed.exists():
            self.message_user(
                request,
                f"Skipped {unfilmed.count()} clip(s) with no footage yet: "
                + ", ".join(clip.gloss for clip in unfilmed),
                level=messages.WARNING,
            )

        approved = queryset.exclude(video="").update(
            review_status=ReviewStatus.APPROVED,
            reviewed_by=request.user.get_full_name() or request.user.get_username(),
        )
        self.message_user(request, f"Approved {approved} clip(s) for clinical use.")

    @admin.action(description="Reject selected clips (reason required)")
    def reject_clips(self, request, queryset):
        """
        Mark clips rejected, with a reason attached, in two steps.

        A stronger claim than "pending": pending means nobody has looked yet,
        rejected means somebody looked and said no. That distinction is lost
        the moment a reject silently becomes a pending, which is why this is
        not the same action as "return for rework", and why it will not
        proceed without a reason. The reason is what lets whoever re-films it
        avoid making the same mistake twice, and what lets a second reviewer
        see that this was already tried rather than assume it is untouched.

        Two steps for the same reason `delete_selected` is two steps: a
        clinical asset being pulled from use should not be one misclick away,
        and the confirmation page is where the required reason is actually
        collected.
        """
        if request.POST.get("post"):
            reason = request.POST.get("reason", "").strip()
            if not reason:
                self.message_user(
                    request,
                    "A reason is required. Nothing was rejected.",
                    level=messages.ERROR,
                )
                return self._reject_confirmation(request, queryset)

            reviewer = request.user.get_full_name() or request.user.get_username()
            stamp = timezone.now().strftime("%Y-%m-%d")
            note = f"[{stamp}] Rejected by {reviewer}: {reason}"

            updated = 0
            for clip in queryset:
                clip.review_status = ReviewStatus.REJECTED
                clip.reviewed_by = reviewer
                clip.notes = f"{clip.notes}\n\n{note}".strip() if clip.notes else note
                clip.save(
                    update_fields=[
                        "review_status",
                        "reviewed_by",
                        "notes",
                        "updated_at",
                    ]
                )
                updated += 1

            self.message_user(
                request,
                f"Rejected {updated} clip(s). Each keeps the reason in its "
                "notes, so a re-film knows what to fix.",
                level=messages.WARNING,
            )
            return None

        return self._reject_confirmation(request, queryset)

    def _reject_confirmation(self, request, queryset):
        return TemplateResponse(
            request,
            "admin/clips/signclip/reject_confirmation.html",
            {
                **self.admin_site.each_context(request),
                "title": "Reject clips",
                "queryset": queryset,
                "opts": self.model._meta,
                "action_checkbox_name": ACTION_CHECKBOX_NAME,
                "media": self.media,
            },
        )

    @admin.action(description="Return selected clips to pending, for rework")
    def return_for_rework(self, request, queryset):
        """
        Pull clips back to pending without recording a rejection reason.

        For the ordinary case of noticing a recording needs a retake before it
        was ever approved: nothing about it was wrong enough to formally
        reject, it just is not finished. Rejecting it would leave a false
        "somebody said no to this" mark on a clip that was simply never
        reviewed to begin with.
        """
        returned = queryset.update(review_status=ReviewStatus.PENDING, reviewed_by="")
        self.message_user(request, f"Returned {returned} clip(s) to pending.")

    # ------------------------------------------------------------------
    # Getting footage in: a folder on this machine, or a browser upload
    # ------------------------------------------------------------------

    def get_urls(self):
        return [
            path(
                "import-footage/",
                self.admin_site.admin_view(self.import_footage_view),
                name="clips_signclip_import_footage",
            ),
            path(
                "bulk-upload/",
                self.admin_site.admin_view(self.bulk_upload_view),
                name="clips_signclip_bulk_upload",
            ),
            *super().get_urls(),
        ]

    def import_footage_view(self, request):
        """
        Import everything in the folder this server's own disk has.

        Only useful with direct filesystem access to the machine Django is
        running on: local development, or a deployment with a shared or
        persistent volume mounted. On the usual free hosting there is neither,
        so this button does nothing there, and bulk upload is the one that
        actually works. Kept because local development still benefits from
        dropping a folder of files in and clicking one button, rather than
        opening a terminal.

        POST only. A GET that changed the library would be triggered by any
        crawler or prefetch, and importing replaces footage and resets
        approvals, so it is not a safe method.
        """
        changelist = reverse("admin:clips_signclip_changelist")

        if request.method != "POST":
            return redirect(changelist)

        try:
            report = import_footage(settings.FOOTAGE_DIR)
        except ValueError as error:
            self.message_user(request, str(error), level=messages.ERROR)
            return HttpResponseRedirect(changelist)

        self._report_import(request, report)
        return HttpResponseRedirect(changelist)

    def bulk_upload_view(self, request):
        """
        Take video files straight from the reviewer's own computer.

        This is the path that works once the app is deployed. Render's free
        tier has no shell and no persistent disk, so there is no folder to
        drop files into and nobody who could reach one if there were; whoever
        is filming or reviewing clips is doing it through this browser form.

        Each file's name, minus its extension, becomes the gloss it is filed
        under: `head.mp4` becomes HEAD. That has to be said on the page
        itself, because a misnamed file does not fail, it quietly creates or
        overwrites the wrong gloss.
        """
        changelist = reverse("admin:clips_signclip_changelist")

        if request.method == "POST":
            uploads = request.FILES.getlist("videos")
            approve = request.POST.get("approve") == "on"
            reviewer = request.POST.get("reviewer", "").strip()

            if not uploads:
                self.message_user(
                    request, "No files were selected.", level=messages.ERROR
                )
                return self._bulk_upload_form(request)

            try:
                report = import_uploads(uploads, approve=approve, reviewer=reviewer)
            except ValueError as error:
                self.message_user(request, str(error), level=messages.ERROR)
                return self._bulk_upload_form(request)

            self._report_import(request, report)
            return HttpResponseRedirect(changelist)

        return self._bulk_upload_form(request)

    def _bulk_upload_form(self, request):
        awaiting_footage = list(
            SignClip.objects.awaiting_footage()
            .order_by("gloss")
            .values_list("gloss", "kind")
        )

        return render(
            request,
            "admin/clips/signclip/bulk_upload.html",
            {
                **self.admin_site.each_context(request),
                "title": "Bulk upload clips",
                "opts": self.model._meta,
                "video_suffixes": sorted(VIDEO_SUFFIXES),
                "max_files": MAX_UPLOAD_FILES,
                "max_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
                "awaiting_footage": awaiting_footage,
                "awaiting_footage_count": len(awaiting_footage),
                "resolvable_count": SignClip.objects.resolvable().count(),
                "awaiting_review_count": SignClip.objects.awaiting_review().count(),
            },
        )

    def _report_import(self, request, report: ImportReport) -> None:
        """Say what happened, including that nothing did."""
        if report.created:
            self.message_user(
                request,
                f"Imported {len(report.created)} new clip(s): "
                f"{', '.join(report.created)}. None are approved yet unless "
                "marked so above.",
            )

        if report.replaced:
            # Louder, because replacing footage resets an approval that a
            # consultant had already given.
            self.message_user(
                request,
                f"Replaced footage for {', '.join(report.replaced)}. Approval "
                "has been reset, because the consultant approved the previous "
                "recording rather than this one.",
                level=messages.WARNING,
            )

        if report.unchanged:
            self.message_user(
                request,
                f"{len(report.unchanged)} clip(s) were already imported "
                "unchanged and were left alone.",
                level=messages.INFO,
            )

        if report.ignored:
            self.message_user(
                request,
                f"Ignored {len(report.ignored)} non video file(s): "
                f"{', '.join(report.ignored)}.",
                level=messages.WARNING,
            )

        if not report.created and not report.replaced and not report.unchanged:
            self.message_user(
                request, "No video files were imported.", level=messages.WARNING
            )
