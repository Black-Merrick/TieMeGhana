from django.urls import path

from core import views

urlpatterns = [
    path("health/", views.health, name="health"),
    # Deliberately separate from health/, which reads the database. See the
    # view's docstring: pinging health every five minutes would keep the
    # Postgres compute awake as well as the web service.
    path("ping/", views.ping, name="ping"),
]
