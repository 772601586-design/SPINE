from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from .models import Brace, ComfortEntry, ComfortFollowUp, WearSession
from .serializers import (
    BraceSerializer, ComfortSerializer, RevisionSerializer, WearCorrectionSerializer,
    ComfortFollowUpSerializer, WearEndSerializer, WearInputSerializer, WearSerializer,
)
from .services import Conflict, daily_statistics, lock_owner, payload_signature, revise, validate_interval


class BraceViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                   mixins.UpdateModelMixin, viewsets.GenericViewSet):
    serializer_class = BraceSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        return Brace.objects.filter(owner=self.request.user) if self.request.user else Brace.objects.none()

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def perform_update(self, serializer):
        with transaction.atomic():
            lock_owner(self.request.user)
            if serializer.validated_data.get("is_active") is False and WearSession.objects.filter(
                brace=serializer.instance, ended_at__isnull=True
            ).exists():
                raise ValidationError({"is_active": "该支具仍有未结束佩戴记录，请先结束后再停用。"})
            serializer.save()


class WearViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = WearSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        return WearSession.objects.filter(owner=self.request.user).select_related("brace") if self.request.user else WearSession.objects.none()

    def _create(self, request, start_only):
        serializer = WearInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        if start_only and values.get("ended_at") is not None:
            raise ValidationError({"ended_at": "开始佩戴不能包含结束时间。"})
        if not start_only and ("started_at" not in values or not values.get("ended_at")):
            raise ValidationError("补录必须填写开始和结束时间。")
        signature = payload_signature({**values, "operation": "start" if start_only else "backfill"})
        with transaction.atomic():
            lock_owner(request.user)
            brace = get_object_or_404(Brace.objects.filter(owner=request.user), pk=values.pop("brace"))
            replay = self.get_queryset().filter(request_id=values["request_id"]).first()
            if replay:
                if replay.initial_payload != signature:
                    raise Conflict("同一请求标识不能用于不同内容。")
                return Response(WearSerializer(replay).data)
            if not brace.is_active:
                raise ValidationError("停用的支具不能新增佩戴记录。")
            active = self.get_queryset().filter(ended_at__isnull=True).first()
            if start_only and active:
                raise Conflict("已有未结束的佩戴记录，请先结束或使用原请求重试。")
            values.setdefault("started_at", timezone.now())
            validate_interval(request.user, values["started_at"], values.get("ended_at"))
            session = WearSession.objects.create(owner=request.user, brace=brace, initial_payload=signature, **values)
        return Response(WearSerializer(session).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=WearInputSerializer, responses=WearSerializer)
    def create(self, request):
        return self._create(request, start_only=False)

    @extend_schema(request=WearInputSerializer, responses=WearSerializer)
    @action(detail=False, methods=["post"])
    def start(self, request):
        return self._create(request, start_only=True)

    @extend_schema(request=WearEndSerializer, responses=WearSerializer)
    @action(detail=True, methods=["post"])
    def end(self, request, pk=None):
        serializer = WearEndSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            lock_owner(request.user)
            session = self.get_object()
            ended_at = serializer.validated_data.get("ended_at")
            if session.ended_at:
                if ended_at and ended_at != session.ended_at:
                    raise Conflict("已经结束；改变结束时间请使用修正功能。")
                return Response(WearSerializer(session).data)
            revise(session, request.user, {"ended_at": ended_at or timezone.now()}, "结束佩戴")
        return Response(WearSerializer(session).data)

    @extend_schema(request=WearCorrectionSerializer, responses=WearSerializer)
    def partial_update(self, request, pk=None):
        serializer = WearCorrectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        version, reason = values.pop("version"), values.pop("reason")
        if not values:
            raise ValidationError("至少填写一个修正字段。")
        with transaction.atomic():
            lock_owner(request.user)
            session = self.get_object()
            # A lost-response retry is harmless even if its original version is stale.
            if all(getattr(session, key) == value for key, value in values.items()):
                return Response(WearSerializer(session).data)
            if version != session.version:
                raise Conflict("记录已更新，请刷新后重新修正。")
            revise(session, request.user, values, reason)
        return Response(WearSerializer(session).data)

    @extend_schema(responses=RevisionSerializer(many=True))
    @action(detail=True, methods=["get"])
    def revisions(self, request, pk=None):
        return Response(RevisionSerializer(self.get_object().revisions.all(), many=True).data)

    @extend_schema(responses={200: {"type": "object", "properties": {"timezone": {"type": "string"}, "days": {"type": "array", "items": {"type": "object"}}}}})
    @action(detail=False, methods=["get"])
    def statistics(self, request):
        queryset = self.get_queryset()
        brace_id = request.query_params.get("brace")
        if brace_id:
            brace = get_object_or_404(Brace.objects.filter(owner=request.user), pk=brace_id)
            queryset = queryset.filter(brace=brace)
        return Response(daily_statistics(queryset))


class ComfortViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin,
                     viewsets.GenericViewSet):
    serializer_class = ComfortSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        return ComfortEntry.objects.filter(owner=self.request.user).select_related("brace", "wear_session") if self.request.user else ComfortEntry.objects.none()

    def create(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        signature = payload_signature(serializer.validated_data)
        with transaction.atomic():
            lock_owner(request.user)
            replay = self.get_queryset().filter(request_id=serializer.validated_data["request_id"]).first()
            if replay:
                if replay.initial_payload != signature:
                    raise Conflict("同一请求标识不能用于不同内容。")
                return Response(self.get_serializer(replay).data)
            instance = serializer.save(owner=request.user, initial_payload=signature)
        return Response(self.get_serializer(instance).data, status=status.HTTP_201_CREATED)


class ComfortFollowUpViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    serializer_class = ComfortFollowUpSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = ComfortFollowUp.objects.filter(owner=self.request.user).select_related("entry") if self.request.user else ComfortFollowUp.objects.none()
        entry_id = self.request.query_params.get("entry")
        return queryset.filter(entry_id=entry_id) if entry_id else queryset

    def create(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        from .services import follow_up_signature, lock_owner
        from django.db import transaction
        values = serializer.validated_data
        signature = follow_up_signature(values)
        with transaction.atomic():
            lock_owner(request.user)
            replay = self.get_queryset().filter(request_id=values["request_id"]).first()
            if replay:
                if follow_up_signature({"entry": replay.entry, "status": replay.status, "occurred_at": replay.occurred_at, "notes": replay.notes, "request_id": replay.request_id}) != signature:
                    raise Conflict("同一请求标识不能用于不同内容。")
                return Response(self.get_serializer(replay).data)
            instance = serializer.save(owner=request.user)
        return Response(self.get_serializer(instance).data, status=status.HTTP_201_CREATED)
