from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from .models import (BraceTrainingPrompt, PersonalActionCard, PersonalActionCardRevision,
                     PlanVersion, TrainingAttempt, TrainingPlan)


class RevisionConflict(APIException):
    status_code = 409
    default_code = "REVISION_CONFLICT"
    default_detail = "训练计划已更新，请刷新后重试。"


class IdempotencyConflict(APIException):
    status_code = 409
    default_code = "IDEMPOTENCY_CONFLICT"
    default_detail = "同一请求标识不能用于不同内容。"


def lock_owner(user):
    get_user_model().objects.select_for_update().get(pk=user.pk)


def current_plan(user):
    plan = TrainingPlan.objects.filter(owner=user, status=TrainingPlan.ACTIVE).first()
    if plan:
        return plan
    plan = TrainingPlan.objects.filter(owner=user, status=TrainingPlan.PAUSED).first()
    if plan:
        return plan
    return TrainingPlan.objects.filter(owner=user, status=TrainingPlan.DRAFT).first()


def snapshot_plan(plan, reason):
    cards = list(plan.cards.filter(active=True).order_by("order", "id"))
    plan.current_version_no += 1
    snapshot = {"cards": [{"card_id": card.pk, "revision": card.revision, "name": card.name, "source_type": card.source_type,
                           "source_version_id": card.source_version_id, "dose": card.dose_snapshot()} for card in cards]}
    version = PlanVersion.objects.create(plan=plan, version_no=plan.current_version_no, snapshot=snapshot, reason=reason)
    plan.save(update_fields=["current_version_no", "updated_at"])
    return version


def readiness(card, confirmed=False):
    has_dose = any((card.reps_per_set, card.breaths_per_set, card.hold_seconds))
    complete = bool(card.sets and has_dose and card.side)
    if card.source_version_id and card.source_version.requires_individual_setup and not card.personal_notes.strip():
        complete = False
    if not complete:
        card.verification_status = PersonalActionCard.NEEDS_SETUP
        card.user_confirmed_at = None
    elif confirmed:
        card.verification_status = PersonalActionCard.READY
        card.user_confirmed_at = timezone.now()
    else:
        card.verification_status = PersonalActionCard.NEEDS_CHECK
        card.user_confirmed_at = None
    return complete


def record_card_revision(card, reason):
    PersonalActionCardRevision.objects.create(card=card, revision=card.revision, snapshot=card.dose_snapshot(), reason=reason)


def require_active_attempt(user):
    return TrainingAttempt.objects.filter(owner=user, status__in=[TrainingAttempt.IN_PROGRESS, TrainingAttempt.PAUSED]).first()


def brace_training_prompt(interval):
    existing = BraceTrainingPrompt.objects.filter(interval=interval).first()
    if existing:
        still_actionable = existing.eligible and not existing.user_choice
        return {"eligible": still_actionable, "reason": existing.reason if still_actionable else "already_prompted",
                "session_id": existing.plan_id if still_actionable else None, "prompt_id": existing.pk}
    plan = TrainingPlan.objects.filter(owner=interval.owner, status=TrainingPlan.ACTIVE).first()
    attempt = require_active_attempt(interval.owner)
    ready_cards = plan.cards.filter(active=True, verification_status=PersonalActionCard.READY) if plan else None
    eligible = bool(plan and ready_cards.exists() and not attempt)
    reason = "eligible" if eligible else "no_active_plan"
    if plan and attempt:
        reason = "training_in_progress"
    elif plan and not ready_cards.exists():
        reason = "no_ready_action"
    event = BraceTrainingPrompt.objects.create(interval=interval, owner=interval.owner, eligible=eligible,
        reason=reason, plan=plan, prompted_at=timezone.now() if eligible else None)
    return {"eligible": eligible, "reason": reason, "session_id": plan.pk if eligible else None, "prompt_id": event.pk}
