"""档案与身体测量接口（规格 v2.0 §3、§14）。

- `GET/PATCH /me/profile`：用户的私密档案。没有档案时 GET 返回 404，客户端用
  `GET /me` 的 `has_profile` 决定是否进建档页。
- `PATCH /me`：规格 §14 同时列出了 `PATCH /me`。用户可写的资料只有档案字段，
  所以这里让它与 `PATCH /me/profile` 等价，而不是造一个语义不明的第二个写入口。
- `GET /me/profile` 额外返回派生的 `latest_measurement`，方便首页直接展示身高体重。
"""

from django.db import IntegrityError, transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from core.errors import ErrorCode, SpineError
from core.idempotency import check_expected_revision, claim, record_result
from core.pagination import StandardPagination
from medical.models import MedicalAttachment
from profiles.models import BodyMeasurement, Profile
from profiles.serializers import BodyMeasurementSerializer, ProfileSerializer, latest_measurement_payload


def profile_payload(request, profile):
    return {
        **ProfileSerializer(profile, context={"request": request}).data,
        "latest_measurement": latest_measurement_payload(request.user),
    }


def _profile_for(user):
    return Profile.objects.filter(user=user).first()


def has_confirmed_xray(user):
    return MedicalAttachment.objects.filter(
        visit__user=user,
        attachment__owner=user,
        attachment__purpose="medical",
        attachment__status="ready",
        category=MedicalAttachment.Category.XRAY_IMAGE,
        owner_confirmed_xray=True,
        xray_confirmed_at__isnull=False,
    ).exists()


def refresh_onboarding_status(user):
    """Mark an already completed profile for update if its last confirmed image is gone."""
    profile = Profile.objects.filter(user=user).first()
    if profile and profile.onboarding_status == Profile.OnboardingStatus.COMPLETE and not has_confirmed_xray(user):
        profile.onboarding_status = Profile.OnboardingStatus.NEEDS_UPDATE
        profile.revision += 1
        profile.save(update_fields=["onboarding_status", "revision", "updated_at"])


class MyProfileView(APIView):
    @extend_schema(responses=ProfileSerializer, tags=["Personal account"])
    def get(self, request):
        profile = _profile_for(request.user)
        if profile is None:
            raise SpineError("尚未建立档案。", ErrorCode.NOT_FOUND, status.HTTP_404_NOT_FOUND)
        return Response(profile_payload(request, profile))

    @extend_schema(request=ProfileSerializer, responses=ProfileSerializer, tags=["Personal account"])
    def patch(self, request):
        return _upsert_profile(request)


class CompleteProfileView(APIView):
    """Complete only after a transactionally rechecked, owner-confirmed X-ray exists."""

    @extend_schema(request=None, responses=ProfileSerializer, tags=["Personal account"])
    def post(self, request):
        with transaction.atomic():
            profile = Profile.objects.select_for_update().filter(user=request.user).first()
            if profile is None:
                raise SpineError("请先保存基础档案。", ErrorCode.PROFILE_INCOMPLETE, 409)
            if not profile.nickname.strip() or not has_confirmed_xray(request.user):
                raise SpineError(
                    "需要昵称和一份已完成上传、由你确认的本人既有 X 光影像。",
                    ErrorCode.PROFILE_INCOMPLETE, 409,
                )
            if profile.onboarding_status != Profile.OnboardingStatus.COMPLETE:
                profile.onboarding_status = Profile.OnboardingStatus.COMPLETE
                profile.completed_at = timezone.now()
                profile.revision += 1
                profile.completed_revision = profile.revision
                profile.save(update_fields=[
                    "onboarding_status", "completed_at", "revision", "completed_revision", "updated_at"
                ])
        return Response(profile_payload(request, profile))


class MeIdentityView(APIView):
    """身份与建档状态。返回体只含展示所需字段，不含 openid 等私有身份。"""

    @extend_schema(responses=None, tags=["Personal account"])
    def get(self, request):
        profile = _profile_for(request.user)
        return Response({
            "id": request.user.id,
            "username": request.user.username,
            "has_profile": profile is not None,
            "onboarding_status": profile.onboarding_status if profile else None,
            "nickname": profile.nickname if profile else None,
            "created_at": request.user.date_joined,
        })

    @extend_schema(request=ProfileSerializer, responses=ProfileSerializer, tags=["Personal account"])
    def patch(self, request):
        return _upsert_profile(request)


def _upsert_profile(request):
    profile = _profile_for(request.user)
    serializer = ProfileSerializer(
        instance=profile,
        data=request.data,
        partial=profile is not None,
        context={"request": request},
    )
    serializer.is_valid(raise_exception=True)
    expected = serializer.validated_data.pop("expected_revision", None)
    record, replayed = claim(request, "profile.update", serializer.validated_data)
    if replayed and record.object_id:
        existing = _profile_for(request.user)
        if existing is not None:
            return Response(profile_payload(request, existing))
    with transaction.atomic():
        if profile is not None:
            # 锁住这一行，避免两端同时 PATCH 时后写覆盖前写。
            profile = Profile.objects.select_for_update().get(pk=profile.pk)
            check_expected_revision(profile, expected)
        try:
            saved = serializer.save(user=request.user) if profile is None else _apply(serializer, profile)
        except IntegrityError:
            # 并发建档：另一端已经建好了，改为更新既有档案。
            existing = Profile.objects.select_for_update().get(user=request.user)
            fallback = ProfileSerializer(
                instance=existing, data=request.data, partial=True, context={"request": request}
            )
            fallback.is_valid(raise_exception=True)
            fallback.validated_data.pop("expected_revision", None)
            saved = _apply(fallback, existing)
    record_result(record, status.HTTP_200_OK, saved.id)
    return Response(profile_payload(request, saved))


def _apply(serializer, instance):
    serializer.instance = instance
    instance.revision = (instance.revision or 0) + 1
    serializer.save()
    return instance


class BodyMeasurementViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = BodyMeasurementSerializer
    pagination_class = StandardPagination
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        if not self.request.user or not self.request.user.is_authenticated:
            return BodyMeasurement.objects.none()
        # 先按 owner 过滤再取 id：UUID 不是权限机制（规格 §13.9）。
        return BodyMeasurement.objects.filter(user=self.request.user)

    def create(self, request):
        serializer = self.get_serializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.validated_data.pop("expected_revision", None)
        record, replayed = claim(request, "body_measurement.create", serializer.validated_data)
        if replayed and record.object_id:
            existing = self.get_queryset().filter(pk=record.object_id).first()
            if existing is not None:
                return Response(self.get_serializer(existing).data)
        instance = serializer.save(user=request.user)
        record_result(record, status.HTTP_201_CREATED, instance.id)
        return Response(self.get_serializer(instance).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(
            instance, data=request.data, partial=partial, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        expected = serializer.validated_data.pop("expected_revision", None)
        with transaction.atomic():
            instance = BodyMeasurement.objects.select_for_update().get(pk=instance.pk)
            check_expected_revision(instance, expected)
            serializer.instance = instance
            instance.revision = (instance.revision or 0) + 1
            instance.updated_at = timezone.now()
            serializer.save()
        return Response(self.get_serializer(instance).data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
