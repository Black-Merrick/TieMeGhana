"""
Create the admin account from the environment, once, on start.

Needed because the admin is how a GhSL consultant approves clips, and an
unapproved clip never plays: `resolvable()` requires both approval and footage.
A deployment with no way into the admin has a clip library nobody can manage.

Normally that account is made with `createsuperuser`, which wants a terminal.
Render's free tier has no shell, so there is no terminal to want. This command
is the substitute: it reads the same `DJANGO_SUPERUSER_*` variables Django's own
`createsuperuser --noinput` reads, and `entrypoint.sh` runs it on every start.

It is idempotent, and deliberately does not touch an account that already
exists. Resetting the password on every deploy would silently revert a password
changed in the admin, and a password that changes without anyone asking is
worse than one that has to be reset on purpose. `DJANGO_SUPERUSER_FORCE_RESET`
is the way to ask on purpose, which is the only recovery route available on a
platform with no shell.
"""

import os

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Create the admin account from DJANGO_SUPERUSER_* if it is missing."

    def handle(self, *args, **options):
        username = os.environ.get("DJANGO_SUPERUSER_USERNAME", "").strip()
        password = os.environ.get("DJANGO_SUPERUSER_PASSWORD", "")
        email = os.environ.get("DJANGO_SUPERUSER_EMAIL", "").strip()

        if not username or not password:
            # The ordinary case on a laptop and in CI, where the admin account
            # is made by hand. Said rather than skipped silently, so a
            # deployment that meant to configure one and did not can see why it
            # has no way in.
            self.stdout.write(
                "No DJANGO_SUPERUSER_USERNAME and DJANGO_SUPERUSER_PASSWORD, "
                "so no admin account was created."
            )
            return

        users = get_user_model()
        existing = users.objects.filter(username=username).first()

        if existing and not _force_reset():
            self.stdout.write(f"Admin account {username!r} already exists.")
            return

        # Checked against the project's own validators, which is what
        # `createsuperuser` does interactively and what `--noinput` skips. The
        # admin is reachable from the internet, and a deployment is exactly
        # where a four character password would otherwise slip through.
        try:
            validate_password(password, user=existing)
        except ValidationError as error:
            # Reported without failing the start. The service is still useful
            # without an admin account, where refusing to boot would take down
            # a working consultation screen over a password.
            self.stderr.write(
                self.style.ERROR(
                    "The admin password from the environment was refused: "
                    + " ".join(error.messages)
                )
            )
            return

        if existing:
            existing.set_password(password)
            existing.is_staff = True
            existing.is_superuser = True
            if email:
                existing.email = email
            existing.save()
            self.stdout.write(
                self.style.SUCCESS(f"Reset the password for {username!r}.")
            )
            self.stdout.write(
                "DJANGO_SUPERUSER_FORCE_RESET is still set. Unset it, or the "
                "password is reset again on the next deploy."
            )
            return

        users.objects.create_superuser(
            username=username, email=email or "", password=password
        )
        self.stdout.write(self.style.SUCCESS(f"Created admin account {username!r}."))


def _force_reset() -> bool:
    """Whether an existing account's password should be overwritten."""
    return os.environ.get("DJANGO_SUPERUSER_FORCE_RESET", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }
