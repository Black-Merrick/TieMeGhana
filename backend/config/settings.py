"""
Django settings for Tie Me Ghana.

Configuration is environment driven so the same image runs in local dev, CI,
and deployment without code changes. Defaults are chosen to make a fresh
clone work immediately (SQLite, debug on), and every one of them is overridden
by an environment variable in anything other than local development.
"""

import os
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """
    Read KEY=VALUE lines from a .env file into os.environ.

    Written by hand rather than pulled in as a dependency because this is the
    only thing we need from a settings library, and real environment variables
    must always win over the file so container and CI config is not shadowed.
    """
    if not path.exists():
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv(BASE_DIR / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    """Read a boolean from the environment, accepting 1/true/yes in any case."""
    return os.environ.get(name, str(int(default))).strip().lower() in {
        "1",
        "true",
        "yes",
    }


def env_int(name: str, default: int) -> int:
    """
    Read a whole number from the environment, falling back when unusable.

    Blank and malformed both fall back, rather than one raising and the other
    becoming something surprising. A platform that sets an empty value is
    common, and taking the default there is what the caller meant. A typo is
    reported, because silently substituting a default for `DJANGO_CONN_MAX_AGE`
    of "60O" would look like the setting had been applied.
    """
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default

    try:
        return int(raw)
    except ValueError:
        import warnings

        warnings.warn(
            f"{name}={raw!r} is not a whole number, using {default}.",
            stacklevel=2,
        )
        return default


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-insecure-key-change-me")
DEBUG = env_bool("DJANGO_DEBUG", default=True)
ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

# Render names the service's own hostname in the environment, and it is not
# known until the first deploy. Added automatically because forgetting it fails
# in a way that reads like a crash rather than a setting: every request returns
# DisallowedHost, including the platform's own health check, so the deploy is
# marked failed and rolled back before anyone sees a log line explaining it.
_render_host = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "").strip()
if _render_host and _render_host not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(_render_host)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "core",
    "clips",
    "consultations",
    "prescriptions",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    # WhiteNoise serves static files in deployment. In development the
    # staticfiles app already does it, and adding WhiteNoise there only warns
    # about the collectstatic output directory not existing yet.
    *([] if DEBUG else ["whitenoise.middleware.WhiteNoiseMiddleware"]),
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        # Searched before every app's own templates, which is what lets
        # templates/admin/base_site.html below override Django's own template
        # of the same name regardless of INSTALLED_APPS order. Relying on app
        # order for that would work today only because "django.contrib.admin"
        # happens to be listed first, and would silently stop working the
        # moment it was not.
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


def _database_config() -> dict:
    """
    Build the database config from DATABASE_URL, falling back to SQLite.

    The fallback exists so a teammate can clone the repo and run the test suite
    without first standing up PostgreSQL, which matters when onboarding under
    hackathon time pressure.

    The query string is carried through to the driver as connection options,
    which is the part that is easy to drop. Hosted Postgres puts `sslmode` there
    rather than in the host: Neon's own connection string ends
    `?sslmode=require&channel_binding=require`. Discarding it does not fail, and
    that is exactly the problem. libpq falls back to its default `sslmode` of
    `prefer`, which uses TLS when the server offers it and plaintext when it
    does not, so the connection looks fine while no longer *requiring*
    encryption. This database carries prescriptions, and a silent downgrade to
    plaintext is not something we can leave to a default.

    Connections are reused between requests, which is the single largest thing
    affecting how fast this app reads. Measured against the deployed Neon
    database: opening a connection took **1,919ms**, while a query on an
    already open one took **240ms**, and the queries themselves execute in
    0.02 to 0.5ms. Django's default `CONN_MAX_AGE` of 0 closes the connection
    at the end of every request, so each one paid that setup again before it
    could read anything. Nothing else in the read path is within two orders of
    magnitude of that cost, indexes very much included.

    `CONN_HEALTH_CHECKS` is not optional alongside it. A serverless database
    suspends its compute when idle and drops the connections with it, so a held
    connection is routinely dead by the next request. Without the check Django
    hands that dead connection to a view and the request fails; with it, Django
    notices and reconnects. The cost is one trivial round trip per request,
    which is what makes reuse safe rather than a source of intermittent 500s
    nobody can reproduce.

    Not a client side connection pool, which Django 5.1 can do via
    `OPTIONS["pool"]`. Gunicorn runs synchronous workers here, so each worker
    serves one request at a time and can never use more than one connection at
    once: a pool per worker would hold idle connections open for no gain.
    Neon also pools on its own side already, which is what the `-pooler` host
    in the connection string is.
    """
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        return {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    parsed = urlparse(url)
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": parsed.path.lstrip("/"),
        # Percent-decoded, because a generated password may contain characters
        # that have to be escaped in a URL. Handing the escaped form to the
        # driver is an authentication failure that reads like a wrong password.
        "USER": unquote(parsed.username or ""),
        "PASSWORD": unquote(parsed.password or ""),
        "HOST": parsed.hostname or "",
        "PORT": str(parsed.port or ""),
        "OPTIONS": dict(parse_qsl(parsed.query)),
        # Seconds to keep a connection open for reuse. Ten minutes by default,
        # which spans a whole consultation: the first request pays to connect
        # and every later one in the exchange is spared it.
        "CONN_MAX_AGE": env_int("DJANGO_CONN_MAX_AGE", 600),
        "CONN_HEALTH_CHECKS": True,
    }


