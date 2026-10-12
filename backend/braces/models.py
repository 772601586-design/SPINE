from django.conf import settings
from django.db import models
from django.db.models import F, Q


class Brace(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    name = models.CharField(max_length=100)
    brace_type = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True, max_length=2000)
    started_on = models.DateField(null=True, blank=True)
    institution = models.CharField(max_length=200, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]


class WearSession(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    brace = models.ForeignKey(Brace, on_delete=models.PROTECT, related_name="wear_sessions")
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    original_timezone = models.CharField(max_length=64, default="Asia/Shanghai")
    source = models.CharField(max_length=20, default="manual", editable=False)
    request_id = models.UUIDField()
    initial_payload = models.JSONField(default=dict, editable=False)
    notes = models.TextField(blank=True, max_length=2000)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_at", "-id"]
        indexes = [models.Index(fields=["owner", "started_at"])]
        constraints = [
            models.UniqueConstraint(fields=["owner", "request_id"], name="wear_request_once"),
            models.UniqueConstraint(fields=["owner"], condition=Q(ended_at__isnull=True), name="one_open_wear_per_user"),
            models.CheckConstraint(condition=Q(ended_at__isnull=True) | Q(ended_at__gt=F("started_at")), name="wear_positive_interval"),
        ]


class WearRevision(models.Model):
    session = models.ForeignKey(WearSession, on_delete=models.PROTECT, related_name="revisions")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    before = models.JSONField()
    after = models.JSONField()
    reason = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]


class ComfortEntry(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    brace = models.ForeignKey(Brace, on_delete=models.PROTECT, related_name="comfort_entries")
    wear_session = models.ForeignKey(WearSession, null=True, blank=True, on_delete=models.PROTECT)
    pain = models.PositiveSmallIntegerField(null=True, blank=True)
    pain_note = models.TextField(blank=True, max_length=1000)
    comfort_level = models.PositiveSmallIntegerField(null=True, blank=True)
    positions = models.JSONField(default=list)
    tags = models.JSONField(default=list)
    occurred_at = models.DateTimeField()
    notes = models.TextField(blank=True, max_length=2000)
    request_id = models.UUIDField()
    initial_payload = models.JSONField(default=dict, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-occurred_at", "-id"]
        constraints = [
            models.CheckConstraint(condition=Q(pain__isnull=True) | Q(pain__lte=10), name="comfort_pain_0_10"),
            models.CheckConstraint(condition=Q(comfort_level__isnull=True) | Q(comfort_level__gte=1, comfort_level__lte=5), name="comfort_level_1_5"),
            models.UniqueConstraint(fields=["owner", "request_id"], name="comfort_request_once"),
        ]


class ComfortFollowUp(models.Model):
    class Status(models.TextChoices):
        IMPROVED = "improved", "缓解"
        PERSISTING = "persisting", "仍存在"
        WORSENED = "worsened", "加重"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    entry = models.ForeignKey(ComfortEntry, on_delete=models.PROTECT, related_name="follow_ups")
    status = models.CharField(max_length=16, choices=Status.choices)
    occurred_at = models.DateTimeField()
    notes = models.TextField(blank=True, max_length=1000)
    request_id = models.UUIDField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["occurred_at", "id"]
        constraints = [models.UniqueConstraint(fields=["owner", "request_id"], name="comfort_followup_request_once")]
