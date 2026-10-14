import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q

from exercises.models import ExerciseVersion


class TrainingPlan(models.Model):
    DRAFT, ACTIVE, PAUSED, ENDED = "draft", "active", "paused", "ended"
    STATUSES = [(v, v.title()) for v in (DRAFT, ACTIVE, PAUSED, ENDED)]
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="training_plans")
    title = models.CharField(max_length=160, default="我的训练计划")
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    timezone = models.CharField(max_length=64, default="Asia/Shanghai")
    status = models.CharField(max_length=12, choices=STATUSES, default=ACTIVE)
    current_version_no = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner"], condition=Q(status="active"), name="one_active_training_plan_per_user")]
        ordering = ["-updated_at"]


class PlanVersion(models.Model):
    plan = models.ForeignKey(TrainingPlan, on_delete=models.PROTECT, related_name="versions")
    version_no = models.PositiveIntegerField()
    snapshot = models.JSONField(default=dict)
    reason = models.CharField(max_length=200, default="个人计划调整")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["plan", "version_no"], name="training_plan_version_unique")]
        ordering = ["-version_no"]


class PersonalActionCard(models.Model):
    LIBRARY, PRESCRIPTION, CUSTOM = "library", "prescription", "custom"
    SOURCES = [(v, v.title()) for v in (LIBRARY, PRESCRIPTION, CUSTOM)]
    NEEDS_SETUP, NEEDS_CHECK, READY = "needs_setup", "needs_check", "ready"
    READINESS = [(v, v.replace("_", " ").title()) for v in (NEEDS_SETUP, NEEDS_CHECK, READY)]
    plan = models.ForeignKey(TrainingPlan, on_delete=models.PROTECT, related_name="cards")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="action_cards")
    source_version = models.ForeignKey(ExerciseVersion, null=True, blank=True, on_delete=models.PROTECT, related_name="personal_cards")
    source_type = models.CharField(max_length=16, choices=SOURCES, default=LIBRARY)
    name = models.CharField(max_length=160)
    order = models.PositiveIntegerField(default=0)
    revision = models.PositiveIntegerField(default=1)
    active = models.BooleanField(default=True)
    verification_status = models.CharField(max_length=16, choices=READINESS, default=NEEDS_SETUP)
    sets = models.PositiveSmallIntegerField(null=True, blank=True)
    reps_per_set = models.PositiveSmallIntegerField(null=True, blank=True)
    breaths_per_set = models.PositiveSmallIntegerField(null=True, blank=True)
    hold_seconds = models.PositiveSmallIntegerField(null=True, blank=True)
    side = models.CharField(max_length=24, blank=True)
    rest_seconds = models.PositiveSmallIntegerField(null=True, blank=True)
    equipment = models.JSONField(default=list, blank=True)
    focus_points = models.JSONField(default=list, blank=True)
    personal_notes = models.TextField(blank=True)
    user_confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "created_at"]
        constraints = [
            models.UniqueConstraint(fields=["owner", "plan", "source_version"], condition=Q(active=True, source_version__isnull=False), name="one_card_per_exercise_version"),
            models.CheckConstraint(condition=Q(reps_per_set__isnull=True) | Q(reps_per_set__gt=0), name="card_reps_positive"),
            models.CheckConstraint(condition=Q(breaths_per_set__isnull=True) | Q(breaths_per_set__gt=0), name="card_breaths_positive"),
            models.CheckConstraint(condition=Q(hold_seconds__isnull=True) | Q(hold_seconds__gt=0), name="card_hold_positive"),
        ]

    def dose_snapshot(self):
        return {"sets": self.sets, "reps_per_set": self.reps_per_set, "breaths_per_set": self.breaths_per_set,
                "hold_seconds": self.hold_seconds, "side": self.side, "rest_seconds": self.rest_seconds,
                "equipment": self.equipment, "focus_points": self.focus_points, "personal_notes": self.personal_notes,
                "verification_status": self.verification_status}


class PersonalActionCardRevision(models.Model):
    card = models.ForeignKey(PersonalActionCard, on_delete=models.PROTECT, related_name="history")
    revision = models.PositiveIntegerField()
    snapshot = models.JSONField()
    reason = models.CharField(max_length=200, default="个人设置修改")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["card", "revision"], name="action_card_revision_unique")]


class TrainingAttempt(models.Model):
    IN_PROGRESS, PAUSED, COMPLETED, PARTIAL, ABORTED = "in_progress", "paused", "completed", "partial", "aborted"
    STATUSES = [(v, v.replace("_", " ").title()) for v in (IN_PROGRESS, PAUSED, COMPLETED, PARTIAL, ABORTED)]
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="training_attempts")
    plan = models.ForeignKey(TrainingPlan, on_delete=models.PROTECT, related_name="attempts")
    plan_version = models.ForeignKey(PlanVersion, on_delete=models.PROTECT, related_name="attempts")
    card = models.ForeignKey(PersonalActionCard, on_delete=models.PROTECT, related_name="attempts")
    card_revision = models.PositiveIntegerField()
    planned_dose = models.JSONField(default=dict)
    status = models.CharField(max_length=16, choices=STATUSES, default=IN_PROGRESS)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner"], condition=Q(status__in=["in_progress", "paused"]), name="one_open_training_attempt_per_user")]
        ordering = ["-started_at"]


class SetExecution(models.Model):
    attempt = models.ForeignKey(TrainingAttempt, on_delete=models.PROTECT, related_name="sets_done")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="set_executions")
    set_index = models.PositiveSmallIntegerField()
    planned_dose_snapshot = models.JSONField(default=dict)
    actual_reps = models.PositiveSmallIntegerField(null=True, blank=True)
    actual_breaths = models.PositiveSmallIntegerField(null=True, blank=True)
    actual_hold_seconds = models.PositiveSmallIntegerField(null=True, blank=True)
    confirmation_source = models.CharField(max_length=24, default="guided")
    sync_status = models.CharField(max_length=12, default="synced", editable=False)
    client_request_id = models.UUIDField(default=uuid.uuid4)
    confirmed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["set_index"]
        constraints = [
            models.UniqueConstraint(fields=["attempt", "set_index"], name="set_once_per_attempt_card"),
            models.UniqueConstraint(fields=["owner", "client_request_id"], name="set_request_once_per_user"),
        ]


class BraceTrainingPrompt(models.Model):
    CONTINUE, SKIP = "continue", "skip"
    interval = models.OneToOneField("braces.WearSession", on_delete=models.PROTECT, related_name="training_prompt")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="brace_training_prompts")
    eligible = models.BooleanField(default=False)
    reason = models.CharField(max_length=100, blank=True)
    plan = models.ForeignKey(TrainingPlan, null=True, blank=True, on_delete=models.PROTECT)
    prompted_at = models.DateTimeField(null=True, blank=True)
    user_choice = models.CharField(max_length=12, choices=[(CONTINUE, "Continue"), (SKIP, "Skip")], blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
