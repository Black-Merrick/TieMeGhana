from django.contrib import admin, messages

from clips.models import ClipKind, ReviewStatus, SignClip


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
