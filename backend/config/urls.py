"""Root URL configuration. Feature apps mount their own routers under /api/."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("core.urls")),
    path("api/", include("clips.urls")),
    path("api/", include("consultations.urls")),
]

# GhSL clips are served by Django only in development. In deployment they are
# served by nginx or object storage, see docker-compose.full.yml.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
