from django.urls import path
from rest_framework.routers import SimpleRouter

from clips import views

# SimpleRouter rather than DefaultRouter, because the browsable API root view
# DefaultRouter adds is of no use to a PWA and only adds a URL to maintain.
router = SimpleRouter()
router.register("clips", views.SignClipViewSet, basename="clip")

urlpatterns = [
    path("sign-sequence/", views.sign_sequence, name="sign-sequence"),
    *router.urls,
]
