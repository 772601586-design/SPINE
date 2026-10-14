from django.db import transaction
from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from exercises.models import ExerciseVersion

from .models import (PersonalActionCard, PersonalActionCardRevision, PlanVersion, SetExecution,
                     TrainingAttempt, TrainingPlan)
from .serializers import (AttemptSerializer, CardUpdateSerializer, ConfirmSetSerializer,
                          AddActionCardSerializer, PersonalActionCardSerializer, ReorderCardsSerializer,
                          SetExecutionSerializer, StartAttemptSerializer,
                          TrainingPlanSerializer)
from .services import (IdempotencyConflict, RevisionConflict, current_plan, lock_owner,
                       readiness, record_card_revision, require_active_attempt, snapshot_plan)


class PlanUnavailable(APIException):
    status_code = 409
    default_code = "PLAN_PAUSED"
    default_detail = "当前计划暂停或已结束，暂时不能开始训练。"


class TrainingPlanView(APIView):
    serializer_class = TrainingPlanSerializer

    @extend_schema(responses=TrainingPlanSerializer(allow_null=True))
    def get(self, request):
        plan = current_plan(request.user)
        if not plan:
            return Response(None)
        return Response(TrainingPlanSerializer(plan).data)


@extend_schema_view(list=extend_schema(responses=PersonalActionCardSerializer(many=True)),
                    retrieve=extend_schema(responses=PersonalActionCardSerializer))
class PersonalActionCardViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin,
                                viewsets.GenericViewSet):
    serializer_class = PersonalActionCardSerializer

    def get_queryset(self):
        return PersonalActionCard.objects.filter(owner=self.request.user).select_related(
            "plan", "source_version", "source_version__exercise"
        ).prefetch_related(Prefetch("attempts", queryset=TrainingAttempt.objects.order_by("-started_at").prefetch_related("sets_done"), to_attr="prefetched_attempts"))

    @extend_schema(request=AddActionCardSerializer,
                   responses=PersonalActionCardSerializer)
    @action(detail=False, methods=["post"], url_path="from-exercise")
    def from_exercise(self, request):
        input_serializer = AddActionCardSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        exercise_version_id = input_serializer.validated_data["exercise_version_id"]
        with transaction.atomic():
            lock_owner(request.user)
            source = get_object_or_404(ExerciseVersion.objects.filter(
                status=ExerciseVersion.PUBLISHED, reviewer__gt="", reviewed_at__isnull=False,
                exercise__is_active=True,
            ), pk=exercise_version_id)
            plan = current_plan(request.user)
            if not plan:
                plan = TrainingPlan.objects.create(owner=request.user, status=TrainingPlan.ACTIVE)
            if plan.status != TrainingPlan.ACTIVE:
                raise PlanUnavailable("当前计划不是活动状态，请先恢复计划或建立新周期。")
            existing = self.get_queryset().filter(plan=plan, source_version=source, active=True).first()
            if existing:
                return Response(PersonalActionCardSerializer(existing).data)
            next_order = (plan.cards.filter(active=True).order_by("-order").values_list("order", flat=True).first() or 0) + 1
            card = PersonalActionCard.objects.create(
                owner=request.user, plan=plan, source_version=source, name=source.name,
                source_type=PersonalActionCard.LIBRARY, order=next_order,
            )
            record_card_revision(card, "从动作库添加")
            snapshot_plan(plan, "添加动作卡")
        return Response(PersonalActionCardSerializer(card).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=CardUpdateSerializer, responses=PersonalActionCardSerializer)
    def partial_update(self, request, pk=None):
        serializer = CardUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        expected = values.pop("expected_revision")
        confirm = values.pop("confirm_parameters", False)
        with transaction.atomic():
            lock_owner(request.user)
            card = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk, active=True)
            if expected != card.revision:
                raise RevisionConflict()
            if card.plan.status != TrainingPlan.ACTIVE:
                raise PlanUnavailable()
            if require_active_attempt(request.user):
                raise PlanUnavailable("请先结束或暂停当前训练，再修改动作卡。")
            changed = any(getattr(card, key) != value for key, value in values.items())
            for key, value in values.items():
                setattr(card, key, value)
            readiness(card, confirmed=confirm)
            if changed or confirm:
                card.revision += 1
                card.save()
                record_card_revision(card, "动作参数修改并核对" if confirm else "动作参数修改")
                snapshot_plan(card.plan, "动作卡版本更新")
            else:
                card.save(update_fields=["verification_status", "user_confirmed_at", "updated_at"])
        return Response(PersonalActionCardSerializer(card).data)

    def destroy(self, request, pk=None):
        with transaction.atomic():
            lock_owner(request.user)
            card = get_object_or_404(self.get_queryset().select_for_update(of=("self",)), pk=pk, active=True)
            if require_active_attempt(request.user):
                raise PlanUnavailable("请先结束或暂停当前训练，再调整计划。")
            card.active = False
            card.revision += 1
            card.save(update_fields=["active", "revision", "updated_at"])
            record_card_revision(card, "从后续计划移除（历史记录保留）")
            snapshot_plan(card.plan, "移除后续动作")
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=ReorderCardsSerializer, responses=TrainingPlanSerializer)
    @action(detail=False, methods=["post"])
    def reorder(self, request):
        input_serializer = ReorderCardsSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        card_ids = input_serializer.validated_data["card_ids"]
        if len(card_ids) != len(set(card_ids)):
            raise ValidationError({"card_ids": "请提供不重复的动作卡顺序。"})
        with transaction.atomic():
            lock_owner(request.user)
            plan = current_plan(request.user)
            if not plan or plan.status != TrainingPlan.ACTIVE:
                raise PlanUnavailable()
            cards = list(self.get_queryset().select_for_update(of=("self",)).filter(plan=plan, active=True))
            if {card.pk for card in cards} != set(card_ids):
                raise ValidationError({"card_ids": "动作卡列表已变化，请刷新后重试。"})
            for index, card_id in enumerate(card_ids, start=1):
                card = next(row for row in cards if row.pk == card_id)
                card.order = index
                card.revision += 1
                card.save(update_fields=["order", "revision", "updated_at"])
            snapshot_plan(plan, "调整动作顺序")
        return Response(TrainingPlanSerializer(plan).data)


class TrainingAttemptViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin,
                             viewsets.GenericViewSet):
    serializer_class = AttemptSerializer

    def get_queryset(self):
        return TrainingAttempt.objects.filter(owner=self.request.user).select_related("plan", "plan_version", "card").prefetch_related("sets_done")

    @extend_schema(request=StartAttemptSerializer, responses=AttemptSerializer)
    @action(detail=False, methods=["post"])
    def start(self, request):
        serializer = StartAttemptSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            lock_owner(request.user)
            card = get_object_or_404(PersonalActionCard.objects.select_for_update(of=("self",)).select_related("plan", "source_version__exercise"),
                                     pk=serializer.validated_data["card_id"], owner=request.user, active=True)
            if card.verification_status != PersonalActionCard.READY:
                raise ValidationError({"card": "请先补齐并核对动作参数，再开始训练。"})
            if card.plan.status != TrainingPlan.ACTIVE:
                raise PlanUnavailable()
            active = self.get_queryset().filter(status__in=[TrainingAttempt.IN_PROGRESS, TrainingAttempt.PAUSED]).first()
            if active:
                if active.card_id == card.pk:
                    return Response(AttemptSerializer(active).data)
                raise PlanUnavailable("当前已有一项训练，请先完成或中止。")
            version = card.plan.versions.filter(version_no=card.plan.current_version_no).first()
            if version is None:
                version = snapshot_plan(card.plan, "开始训练")
            attempt = TrainingAttempt.objects.create(owner=request.user, plan=card.plan, plan_version=version,
                card=card, card_revision=card.revision, planned_dose=card.dose_snapshot())
        return Response(AttemptSerializer(attempt).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=ConfirmSetSerializer, responses=SetExecutionSerializer)
    @action(detail=True, methods=["post"], url_path="complete-set")
    def complete_set(self, request, pk=None):
        serializer = ConfirmSetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        request_id = values.pop("client_request_id")
        signature = {"set_index": values["set_index"], "actual_reps": values.get("actual_reps"),
                     "actual_breaths": values.get("actual_breaths"), "actual_hold_seconds": values.get("actual_hold_seconds"),
                     "confirmation_source": values.get("confirmation_source", "guided")}
        with transaction.atomic():
            lock_owner(request.user)
            attempt = get_object_or_404(self.get_queryset().select_for_update(), pk=pk)
            existing_request = SetExecution.objects.filter(owner=request.user, client_request_id=request_id).first()
            if existing_request:
                current = {"set_index": existing_request.set_index, "actual_reps": existing_request.actual_reps,
                           "actual_breaths": existing_request.actual_breaths, "actual_hold_seconds": existing_request.actual_hold_seconds,
                           "confirmation_source": existing_request.confirmation_source}
                if existing_request.attempt_id != attempt.pk or current != signature:
                    raise IdempotencyConflict()
                return Response(SetExecutionSerializer(existing_request).data)
            if attempt.status != TrainingAttempt.IN_PROGRESS:
                raise PlanUnavailable("训练已暂停或结束，不能继续添加组记录。")
            set_index = values["set_index"]
            planned_sets = attempt.planned_dose["sets"]
            if set_index > planned_sets:
                raise ValidationError({"set_index": "组次不能超过已核对的计划组数。"})
            if attempt.sets_done.filter(set_index=set_index).exists():
                raise IdempotencyConflict("本组已经保存，请刷新训练进度。")
            record = SetExecution.objects.create(
                owner=request.user, attempt=attempt, set_index=set_index,
                planned_dose_snapshot=attempt.planned_dose,
                actual_reps=values.get("actual_reps"), actual_breaths=values.get("actual_breaths"),
                actual_hold_seconds=values.get("actual_hold_seconds"), confirmation_source=values.get("confirmation_source", "guided"),
                client_request_id=request_id,
            )
        return Response(SetExecutionSerializer(record).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=None, responses=AttemptSerializer)
    @action(detail=True, methods=["post"])
    def finish(self, request, pk=None):
        with transaction.atomic():
            lock_owner(request.user)
            attempt = get_object_or_404(self.get_queryset().select_for_update(), pk=pk)
            if attempt.status in [TrainingAttempt.COMPLETED, TrainingAttempt.PARTIAL, TrainingAttempt.ABORTED]:
                return Response(AttemptSerializer(attempt).data)
            count = attempt.sets_done.count()
            attempt.status = TrainingAttempt.COMPLETED if count >= attempt.planned_dose["sets"] else TrainingAttempt.PARTIAL
            attempt.ended_at = timezone.now()
            attempt.save(update_fields=["status", "ended_at"])
        return Response(AttemptSerializer(attempt).data)

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        with transaction.atomic():
            lock_owner(request.user)
            attempt = get_object_or_404(self.get_queryset().select_for_update(), pk=pk)
            if attempt.status == TrainingAttempt.IN_PROGRESS:
                attempt.status = TrainingAttempt.PAUSED
                attempt.save(update_fields=["status"])
        return Response(AttemptSerializer(attempt).data)

    @action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        with transaction.atomic():
            lock_owner(request.user)
            attempt = get_object_or_404(self.get_queryset().select_for_update(), pk=pk)
            if attempt.status == TrainingAttempt.PAUSED:
                attempt.status = TrainingAttempt.IN_PROGRESS
                attempt.save(update_fields=["status"])
        return Response(AttemptSerializer(attempt).data)
