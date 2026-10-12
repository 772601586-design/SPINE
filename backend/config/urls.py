from django.urls import include, path
from django.views.generic import TemplateView
from drf_spectacular.views import SpectacularJSONAPIView

from core.views import HealthView, ReadyView
from core.auth_views import LoginView, LogoutView, MeView
from braces.views import BraceViewSet, ComfortViewSet, ComfortFollowUpViewSet, WearViewSet
from rest_framework.routers import DefaultRouter

router = DefaultRouter()
router.register("braces", BraceViewSet, basename="brace")
router.register("wear-sessions", WearViewSet, basename="wear")
router.register("comfort-entries", ComfortViewSet, basename="comfort")
router.register("comfort-follow-ups", ComfortFollowUpViewSet, basename="comfort-follow-up")

urlpatterns = [
    path("api/v1/auth/login/", LoginView.as_view(), name="login"),
    path("api/v1/auth/logout/", LogoutView.as_view(), name="logout"),
    path("api/v1/auth/me/", MeView.as_view(), name="me"),
    path("api/v1/", include(router.urls)),
    path("api/v1/health/", HealthView.as_view(), name="health"),
    path("api/v1/ready/", ReadyView.as_view(), name="ready"),
    path("api/schema/", SpectacularJSONAPIView.as_view(), name="schema"),
    path("api/docs/", TemplateView.as_view(template_name="core/docs.html"), name="docs"),
]
