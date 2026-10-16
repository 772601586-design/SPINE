"""User checked transcription; never infers an exercise prescription from a diagnosis."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from exercises.models import ExerciseVersion
from training.models import PersonalActionCard, TrainingPlan
from training.serializers import CardUpdateSerializer
from training.services import (current_plan, lock_owner, readiness, record_card_revision,
                               require_active_attempt, snapshot_plan)
from .models import PrescriptionImport


class PrescriptionRow(CardUpdateSerializer):
    expected_revision = serializers.IntegerField(min_value=1, required=False)
    card_id = serializers.IntegerField(min_value=1, allow_null=True, required=False)
    source_version_id = serializers.IntegerField(min_value=1, allow_null=True, required=False)
    name = serializers.CharField(max_length=160)


class PrescriptionInput(serializers.Serializer):
    request_id = serializers.UUIDField()
    rows = PrescriptionRow(many=True, allow_empty=False, max_length=50)


class PrescriptionView(APIView):
    def post(self, request):
        serializer = PrescriptionInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        # JSON-safe canonical rows preserve the payload so retries cannot overwrite another import.
        rows = serializer.data["rows"]
        with transaction.atomic():
            lock_owner(request.user)
            previous = PrescriptionImport.objects.filter(owner=request.user, request_id=values["request_id"]).first()
            if previous:
                if previous.rows != rows:
                    raise ValidationError("同一请求编号不能用于不同处方。")
                return Response({"changes": previous.result})
            if require_active_attempt(request.user):
                raise ValidationError("请先结束当前训练，再整理处方。")
            plan = current_plan(request.user)
            if not plan:
                plan = TrainingPlan.objects.create(owner=request.user)
            if plan.status != TrainingPlan.ACTIVE:
                raise ValidationError("请先恢复当前训练计划。")
            changes = []
            seen = set()
            for source in values["rows"]:
                row = dict(source)
                card_id = row.pop("card_id", None)
                version_id = row.pop("source_version_id", None)
                expected = row.pop("expected_revision", None)
                # Imported parameters require an explicit separate check on the card page.
                row.pop("confirm_parameters", None)
                if card_id:
                    if card_id in seen:
                        raise ValidationError("同一个动作不能在一份导入中重复修改。")
                    seen.add(card_id)
                    card = get_object_or_404(PersonalActionCard, owner=request.user, plan=plan, active=True, pk=card_id)
                    if expected != card.revision:
                        raise ValidationError("动作卡已变化，请重新加载处方。")
                    before = {"name": card.name, **card.dose_snapshot()}
                    card.revision += 1
                else:
                    last = plan.cards.order_by("-order").first()
                    card = PersonalActionCard(owner=request.user, plan=plan, source_type="prescription", order=(last.order + 1 if last else 1))
                    before = None
                if version_id:
                    version = get_object_or_404(ExerciseVersion, pk=version_id, status="published", reviewer__gt="", reviewed_at__isnull=False, exercise__is_active=True)
                    if PersonalActionCard.objects.filter(owner=request.user, plan=plan, active=True, source_version=version).exclude(pk=card.pk).exists():
                        raise ValidationError("该标准动作已经在计划中，请选择更新已有卡片。")
                    card.source_version = version
                for key, value in row.items():
                    setattr(card, key, value)
                readiness(card, confirmed=False)
                card.save()
                record_card_revision(card, "本人核对处方转录")
                changes.append({"card_id": card.pk, "before": before, "after": {"name": card.name, **card.dose_snapshot()}})
            snapshot_plan(plan, "处方导入与变更核对")
            PrescriptionImport.objects.create(owner=request.user, request_id=values["request_id"], rows=rows, result=changes)
        return Response({"changes": changes}, status=201)
