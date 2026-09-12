from rest_framework.routers import SimpleRouter

from questions import views

router = SimpleRouter()
router.register("questions", views.ClinicalQuestionViewSet, basename="question")

urlpatterns = router.urls
