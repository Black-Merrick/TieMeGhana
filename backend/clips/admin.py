from django.conf import settings
from django.contrib import admin, messages
from django.http import HttpResponseRedirect
from django.shortcuts import redirect
from django.urls import path, reverse

from clips.importing import import_footage
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
    The consultant review interface for the clip library.

    This is where clips enter the system, because ADR 001 makes the library a
    reviewed clinical asset rather than user generated content. The columns are
    chosen so the two questions the team actually asks, what still needs
    filming and what still needs review, are answerable at a glance.
    """

    list_display = ["gloss", "kind", "footage", "review_status", "reviewed_by"]
    list_filter = ["kind", "review_status"]
    search_fields = ["gloss", "notes"]
    ordering = ["kind", "gloss"]
    readonly_fields = ["created_at", "updated_at"]
    actions = ["approve_for_clinical_use", "return_for_rework"]
    inlines = [ClipAliasInline]
    change_list_template = "admin/clips/signclip/change_list.html"

    def get_urls(self):
        """
        Add the footage import, reachable from a button on the clip list.

        Exists because the person adding footage in a hospital will not have a
        terminal, and `manage.py import_clips` is not a realistic instruction
        for them. Same code path as the command, so the two cannot diverge.
        """
        return [
            path(
                "import-footage/",
                self.admin_site.admin_view(self.import_footage_view),
                name="clips_signclip_import_footage",
            ),
            *super().get_urls(),
        ]

    def import_footage_view(self, request):
        """
        Import everything in the footage folder.

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

    def _report_import(self, request, report) -> None:
        """Say what happened, including that nothing did."""
        if report.created:
            self.message_user(
                request,
                f"Imported {len(report.created)} new clip(s): "
                f"{', '.join(report.created)}. None are approved yet.",
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

        if not report.created and not report.replaced and not report.unchanged:
            self.message_user(
                request,
                f"No video files found in {settings.FOOTAGE_DIR}.",
                level=messages.WARNING,
            )

    @admin.display(boolean=True, description="Filmed")
    def footage(self, clip: SignClip) -> bool:
        return bool(clip.video)

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

    @admin.action(description="Return selected clips for rework")
    def return_for_rework(self, request, queryset):
        """Pull clips back out of clinical use, for example after a correction."""
        returned = queryset.update(review_status=ReviewStatus.PENDING, reviewed_by="")
        self.message_user(request, f"Returned {returned} clip(s) for rework.")

    def get_list_display(self, request):
        # The alphabet is bulk data nobody reviews individually, so reviewer
        # columns only clutter the list when filtering to letters.
        if request.GET.get("kind") == ClipKind.LETTER:
            return ["gloss", "kind", "footage", "review_status"]
        return self.list_display
