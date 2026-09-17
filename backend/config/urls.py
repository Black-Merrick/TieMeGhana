"""Root URL configuration. Feature apps mount their own routers under /api/."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

# Otherwise the admin says "Django administration" everywhere, including the
# login page, which is what a GhSL consultant or a hospital's IT lead sees
# first. site_header is the text beside the logo on every admin page (see
# templates/admin/base_site.html); site_title feeds the browser tab, and is
# read directly by the bulk upload and reject templates too; index_title
# replaces "Site administration" as the heading on /admin/ itself.
admin.site.site_header = "Tie Me Ghana"
admin.site.site_title = "Tie Me Ghana admin"
admin.site.index_title = "Clip review and prescriptions"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("core.urls")),
    path("api/", include("clips.urls")),
    path("api/", include("consultations.urls")),
    path("api/", include("prescriptions.urls")),
]

# GhSL clips are served by Django only in development. In deployment they are
# served by nginx or object storage, see docker-compose.full.yml.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