DATABASES = {"default": _database_config()}

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"
    },
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Africa/Accra"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Hashed, compressed static files in deployment only. The manifest backend
# requires collectstatic to have run, so applying it in development would make
# a fresh clone fail on a step nobody should need before `runserver`.
_staticfiles_backend = (
    "django.contrib.staticfiles.storage.StaticFilesStorage"
    if DEBUG
    else "whitenoise.storage.CompressedManifestStaticFilesStorage"
)
# Where uploaded and generated media lives: GhSL clips, medicine photographs,
# and the stitched videos built from them.
#
# Local disk by default, so a fresh clone needs no cloud account to run. Object
# storage when R2 is configured, and on a deployment that is not optional: a
# container's filesystem is replaced on every restart and deploy, so a
# prescription issued on Monday would have lost its photographs by Tuesday and
# the QR code would resolve to broken images.
#
# Cloudflare R2 is S3 compatible, so this is the ordinary S3 backend pointed at
# an R2 endpoint. It is the one chosen because it charges nothing for egress,
# and this application serves video.
_R2_BUCKET = os.environ.get("R2_BUCKET", "").strip()
_R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "").strip()

if _R2_BUCKET and _R2_ACCOUNT_ID:
    _media_storage = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": _R2_BUCKET,
            "endpoint_url": f"https://{_R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
            "access_key": os.environ.get("R2_ACCESS_KEY_ID", ""),
            "secret_key": os.environ.get("R2_SECRET_ACCESS_KEY", ""),
            # R2 has one region and rejects the usual names.
            "region_name": "auto",
            # The public base URL for reading, which is a different host from
            # the endpoint used for writing: the endpoint is authenticated and
            # the public URL is not. Either the bucket's r2.dev address or a
            # custom domain attached to it.
            "custom_domain": os.environ.get("R2_PUBLIC_HOST", "").strip() or None,
            # URLs are public and permanent rather than signed and expiring. A
            # prescription QR code is scanned weeks later, and a link that
            # expires would turn into a broken page at exactly the moment the
            # patient needs it.
            "querystring_auth": False,
            # A clip never changes once reviewed: a corrected sign is published
            # under a new filename, per the footage README.
            "object_parameters": {"CacheControl": "public, max-age=2592000"},
            # Two files with the same name are the same file here, because the
            # stitching cache is addressed by content. Overwriting keeps that
            # true rather than accumulating name_a1b2c3 duplicates.
            "file_overwrite": True,
        },
    }
else:
    _media_storage = {"BACKEND": "django.core.files.storage.FileSystemStorage"}

STORAGES = {
    "default": _media_storage,
    "staticfiles": {"BACKEND": _staticfiles_backend},
}

# Leading slash matters. Clip URLs are built from this, and a relative value
# would resolve against whatever path the app happens to be on.
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# Where filmed GhSL footage is dropped before being imported. Configurable
# because in a deployment it is likely a mounted volume rather than a folder
# beside the code.
# Where `import_clips` looks for footage to bring in.
#
# A blank value falls back rather than being used, because `Path("")` is
# `Path(".")`: the import would quietly scan the backend directory instead of
# the footage one, find nothing, and report success.
FOOTAGE_DIR = Path(os.environ.get("FOOTAGE_DIR", "").strip() or BASE_DIR / "footage")

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
    # No session authentication. The patient facing API has no user accounts
    # and never reads request.user, so session authentication buys nothing and
    # costs a confusing failure: a doctor who approves clips in the admin
    # leaves a session cookie in the same browser, DRF then treats every API
    # call as authenticated and enforces CSRF on it, and the consultation
    # screen starts failing with 403 while telling the doctor the language
    # service is unreachable.
    #
    # The Django admin is unaffected. It is not DRF, and its own forms remain
    # CSRF protected, which is where CSRF actually matters because those
    # requests change state as an authenticated user. These endpoints do not.
    #
    # If the API ever does authenticate a user, this comes back and the
    # frontend has to send X-CSRFToken with it.
    "DEFAULT_AUTHENTICATION_CLASSES": [],
}

