import pytest
from django.urls import reverse


@pytest.mark.django_db
def test_health_reports_ok_when_database_is_reachable(api_client):
    """
    The health endpoint is what tells us during a demo whether a failure is in
    the API layer or the database, so it has to actually touch the database
    rather than returning a hardcoded 200.
    """
    response = api_client.get(reverse("health"))

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"


class TestTheKeepAlivePing:
    """
    The endpoint the keep-alive scheduler calls every five minutes.

    Its whole reason for existing apart from `health/` is that it must not
    reach the database. Health does, and scheduling that around the clock would
    hold the Postgres compute awake with it, spending a free allowance sized
    for real usage on the monitor alone.
    """

    @pytest.mark.django_db
    def test_it_answers_without_touching_the_database(
        self, api_client, django_assert_num_queries
    ):
        # The assertion that keeps this endpoint honest. Adding anything here
        # that reads a row, however small, quietly turns a web service
        # keep-alive into a database keep-alive as well.
        with django_assert_num_queries(0):
            response = api_client.get(reverse("ping"))

        assert response.status_code == 200
        assert response.json() == {"status": "awake"}

    def test_it_answers_with_no_database_configured_at_all(self, client):
        # No django_db mark, so touching the database would fail the test
        # outright. A liveness probe that needs its dependencies up is a health
        # check, and there is already one of those.
        assert client.get(reverse("ping")).status_code == 200

    @pytest.mark.django_db
    def test_it_refuses_anything_but_a_get(self, api_client):
        # Refused, but not always with the same code, and asserting one of them
        # would be asserting the test client rather than the endpoint. Over
        # real HTTP the CSRF middleware rejects an unsafe method with 403
        # before `require_GET` is reached; the test client is CSRF exempt, so
        # it gets the 405 from the decorator. Either way nothing is accepted.
        assert api_client.post(reverse("ping")).status_code in (403, 405)


@pytest.mark.django_db
def test_health_reports_degraded_when_database_is_unreachable(api_client, monkeypatch):
    """A green health check with a dead database would be worse than no check."""
    from django.db import DatabaseError, connection

    def fail(*args, **kwargs):
        raise DatabaseError("simulated outage")

    monkeypatch.setattr(connection, "ensure_connection", fail)

    response = api_client.get(reverse("health"))

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"


@pytest.mark.django_db
class TestHealthReportsPendingMigrations:
    """
    A migration written but not applied is the failure this catches.

    It has cost the same lost hour three times: the endpoint that touches the
    new column returns a 500 about a column nobody has heard of, `runserver`
    printed its warning before the migration existed and does not repeat it on
    reload, and the test suite stays green throughout because pytest builds its
    database from scratch every run.
    """

    def test_a_migrated_database_reports_ok(self, api_client):
        # pytest applies every migration when it builds the test database, so
        # this is the state the suite always runs in.
        assert api_client.get(reverse("health")).json()["migrations"] == "ok"

    def test_an_unapplied_migration_is_reported(self, api_client, monkeypatch):
        from core import views

        monkeypatch.setattr(
            views, "_pending_migrations", lambda: ["prescriptions.0002_something"]
        )

        body = api_client.get(reverse("health")).json()

        assert body["migrations"] == "pending"
        assert body["pending_migrations"] == ["prescriptions.0002_something"]

    def test_a_stale_schema_is_not_reported_as_being_offline(
        self, api_client, monkeypatch
    ):
        # Deliberately still 200. The API and the database are both up, and a
        # 503 would make the interface tell the patient it is offline, sending
        # whoever is debugging to look at the network instead of the schema.
        from core import views

        monkeypatch.setattr(views, "_pending_migrations", lambda: ["clips.0007"])

        response = api_client.get(reverse("health"))

        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_an_unreadable_migration_table_is_not_reported_as_ok(
        self, api_client, monkeypatch
    ):
        # Saying "ok" here would be a guess, and the whole value of this
        # endpoint is that it does not guess.
        from django.db import DatabaseError

        from core import views

        def fail():
            raise DatabaseError("cannot read django_migrations")

        monkeypatch.setattr(views, "_pending_migrations", fail)

        assert api_client.get(reverse("health")).json()["migrations"] == "unknown"


