from django.urls import path

from pairing import views

urlpatterns = [
    path("pairing/", views.create_pairing, name="pairing-create"),
    path("pairing/resume/", views.resume_pairing, name="pairing-resume"),
    path("pairing/<str:code>/offer/", views.offer, name="pairing-offer"),
    path("pairing/<str:code>/answer/", views.answer, name="pairing-answer"),
    path("pairing/<str:code>/close/", views.close_pairing, name="pairing-close"),
    path("pairing/<str:code>/", views.end_pairing, name="pairing-end"),
]
