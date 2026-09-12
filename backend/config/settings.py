"""
Django settings for Tie Me Ghana.

Configuration is environment driven so the same image runs in local dev, CI,
and deployment without code changes. Defaults are chosen to make a fresh
clone work immediately (SQLite, debug on), and every one of them is overridden
by an environment variable in anything other than local development.
"""

import os
from pathlib import Path
from urllib.parse import urlparse

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


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-insecure-key-change-me")
DEBUG = env_bool("DJANGO_DEBUG", default=True)
ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

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
        "DIRS": [],
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
        "USER": parsed.username or "",
        "PASSWORD": parsed.password or "",
        "HOST": parsed.hostname or "",
        "PORT": str(parsed.port or ""),
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
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": _staticfiles_backend},
}

# Leading slash matters. Clip URLs are built from this, and a relative value
# would resolve against whatever path the app happens to be on.
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# Where filmed GhSL footage is dropped before being imported. Configurable
# because in a deployment it is likely a mounted volume rather than a folder
# beside the code.
FOOTAGE_DIR = Path(os.environ.get("FOOTAGE_DIR", BASE_DIR / "footage"))

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
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
    """Read a comma separated list of origins from the environment."""
    return [
        origin.strip()
        for origin in os.environ.get(name, default).split(",")
        if origin.strip()
    ]


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