class TestProxiedAdminOrigins:
    """
    The dev server proxies /admin, so the browser's Origin is the Vite port
    while Django sees its own host. Django treats that mismatch as a cross site
    request and rejects the POST, which surfaced as a 403 when approving a clip
    with a CSRF message that says nothing about proxying.
    """

    def test_the_dev_origins_may_post_a_form(self, settings):
        for origin in settings.CORS_ALLOWED_ORIGINS:
            assert origin in settings.CSRF_TRUSTED_ORIGINS, origin

    def test_vites_fallback_port_is_included(self, settings):
        # Vite moves to the next free port when 5173 is taken, which happens
        # routinely on a machine running more than one project, and the admin
        # then breaks for a reason nobody would connect to the port number.
        assert any("5174" in origin for origin in settings.CSRF_TRUSTED_ORIGINS)

    def test_origins_are_full_urls_with_a_scheme(self, settings):
        # Django requires the scheme here. A bare host is silently ignored,
        # so the setting would look configured and do nothing.
        for origin in settings.CSRF_TRUSTED_ORIGINS:
            assert origin.startswith(("http://", "https://")), origin


@pytest.mark.django_db
class TestApiIsStateless:
    """
    The API must not care whether a browser is also logged into the admin.

    A doctor approving clips in the admin leaves a session cookie in the same
    browser. With session authentication enabled, DRF then treats every API
    call as an authenticated request and enforces CSRF on it, so the
    consultation screen starts failing with 403 and the message on screen says
    the language service is unreachable, which is not what happened.

    Reproduced with `enforce_csrf_checks`, because the default test client
    skips the check and the failure only appears in a real browser.
    """

    def test_a_post_works_while_logged_into_the_admin(self, django_user_model):
        from rest_framework.test import APIClient

        django_user_model.objects.create_superuser(
            username="reviewer", email="r@example.com", password="pw"
        )
        client = APIClient(enforce_csrf_checks=True)
        client.login(username="reviewer", password="pw")

        response = client.post(
            reverse("caption"),
            {"source_language": "en", "text": "appear"},
            format="json",
        )

        assert response.status_code == 200

    def test_a_post_works_for_a_browser_with_no_session(self):
        from rest_framework.test import APIClient

        client = APIClient(enforce_csrf_checks=True)

        response = client.post(
            reverse("caption"),
            {"source_language": "en", "text": "appear"},
            format="json",
        )

        assert response.status_code == 200

    def test_the_api_does_not_authenticate_by_session(self, settings):
        # The patient facing API has no user accounts and reads nothing from
        # request.user, so session authentication buys nothing and costs the
        # failure above. The Django admin is unaffected: it is not DRF, and its
        # own forms are still CSRF protected.
        assert settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"] == []


class TestMediaStorageIsConfigurable:
    """
    Media goes to local disk in development and to a bucket in deployment.

    The default matters as much as the option. A fresh clone must run without a
    cloud account, and a deployment must not write to a container filesystem
    that is replaced on the next restart: a prescription issued on Monday would
    have lost its photographs by Tuesday, and the QR code the patient took home
    would resolve to broken images.
    """

    def test_local_development_writes_to_disk(self, settings):
        # No R2 variables, so nothing about running the app depends on an
        # account with anybody.
        assert (
            settings.STORAGES["default"]["BACKEND"]
            == "django.core.files.storage.FileSystemStorage"
        )

    def test_r2_is_used_when_it_is_configured(self, monkeypatch):
        monkeypatch.setenv("R2_BUCKET", "tiemeghana-media")
        monkeypatch.setenv("R2_ACCOUNT_ID", "abc123")
        monkeypatch.setenv("R2_ACCESS_KEY_ID", "key")
        monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret")
        monkeypatch.setenv("R2_PUBLIC_HOST", "pub-abc123.r2.dev")

        settings = _reloaded_settings()
        storage = settings.STORAGES["default"]

        assert storage["BACKEND"] == "storages.backends.s3.S3Storage"
        assert (
            storage["OPTIONS"]["endpoint_url"]
            == "https://abc123.r2.cloudflarestorage.com"
        )
        assert storage["OPTIONS"]["custom_domain"] == "pub-abc123.r2.dev"

    def test_media_urls_are_public_and_do_not_expire(self, monkeypatch):
        # A prescription QR code is scanned weeks later. A signed URL that
        # expires would turn into a broken page at exactly the moment the
        # patient needs it.
        monkeypatch.setenv("R2_BUCKET", "tiemeghana-media")
        monkeypatch.setenv("R2_ACCOUNT_ID", "abc123")

        options = _reloaded_settings().STORAGES["default"]["OPTIONS"]

        assert options["querystring_auth"] is False

    def test_half_configured_r2_falls_back_rather_than_failing(self, monkeypatch):
        # A bucket name with no account id is a half filled .env, which is a
        # normal thing to have mid setup. Falling back to disk keeps the app
        # running; failing to start would make it look broken.
        #
        # Blanked rather than deleted, because the loader uses setdefault and a
        # deleted variable is simply read back out of .env on the next import.
        # That is the behaviour we want from the loader, and it means a blank
        # value is the shape a half filled file actually has.
        monkeypatch.setenv("R2_BUCKET", "tiemeghana-media")
        monkeypatch.setenv("R2_ACCOUNT_ID", "")

        assert (
            _reloaded_settings().STORAGES["default"]["BACKEND"]
            == "django.core.files.storage.FileSystemStorage"
        )


