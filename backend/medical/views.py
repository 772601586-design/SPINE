"""就诊、附件绑定与多弯记录的接口（规格 v2.0 §4、§14）。

统一约定：

- 所有查询**先按 token 用户过滤再取 id**（UUID 不是权限机制，规格 §13.9）；
  别人猜到了就诊 id 也只会得到 404。
- 有副作用的写入支持 `Idempotency-Key`；编辑支持 `expected_revision`。
- 删除就诊是**真删**：计划侧保留自己的执行快照，来源会显示"原记录已删除"，
  但已删除的附件不再可读（规格 §4.3）。
"""

from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.errors import ErrorCode, SpineError
from core.idempotency import check_expected_revision, claim, record_result
from core.pagination import StandardPagination
from django.utils import timezone
from medical.models import CurveMeasurement, MedicalAttachment, Visit
from medical.serializers import (
    CurveMeasurementSerializer,
    MedicalAttachmentBindingSerializer,
    MedicalAttachmentSerializer,
    MedicalAttachmentUpdateSerializer,
    VisitDetailSerializer,
    VisitSerializer,
)
from profiles.views import refresh_onboarding_status


def _max_attachments():
    from django.conf import settings

    return getattr(settings, "VISIT_MAX_ATTACHMENTS", 20)


def _apply_revision(serializer, instance):
    serializer.instance = instance
    instance.revision = (instance.revision or 0) + 1
    serializer.save()
    return instance


class VisitViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    pagination_class = StandardPagination
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        if not self.request.user or not self.request.user.is_authenticated:
            return Visit.objects.none()
        return (
            Visit.objects.filter(user=self.request.user)
            .prefetch_related("medical_attachments__attachment", "curves")
        )

    def get_serializer_class(self):
        return VisitDetailSerializer if self.action == "retrieve" else VisitSerializer

    def create(self, request):
        serializer = VisitSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.validated_data.pop("expected_revision", None)
        record, replayed = claim(request, "visit.create", serializer.validated_data)
        if replayed and record.object_id:
            existing = self.get_queryset().filter(pk=record.object_id).first()
            if existing is not None:
                return Response(VisitDetailSerializer(existing, context={"request": request}).data)
        instance = serializer.save(user=request.user)
        record_result(record, status.HTTP_201_CREATED, instance.id)
        return Response(
            VisitDetailSerializer(instance, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = VisitSerializer(instance, data=request.data, partial=partial, context={"request": request})
        serializer.is_valid(raise_exception=True)
        expected = serializer.validated_data.pop("expected_revision", None)
        with transaction.atomic():
            instance = Visit.objects.select_for_update().get(pk=instance.pk)
            check_expected_revision(instance, expected)
            _apply_revision(serializer, instance)
        instance = self.get_queryset().get(pk=instance.pk)
        return Response(VisitDetailSerializer(instance, context={"request": request}).data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.delete()
        refresh_onboarding_status(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ---- 附件绑定 ----

    @extend_schema(request=MedicalAttachmentBindingSerializer, responses=MedicalAttachmentSerializer,
                   tags=["Medical records"])
    @action(detail=True, methods=["post"], url_path="attachments")
    def bind_attachment(self, request, pk=None):
        visit = self.get_object()
        serializer = MedicalAttachmentBindingSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        attachment = serializer.validated_data["attachment"]
        with transaction.atomic():
            # 锁住这次就诊，避免并发绑定绕过数量上限。
            visit = Visit.objects.select_for_update().get(pk=visit.pk)
            existing = MedicalAttachment.objects.filter(visit=visit, attachment=attachment).first()
            if existing is not None:
                # 重复绑定按幂等处理，但分类以最新提交为准。
                existing.category = serializer.validated_data["category"]
                existing.caption = serializer.validated_data.get("caption", "")
                confirmed = serializer.validated_data.get("owner_confirmed_xray", False)
                existing.owner_confirmed_xray = confirmed and existing.category == MedicalAttachment.Category.XRAY_IMAGE
                existing.xray_confirmed_at = timezone.now() if existing.owner_confirmed_xray else None
                existing.save(update_fields=["category", "caption", "owner_confirmed_xray", "xray_confirmed_at", "updated_at"])
                refresh_onboarding_status(request.user)
                return Response(MedicalAttachmentSerializer(existing, context={"request": request}).data)
            if MedicalAttachment.objects.filter(attachment=attachment).exists():
                raise SpineError(
                    "该附件已属于另一次就诊，请先解除原绑定。", ErrorCode.VALIDATION_ERROR, 409
                )
            if MedicalAttachment.objects.filter(visit=visit).count() >= _max_attachments():
                raise SpineError(
                    f"一次就诊最多挂 {_max_attachments()} 个附件。",
                    ErrorCode.VALIDATION_ERROR,
                    409,
                )
            binding = MedicalAttachment.objects.create(
                visit=visit,
                attachment=attachment,
                category=serializer.validated_data["category"],
                caption=serializer.validated_data.get("caption", ""),
                owner_confirmed_xray=(serializer.validated_data.get("owner_confirmed_xray", False)
                                      and serializer.validated_data["category"] == MedicalAttachment.Category.XRAY_IMAGE),
                xray_confirmed_at=(timezone.now() if serializer.validated_data.get("owner_confirmed_xray", False)
                                   and serializer.validated_data["category"] == MedicalAttachment.Category.XRAY_IMAGE else None),
            )
        return Response(
            MedicalAttachmentSerializer(binding, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(
        request=MedicalAttachmentUpdateSerializer,
        responses={200: MedicalAttachmentSerializer, 204: None},
        tags=["Medical records"],
        parameters=[OpenApiParameter("attachment_id", str, OpenApiParameter.PATH, required=True,
                                     description="附件 ID（Attachment 主键）")],
    )
    @action(detail=True, methods=["patch", "delete"], url_path=r"attachments/(?P<attachment_id>[^/.]+)")
    def attachment_detail(self, request, pk=None, attachment_id=None):
        """改分类（PATCH）/ 解除绑定（DELETE）。

        两个方法必须挂在同一个 action 上：DRF 会为每个 `@action` 生成一条路由，
        同一路径注册两条时只有第一条会被匹配到，第二个方法会直接变成 405。
        """
        visit = self.get_object()
        binding = get_object_or_404(MedicalAttachment, visit=visit, attachment_id=attachment_id)
        if request.method == "DELETE":
            # 只解除绑定，不删原件：附件仍是本人的私有对象，可由本人显式删除或由
            # 孤儿清理任务回收。医疗用途不在公开可读范围内，解绑不会造成泄露。
            binding.delete()
            refresh_onboarding_status(request.user)
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = MedicalAttachmentUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        category = values.get("category", binding.category)
        binding.owner_confirmed_xray = (
            category == MedicalAttachment.Category.XRAY_IMAGE
            and values.get("owner_confirmed_xray", False)
        )
        binding.xray_confirmed_at = timezone.now() if binding.owner_confirmed_xray else None
        for field, value in values.items():
            if field == "owner_confirmed_xray":
                continue
            setattr(binding, field, value)
        binding.save(update_fields=[*values.keys(), "owner_confirmed_xray", "xray_confirmed_at", "updated_at"])
        refresh_onboarding_status(request.user)
        return Response(MedicalAttachmentSerializer(binding, context={"request": request}).data)

    # ---- 多弯记录 ----

    @extend_schema(request=CurveMeasurementSerializer, responses=CurveMeasurementSerializer(many=True),
                   tags=["Medical records"])
    @action(detail=True, methods=["get", "post"], url_path="curves")
    def curves(self, request, pk=None):
        """列出 / 追加弯曲记录。同次检查可以有多条，这里只追加，不覆盖旧记录。"""
        visit = self.get_object()
        if request.method == "GET":
            return Response(CurveMeasurementSerializer(visit.curves.all(), many=True).data)
        serializer = CurveMeasurementSerializer(
            data=request.data, context={"request": request, "visit": visit}
        )
        serializer.is_valid(raise_exception=True)
        serializer.validated_data.pop("expected_revision", None)
        record, replayed = claim(request, "curve.create", serializer.validated_data)
        if replayed and record.object_id:
            existing = visit.curves.filter(pk=record.object_id).first()
            if existing is not None:
                return Response(CurveMeasurementSerializer(existing).data)
        instance = serializer.save(visit=visit, entered_by=request.user)
        record_result(record, status.HTTP_201_CREATED, instance.id)
        return Response(CurveMeasurementSerializer(instance).data, status=status.HTTP_201_CREATED)


class CurveMeasurementViewSet(
    mixins.RetrieveModelMixin, mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    serializer_class = CurveMeasurementSerializer
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        if not self.request.user or not self.request.user.is_authenticated:
            return CurveMeasurement.objects.none()
        return CurveMeasurement.objects.filter(visit__user=self.request.user).select_related("visit")

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = CurveMeasurementSerializer(
            instance, data=request.data, partial=partial, context={"request": request, "visit": instance.visit}
        )
        serializer.is_valid(raise_exception=True)
        expected = serializer.validated_data.pop("expected_revision", None)
        with transaction.atomic():
            instance = CurveMeasurement.objects.select_for_update().get(pk=instance.pk)
            check_expected_revision(instance, expected)
            _apply_revision(serializer, instance)
        return Response(CurveMeasurementSerializer(instance).data)

    def destroy(self, request, *args, **kwargs):
        # 删的是一条弯曲记录，不是整次检查——历史趋势按条并列，删错可以重录。
        self.get_object().delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