# The PWA is served from a separate origin in development, so the Vite dev
# server needs explicit permission to call the API.
#
# 5174 is included because Vite moves to the next free port when 5173 is taken,
# which happens routinely on a machine running more than one project.
_DEV_ORIGINS = (
    "http://localhost:5173,http://127.0.0.1:5173,"
    "http://localhost:5174,http://127.0.0.1:5174"
)


def env_origins(name: str, default: str) -> list[str]:
    """
    Read a comma separated list of origins from the environment.

    A variable that is present but empty is treated as absent. `.env` files and
    deployment dashboards are both full of keys with nothing after the `=`,
    written by someone who meant "leave this alone", and without this line that
    reads as "allow no origins at all": every request from the frontend is
    refused as cross site, with nothing in the logs naming the setting that did
    it.
    """
    configured = os.environ.get(name, "").strip() or default

    return [origin.strip() for origin in configured.split(",") if origin.strip()]


CORS_ALLOWED_ORIGINS = env_origins("CORS_ALLOWED_ORIGINS", _DEV_ORIGINS)

# Origins allowed to POST a form, which the Django admin does.
#
# Needed because the dev server proxies /admin: the browser's Origin header is
# the Vite port while Django sees its own host, and Django rejects the
# mismatch as a cross site request. Without this, approving a clip in the admin
# fails with a 403 and a CSRF message that says nothing about proxying.
#
# In deployment nginx forwards the real Host, so the two agree, but the setting
# is still required for any origin that differs from the host Django sees.
CSRF_TRUSTED_ORIGINS = env_origins(
    "CSRF_TRUSTED_ORIGINS", ",".join(CORS_ALLOWED_ORIGINS)
)

# GhanaNLP Khaya AI credentials. Absent in CI and on fresh clones, which is
# why every language operation goes through a provider interface that has a
# deterministic stub implementation.
KHAYA_API_KEY = os.environ.get("KHAYA_API_KEY", "")

# Which language provider to use: auto, stub, or khaya.
#
# The project runs on Khaya's free tier, where every translation, transcription,
# and synthesis call spends metered credit. `auto` would burn that credit on
# ordinary development the moment a key is present, so day to day work sets
# this to `stub` and only switches to `khaya` for a deliberate verification
# run. See ADR 015.
LANGUAGE_PROVIDER = os.environ.get("LANGUAGE_PROVIDER", "auto").strip().lower()

# Our own app loggers reach the console. Django configures logging for its own
# loggers only, so without this a warning we deliberately recorded, such as the
# reason a language call failed, would be written nowhere and the failure would
# have to be rediscovered by spending metered credit on it again.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "{levelname} {name}: {message}", "style": "{"}},
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "plain"},
    },
    # propagate stays on. Records reach the root logger as well as our console
    # handler, which is what lets a test or an aggregator observe them. The
    # root logger has no handler of its own, so nothing is logged twice.
    "loggers": {
        app: {"handlers": ["console"], "level": "INFO", "propagate": True}
        for app in ("core", "clips", "consultations")
    },
}

# Transport security, applied outside development only. Gated on an explicit
# variable rather than on DEBUG alone, because a hackathon demo may legitimately
# run over plain http on a local network, where forcing an HTTPS redirect would
# make the app unreachable at the worst possible moment.
if not DEBUG:
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = "DENY"
    # Django sits behind nginx in the containerized stack, so the scheme has to
    # come from the proxy header rather than from the connection Django sees.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

    if env_bool("DJANGO_SECURE_SSL", default=False):
        SECURE_SSL_REDIRECT = True
        SESSION_COOKIE_SECURE = True
        CSRF_COOKIE_SECURE = True
        SECURE_HSTS_SECONDS = 31536000
        SECURE_HSTS_INCLUDE_SUBDOMAINS = True
        SECURE_HSTS_PRELOAD = True