def _reloaded_settings():
    """
    Re-import the settings module so environment changes are re-read.

    Django reads settings once at startup, so monkeypatching the environment
    afterwards changes nothing by itself. Importing the module fresh is what
    exercises the branch these tests are about.
    """
    import importlib

    from config import settings as settings_module

    return importlib.reload(settings_module)


@pytest.mark.django_db
class TestTheAdminAccountCanBeCreatedWithoutAShell:
    """
    The admin is how a GhSL consultant approves clips, and an unapproved clip
    never plays: `resolvable()` wants approval and footage both.

    `createsuperuser` wants a terminal, and the free tier this deploys to has
    no shell, so a deployment would otherwise have a clip library nobody can
    manage. The account is made from the environment on start instead.
    """

    def _run(self, monkeypatch, **env):
        from io import StringIO

        from django.core.management import call_command

        for key, value in env.items():
            monkeypatch.setenv(key, value)

        out, err = StringIO(), StringIO()
        call_command("ensure_superuser", stdout=out, stderr=err)
        return out.getvalue() + err.getvalue()

    def test_it_creates_the_account_from_the_environment(
        self, monkeypatch, django_user_model
    ):
        self._run(
            monkeypatch,
            DJANGO_SUPERUSER_USERNAME="consultant",
            DJANGO_SUPERUSER_PASSWORD="a-long-enough-password-42",
            DJANGO_SUPERUSER_EMAIL="c@example.com",
        )

        user = django_user_model.objects.get(username="consultant")
        assert user.is_superuser and user.is_staff
        assert user.email == "c@example.com"

    def test_running_it_again_changes_nothing(self, monkeypatch, django_user_model):
        # It runs on every start, so the second deploy must be a no-op.
        env = {
            "DJANGO_SUPERUSER_USERNAME": "consultant",
            "DJANGO_SUPERUSER_PASSWORD": "a-long-enough-password-42",
        }
        self._run(monkeypatch, **env)
        first = django_user_model.objects.get(username="consultant").password

        output = self._run(monkeypatch, **env)

        assert "already exists" in output
        assert django_user_model.objects.get(username="consultant").password == first

    def test_it_does_not_silently_reset_a_password(
        self, monkeypatch, django_user_model
    ):
        # A password changed in the admin must survive a redeploy. One that
        # changes without anyone asking is worse than one that has to be reset
        # on purpose.
        self._run(
            monkeypatch,
            DJANGO_SUPERUSER_USERNAME="consultant",
            DJANGO_SUPERUSER_PASSWORD="a-long-enough-password-42",
        )
        user = django_user_model.objects.get(username="consultant")
        user.set_password("changed-in-the-admin-99")
        user.save()

        self._run(
            monkeypatch,
            DJANGO_SUPERUSER_USERNAME="consultant",
            DJANGO_SUPERUSER_PASSWORD="a-long-enough-password-42",
        )

        user.refresh_from_db()
        assert user.check_password("changed-in-the-admin-99")

    def test_a_forced_reset_is_the_recovery_route(self, monkeypatch, django_user_model):
        # The only way back in on a platform with no shell.
        self._run(
            monkeypatch,
            DJANGO_SUPERUSER_USERNAME="consultant",
            DJANGO_SUPERUSER_PASSWORD="a-long-enough-password-42",
        )

        self._run(
            monkeypatch,
            DJANGO_SUPERUSER_USERNAME="consultant",
            DJANGO_SUPERUSER_PASSWORD="a-different-long-password-77",
            DJANGO_SUPERUSER_FORCE_RESET="1",
        )

        user = django_user_model.objects.get(username="consultant")
        assert user.check_password("a-different-long-password-77")

    def test_a_weak_password_is_refused_rather_than_accepted(
        self, monkeypatch, django_user_model
    ):
        # What createsuperuser checks interactively and --noinput skips. The
        # admin is reachable from the internet, and a deployment is exactly
        # where a four character password would otherwise slip through.
        output = self._run(
            monkeypatch,
            DJANGO_SUPERUSER_USERNAME="consultant",
            DJANGO_SUPERUSER_PASSWORD="1234",
        )

        assert "refused" in output
        assert not django_user_model.objects.filter(username="consultant").exists()

    def test_a_refused_password_does_not_stop_the_service_starting(self, monkeypatch):
        # The consultation screen still works without an admin account, and
        # refusing to boot would take a working app down over a password.
        self._run(
            monkeypatch,
            DJANGO_SUPERUSER_USERNAME="consultant",
            DJANGO_SUPERUSER_PASSWORD="1234",
        )

    def test_it_does_nothing_when_it_is_not_configured(
        self, monkeypatch, django_user_model
    ):
        # The ordinary case on a laptop and in CI.
        monkeypatch.delenv("DJANGO_SUPERUSER_USERNAME", raising=False)
        monkeypatch.delenv("DJANGO_SUPERUSER_PASSWORD", raising=False)

        output = self._run(monkeypatch)

        assert "no admin account was created" in output
        assert not django_user_model.objects.exists()


