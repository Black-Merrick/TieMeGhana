"""
The admin says whose it is, on every page, including the one nobody is
logged in yet to see.

Written after shipping a login page that read "Django administration" for
days, and then, while fixing that, after shipping a broken one. The second
failure is the one worth guarding against directly: a multi-line `{# ... #}`
comment in templates/admin/base_site.html silently stopped being a comment
partway through, because Django's `{# #}` syntax cannot span more than one
line. What followed was `{% extends "admin/base_site.html" %}` written out
as plain prose inside that comment, and Django tokenized it as a second,
real, illegal extends tag on the very login page the whole change was meant
to improve. It rendered as a 500 with nothing about the failure suggesting a
comment was the cause.

These tests render the actual pages rather than only checking the strings
are configured, because the bug was never in the strings: site_header was
set correctly the entire time. It was in a template that happened not to
compile.
"""

import re
from pathlib import Path

import pytest
from django.contrib import admin
from django.urls import reverse

TEMPLATES_ROOT = Path(__file__).resolve().parent.parent


class TestTheLoginPageRenders:
    """
    The page a GhSL consultant or a hospital's IT lead sees first, before
    anything about who they are is known. It must render for absolutely
    everyone, which is exactly why an admin_client fixture, which is already
    logged in, would not have caught the bug this guards against.
    """

    def test_it_returns_200_not_a_template_error(self, client):
        response = client.get(reverse("admin:login"))

        assert response.status_code == 200

    def test_it_is_branded_rather_than_saying_django_administration(self, client):
        response = client.get(reverse("admin:login"))

        assert b"Tie Me Ghana" in response.content
        assert b"Django administration" not in response.content

    def test_the_browser_tab_title_is_branded(self, client):
        response = client.get(reverse("admin:login"))

        assert b"<title>Log in | Tie Me Ghana admin</title>" in response.content

    def test_the_logo_is_referenced_and_the_file_exists(self, client):
        response = client.get(reverse("admin:login"))

        assert b"core/icon.png" in response.content
        assert (TEMPLATES_ROOT / "core" / "static" / "core" / "icon.png").is_file()

    def test_the_theme_toggle_survives_the_branding_override(self, client):
        # admin/base_site.html's default branding block includes this for an
        # anonymous user; overriding the block wholesale is exactly the kind
        # of change that quietly drops it.
        response = client.get(reverse("admin:login"))

        assert b"theme-toggle" in response.content


@pytest.mark.django_db
class TestTheRestOfTheAdminRenders:
    @pytest.fixture
    def admin_client(self, django_user_model, client):
        django_user_model.objects.create_superuser(
            username="reviewer", email="r@example.com", password="pw"
        )
        client.login(username="reviewer", password="pw")
        return client

    def test_the_index_page_renders_and_is_branded(self, admin_client):
        response = admin_client.get(reverse("admin:index"))

        assert response.status_code == 200
        assert b"Tie Me Ghana" in response.content
        assert b"Clip review and prescriptions" in response.content

    def test_the_clip_changelist_renders_with_both_upload_buttons(self, admin_client):
        # The page the multi-line comment bug's sibling instance was hiding
        # in, clips/templates/admin/clips/signclip/change_list.html. Silent
        # there rather than fatal, because the leaked text fell outside any
        # {% block %}, which Django discards for a child template rather than
        # renders. Still wrong, and still worth a real render to catch.
        response = admin_client.get(reverse("admin:clips_signclip_changelist"))

        assert response.status_code == 200
        assert b"Bulk upload clips" in response.content
        assert b"Import footage folder" in response.content

    def test_the_bulk_upload_page_renders(self, admin_client):
        response = admin_client.get(reverse("admin:clips_signclip_bulk_upload"))

        assert response.status_code == 200


def test_site_header_site_title_index_title_are_all_set():
    # The plain configuration check, kept because it is cheap and it is what
    # a reader looking for "where is this configured" will search for. Not a
    # substitute for the render tests above: this alone was green the whole
    # time the login page was returning 500.
    assert admin.site.site_header == "Tie Me Ghana"
    assert admin.site.site_title == "Tie Me Ghana admin"
    assert admin.site.index_title == "Clip review and prescriptions"


