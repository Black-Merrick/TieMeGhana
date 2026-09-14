from django.contrib import admin

from prescriptions.models import Prescription, PrescriptionItem


class PrescriptionItemInline(admin.TabularInline):
    model = PrescriptionItem
    extra = 0
    # Editing an issued prescription in the admin would change what a patient
    # already holds a QR code for, with no record that it changed. Reading one
    # is useful for support; rewriting one is not.
    readonly_fields = ("position", "medicine", "dosage", "frequency", "caption")
    can_delete = False


@admin.register(Prescription)
class PrescriptionAdmin(admin.ModelAdmin):
    list_display = ("reference", "created_at")
    readonly_fields = ("reference", "created_at")
    inlines = (PrescriptionItemInline,)

    def has_add_permission(self, request):
        # Prescriptions are issued by a doctor through the app, where the
        # instruction is checked against the clip library before it is handed
        # over. One typed straight into the admin skips that check.
        return False
