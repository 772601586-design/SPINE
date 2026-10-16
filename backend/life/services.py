from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from braces.models import WearSession
from braces.services import daily_statistics
from medical.models import Visit
from training.models import PersonalActionCard, TrainingAttempt
from .models import DailyRecord, LearningRecord, Preferences, Reward


def award(owner, event, points, label):
    return Reward.objects.get_or_create(owner=owner, event=event, defaults={"points": points, "label": label})[0]


def award_training_day(owner):
    from training.scheduler import today_deck
    deck = today_deck(owner)
    if deck["available"] and deck["cards"] and deck["remaining_count"] == 0:
        award(owner, f"training:{deck['date']}", 3, "今日卡组完成")


def wear_record_dates(owner, include_open=False):
    rows = WearSession.objects.filter(owner=owner)
    if not include_open:
        rows = rows.filter(ended_at__isnull=False)
    days = set()
    for wear in rows:
        first = timezone.localtime(wear.started_at).date()
        last = timezone.localtime((wear.ended_at or timezone.now()) - timedelta(microseconds=1)).date()
        while first <= last:
            days.add(first)
            first += timedelta(days=1)
    return days


@transaction.atomic
def reward_summary(owner):
    get_user_model().objects.select_for_update().get(pk=owner.pk)
    # Each stable event key can be credited only once, including retries.
    award_training_day(owner)
    for visit in Visit.objects.filter(user=owner, medical_attachments__isnull=False).distinct():
        award(owner, f"visit:{visit.pk}", 5, "整理复查资料")
    days = wear_record_dates(owner)
    preference = Preferences.objects.filter(owner=owner).first()
    target = preference.brace_target_hours if preference else None
    if target and target > 0:
        statistics = daily_statistics(WearSession.objects.filter(owner=owner, ended_at__isnull=False))
        for day in statistics["days"]:
            if day["seconds"] >= float(target) * 3600:
                award(owner, f"brace:{day['date']}", 2, "支具时长达标")
    for row in LearningRecord.objects.filter(owner=owner, passed=True):
        award(owner, f"quiz:{row.article_id}", 2, "认知学习")
    for row in DailyRecord.objects.filter(owner=owner, kind="drawing"):
        monday = row.date - timedelta(days=row.date.weekday())
        award(owner, f"drawing:{monday}", 1, "每周绘画")
    ledger = Reward.objects.filter(owner=owner)
    training_dates = {timezone.localtime(value).date() for value in TrainingAttempt.objects.filter(owner=owner,
        status="completed", ended_at__isnull=False).values_list("ended_at", flat=True)}
    activity_dates = days | training_dates
    weeks = {day - timedelta(days=day.weekday()) for day in activity_dates}
    checks = [
        ("first_week", "熬过第一周", len(activity_dates) >= 7),
        ("five_actions", "学会 5 个动作", PersonalActionCard.objects.filter(owner=owner, verification_status="ready").count() >= 5),
        ("review", "第一次复查记录", ledger.filter(event__startswith="visit:").exists()),
        ("four_weeks", "坚持 4 周", len(weeks) >= 4),
        ("brace_thirty", "支具达标 30 天", ledger.filter(event__startswith="brace:").count() >= 30),
        ("training_thirty", "训练满 30 次", TrainingAttempt.objects.filter(owner=owner, status="completed").count() >= 30),
    ]
    return {"balance": ledger.aggregate(total=Sum("points"))["total"] or 0,
            "ledger": list(ledger.values("id", "event", "points", "label", "created_at")[:100]),
            "medals": [{"key": key, "label": label, "earned": earned} for key, label, earned in checks],
            "rules": "当前演示规则：今日卡组全部完成 +3、确认佩戴达到本人目标 +2、每篇答题通过 +2、每份就诊资料 +5、每周绘画 +1、日历补记 -10。勋章按累计 7 个记录日、核对 5 个动作、首次复查资料、4 个有记录的自然周、30 个支具达标日和 30 次完成训练判定。"}
