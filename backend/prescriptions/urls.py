from django.urls import path

from prescriptions import views

urlpatterns = [
    path("prescriptions/", views.issue, name="prescription-issue"),
    # The reference is url safe base64, so it can contain hyphens and
    # underscores as well as letters and digits. A bare <str:> would also match
    # a slash and swallow a deeper path.
    path(
        "prescriptions/<str:reference>/",
        views.playlist,
        name="prescription-playlist",
    ),
]
