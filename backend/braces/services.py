import json
from datetime import datetime, time, timedelta, timezone as datetime_timezone
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from .models import WearRevision, WearSession


class Conflict(APIException):
    status_code = 409
    default_detail = "记录冲突，请刷新后重试。"


def lock_owner(user):
    # Serialize every interval mutation for an owner, including requests for different braces.
    return get_user_model().objects.select_for_update().get(pk=user.pk)


def payload_signature(values):
    normalized = {key: value.pk if hasattr(value, "pk") else value for key, value in values.items()}
    return json.loads(json.dumps(normalized, default=str, sort_keys=True))


def follow_up_signature(values):
    # This endpoint is new, so normalize its timestamp before storing/comparing retries.
    normalized = dict(values)
    occurred_at = normalized.get("occurred_at")
    if occurred_at is not None and timezone.is_aware(occurred_at):
        normalized["occurred_at"] = occurred_at.astimezone(datetime_timezone.utc).isoformat(timespec="microseconds")
    return payload_signature(normalized)


def validate_interval(owner, started_at, ended_at, exclude=None):
    now = timezone.now()
    if started_at > now or (ended_at and ended_at > now):
        raise ValidationError("佩戴时间不能在未来。")
    if ended_at is not None and ended_at <= started_at:
        raise ValidationError("结束时间必须晚于开始时间。")
    intervals = WearSession.objects.filter(owner=owner).exclude(pk=exclude)
    intervals = intervals.filter(Q(ended_at__isnull=True) | Q(ended_at__gt=started_at))
    if ended_at is not None:
        intervals = intervals.filter(started_at__lt=ended_at)
    if intervals.exists():
        raise Conflict("佩戴区间与已有记录重叠，请先修正已有记录。")


def snapshot(session):
    return {
        "started_at": session.started_at.isoformat(),
        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
        "notes": session.notes,
        "version": session.version,
    }


def revise(session, actor, values, reason):
    before = snapshot(session)
    for key, value in values.items():
        setattr(session, key, value)
    validate_interval(actor, session.started_at, session.ended_at, exclude=session.pk)
    session.version += 1
    session.save()
    WearRevision.objects.create(session=session, actor=actor, before=before, after=snapshot(session), reason=reason)
    return session


def daily_statistics(queryset):
    zone = ZoneInfo("Asia/Shanghai")
    now = timezone.now()
    totals = {}
    for session in queryset:
        start = session.started_at.astimezone(zone)
        end = (session.ended_at or now).astimezone(zone)
        while start < end:
            midnight = datetime.combine(start.date() + timedelta(days=1), time.min, tzinfo=zone)
            boundary = min(midnight, end)
            key = start.date().isoformat()
            totals[key] = totals.get(key, 0) + (boundary - start).total_seconds()
            start = boundary
    days = [
        {"date": key, "seconds": seconds, "minutes": seconds / 60}
        for key, seconds in sorted(totals.items(), reverse=True)
    ]
    weeks = {}
    for day in days:
        date = datetime.fromisoformat(day["date"]).date()
        monday = date - timedelta(days=date.weekday())
        key = monday.isoformat()
        weeks[key] = weeks.get(key, 0) + day["seconds"]
    return {"timezone": "Asia/Shanghai", "days": days, "weeks": [
        {"week_start": key, "seconds": seconds, "minutes": seconds / 60}
        for key, seconds in sorted(weeks.items(), reverse=True)
    ]}