class TestABlankVariableMeansUnset:
    """
    A variable present but empty is treated as absent.

    `.env` files and deployment dashboards are both full of keys with nothing
    after the `=`, written by someone who meant "leave this alone". Read
    literally, two of those settings fail silently and confusingly.
    """

    def test_blank_origins_fall_back_to_the_default(self, monkeypatch):
        # Read literally this is "allow no origins", so every request from the
        # frontend is refused as cross site with nothing naming the setting.
        monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "")

        settings = _reloaded_settings()

        assert settings.CORS_ALLOWED_ORIGINS
        assert "http://localhost:5173" in settings.CORS_ALLOWED_ORIGINS

    def test_configured_origins_still_win(self, monkeypatch):
        monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://example.netlify.app")

        assert _reloaded_settings().CORS_ALLOWED_ORIGINS == [
            "https://example.netlify.app"
        ]

    def test_blank_footage_dir_falls_back_to_the_footage_folder(self, monkeypatch):
        # Path("") is Path("."), so the import would scan the backend directory
        # instead, find nothing, and report success.
        monkeypatch.setenv("FOOTAGE_DIR", "")

        settings = _reloaded_settings()

        assert settings.FOOTAGE_DIR.name == "footage"

    def test_blank_database_url_falls_back_to_sqlite(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "")

        engine = _reloaded_settings().DATABASES["default"]["ENGINE"]

        assert engine.endswith("sqlite3")

    def test_sslmode_from_the_url_reaches_the_driver(self, monkeypatch):
        # Hosted Postgres asks for TLS in the query string rather than in the
        # host. Dropping it does not fail: libpq falls back to `prefer`, which
        # accepts plaintext if the server offers it, so a database holding
        # prescriptions quietly stops requiring encryption.
        monkeypatch.setenv(
            "DATABASE_URL",
            "postgresql://u:p@db.example.com/app?sslmode=require&channel_binding=require",
        )

        options = _reloaded_settings().DATABASES["default"]["OPTIONS"]

        assert options["sslmode"] == "require"
        assert options["channel_binding"] == "require"

    def test_a_url_escaped_password_is_decoded(self, monkeypatch):
        # A generated password may contain characters that have to be escaped
        # in a URL. Handing the escaped form to the driver authenticates with
        # the wrong password, which reads like a bad credential rather than a
        # parsing bug.
        monkeypatch.setenv(
            "DATABASE_URL", "postgresql://user:p%40ss%2Fword@db.example.com/app"
        )

        config = _reloaded_settings().DATABASES["default"]

        assert config["PASSWORD"] == "p@ss/word"

    def test_a_url_without_a_query_string_gets_no_options(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db.example.com/app")

        assert _reloaded_settings().DATABASES["default"]["OPTIONS"] == {}
