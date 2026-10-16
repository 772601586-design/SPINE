from django.contrib import admin
from django.urls import include, path
from django.views.generic import TemplateView
from drf_spectacular.views import SpectacularJSONAPIView
from rest_framework.routers import DefaultRouter

from braces.views import BraceViewSet, ComfortViewSet, ComfortFollowUpViewSet, WearViewSet
from core.attachment_views import (
    AttachmentAccessView,
    AttachmentCompleteView,
    AttachmentContentView,
    AttachmentDetailView,
    UploadIntentView,
)
from core.auth_views import LoginView, LogoutView, MeView, WechatLoginView
from core.views import HealthView, ReadyView
from medical.views import CurveMeasurementViewSet, VisitViewSet
from profiles.views import BodyMeasurementViewSet, CompleteProfileView, MeIdentityView, MyProfileView
from exercises.views import ExerciseTaxonomyView, ExerciseViewSet
from training.views import PersonalActionCardViewSet, TrainingAttemptViewSet, TrainingPlanView, TodayDeckView
from life.views import ArticleViewSet, PostViewSet, PreferencesView, RecordViewSet, RewardView, SummaryView
from life.prescriptions import PrescriptionView
from life.ocr import OCRView

router = DefaultRouter()
router.register("life/records", RecordViewSet, basename="life-record")
router.register("life/articles", ArticleViewSet, basename="life-article")
router.register("life/posts", PostViewSet, basename="life-post")
router.register("braces", BraceViewSet, basename="brace")
router.register("wear-sessions", WearViewSet, basename="wear")
router.register("comfort-entries", ComfortViewSet, basename="comfort")
router.register("comfort-follow-ups", ComfortFollowUpViewSet, basename="comfort-follow-up")
router.register("body-measurements", BodyMeasurementViewSet, basename="body-measurement")
router.register("visits", VisitViewSet, basename="visit")
router.register("curve-measurements", CurveMeasurementViewSet, basename="curve-measurement")
router.register("exercises", ExerciseViewSet, basename="exercise")
router.register("training/cards", PersonalActionCardViewSet, basename="training-card")
router.register("training/attempts", TrainingAttemptViewSet, basename="training-attempt")

urlpatterns = [
    path("api/v1/life/ocr/", OCRView.as_view()),
    path("api/v1/life/prescriptions/", PrescriptionView.as_view()),
    path("api/v1/life/preferences/", PreferencesView.as_view()),
    path("api/v1/life/rewards/", RewardView.as_view()),
    path("api/v1/life/summary/", SummaryView.as_view()),
    # 内容运营后台（规格 §2.1）。只有 Django 超级用户能登入；微信用户没有可用
    # 密码，天然无法从后台登录。哪些模型可以注册见 core/admin.py。
    path("admin/", admin.site.urls),
    path("api/v1/auth/login/", LoginView.as_view(), name="login"),
    path("api/v1/auth/wechat/", WechatLoginView.as_view(), name="wechat-login"),
    path("api/v1/auth/logout/", LogoutView.as_view(), name="logout"),
    path("api/v1/auth/me/", MeView.as_view(), name="me"),
    # 规格 §14 的 /me 与 /me/profile。旧的 /auth/me/ 保留，避免打断已上线的客户端。
    path("api/v1/me/", MeIdentityView.as_view(), name="me-identity"),
    path("api/v1/me/profile/", MyProfileView.as_view(), name="me-profile"),
    path("api/v1/me/profile/complete/", CompleteProfileView.as_view(), name="me-profile-complete"),
    path("api/v1/attachments/upload-intent/", UploadIntentView.as_view(), name="attachment-upload-intent"),
    path("api/v1/attachments/<uuid:attachment_id>/content/", AttachmentContentView.as_view(),
         name="attachment-content"),
    path("api/v1/attachments/<uuid:attachment_id>/complete/", AttachmentCompleteView.as_view(),
         name="attachment-complete"),
    path("api/v1/attachments/<uuid:attachment_id>/access/", AttachmentAccessView.as_view(),
         name="attachment-access"),
    path("api/v1/attachments/<uuid:attachment_id>/", AttachmentDetailView.as_view(),
         name="attachment-detail"),
    path("api/v1/", include(router.urls)),
    path("api/v1/exercise-taxonomy/", ExerciseTaxonomyView.as_view(), name="exercise-taxonomy"),
    path("api/v1/training/plan/", TrainingPlanView.as_view(), name="training-plan"),
    path("api/v1/training/today/", TodayDeckView.as_view(), name="training-today"),
    path("api/v1/health/", HealthView.as_view(), name="health"),
    path("api/v1/ready/", ReadyView.as_view(), name="ready"),
    path("api/schema/", SpectacularJSONAPIView.as_view(), name="schema"),
    path("api/docs/", TemplateView.as_view(template_name="core/docs.html"), name="docs"),
]