class TestNoAdminTemplateHasAMultiLineDjangoComment:
    """
    The guard against the actual bug recurring, anywhere, including in a
    template nobody thought to write a render test for.

    `{# ... #}` cannot span a line break; Django documents this and the
    lexer enforces it by simply failing to recognise the comment at all,
    rather than raising where the comment starts. Nothing about the failure
    that follows, however far downstream it surfaces, points back at a
    comment, which is what makes this worth catching mechanically rather
    than by review. `{% comment %}...{% endcomment %}` is the tag that
    actually supports multiple lines and is what every multi-line
    explanation in these templates uses instead.
    """

    def test_every_admin_template_is_clean(self):
        offenders = []

        for path in TEMPLATES_ROOT.rglob("templates/admin/**/*.html"):
            text = path.read_text()
            for match in re.finditer(r"\{#", text):
                start = match.start()
                close = text.find("#}", start)
                if close == -1 or "\n" in text[start : close + 2]:
                    offenders.append(str(path.relative_to(TEMPLATES_ROOT)))

        assert offenders == [], (
            "These templates have a {# #} comment that spans more than one "
            "line, which Django does not support: "
            f"{offenders}. Use {{% comment %}}...{{% endcomment %}} instead."
        )


class TestAdminLoginTrustsTheDevProxyOrigin:
    """
    The dev server proxies /admin to Django, so the browser's Origin header is
    whichever port Vite is running on while Django sees its own. CSRF checks
    that the two agree unless the browser's origin is explicitly trusted, and
    Django's CSRF_TRUSTED_ORIGINS has no wildcard for a port, only for
    subdomains, so there is no pattern that covers "any dev port" on its own.

    Vite's default is 5173, and it silently increments to the next free one
    when that port is taken, which happens the moment two projects are running
    locally. A hardcoded pair of ports is exactly the kind of fix that looks
    complete and breaks again the next time that happens, with a CSRF message
    that never mentions a port mismatch at all.
    """

    def test_a_range_of_likely_dev_ports_is_trusted_not_just_5173(self):
        from django.conf import settings

        # 5183 is not the Vite default. It is what this project's dev server
        # actually ran on for an entire working session, because 5173 was
        # already taken by another project on the same machine, which is
        # precisely the situation this range exists to survive.
        assert "http://localhost:5183" in settings.CSRF_TRUSTED_ORIGINS
        assert "http://localhost:5183" in settings.CORS_ALLOWED_ORIGINS

    def test_the_range_is_wide_enough_to_matter(self):
        from django.conf import settings

        # Not asserting an exact count, which would make this the test that
        # breaks every time the range is retuned. Asserting the shape: enough
        # ports that a couple of concurrent Vite projects will not walk past
        # the end of it.
        dev_ports = {
            origin
            for origin in settings.CSRF_TRUSTED_ORIGINS
            if origin.startswith(("http://localhost:", "http://127.0.0.1:"))
        }
        assert len(dev_ports) >= 40

    def test_an_explicit_env_value_is_not_widened_by_the_dev_range(self, monkeypatch):
        # The generated range is a fallback for when nothing is configured,
        # used as env_origins()'s default argument. A deployment that sets
        # CORS_ALLOWED_ORIGINS or CSRF_TRUSTED_ORIGINS explicitly, which every
        # real deployment does, must get exactly what it asked for and nothing
        # the fallback would have added.
        from config.settings import _DEV_ORIGINS, env_origins

        monkeypatch.setenv("CSRF_TRUSTED_ORIGINS", "https://tiemeghana.netlify.app")

        result = env_origins("CSRF_TRUSTED_ORIGINS", _DEV_ORIGINS)

        assert result == ["https://tiemeghana.netlify.app"]
        assert "http://localhost:5183" not in result
