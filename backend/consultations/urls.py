from django.urls import path

from consultations import views

urlpatterns = [
    path("caption/", views.caption, name="caption"),
    path("speak/", views.speak, name="speak"),
]
