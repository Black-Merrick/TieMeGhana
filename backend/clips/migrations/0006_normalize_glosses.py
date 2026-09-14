"""
Canonicalize existing glosses, per ADR 039.

A phrase typed in the admin with spaces, "how are you doing", saved cleanly and
showed as approved but could never match anything, because the resolver looks
for a single underscored form. Rows written before normalization existed are
brought into that form here.
"""

from django.db import migrations


def normalize(apps, schema_editor):
    import re

    separators = re.compile(r"[\s\-_]+")
    SignClip = apps.get_model("clips", "SignClip")

    taken = set(SignClip.objects.values_list("gloss", flat=True))

    for clip in SignClip.objects.all():
        canonical = separators.sub("_", clip.gloss.strip()).strip("_").upper()

        if canonical == clip.gloss:
            continue

        # A collision would mean two rows claiming the same sign. Left alone
        # rather than merged or deleted, because which footage is the reviewed
        # one is not a decision a migration can make.
        if canonical in taken:
            continue

        taken.discard(clip.gloss)
        taken.add(canonical)
        clip.gloss = canonical
        clip.save(update_fields=["gloss"])


def noop(apps, schema_editor):
    """Irreversible in practice: the original spacing is not recoverable."""


class Migration(migrations.Migration):
    dependencies = [("clips", "0005_alter_signclip_kind")]

    operations = [migrations.RunPython(normalize, noop)]
