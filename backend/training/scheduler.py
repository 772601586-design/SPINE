"""Personal daily decks. Frequencies are explicitly entered, never inferred from a module or stage."""

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db.models import Count, Max
from django.utils import timezone

from .models import PersonalActionCard, SetExecution, TrainingAttempt, TrainingPlan
from .services import current_plan

DECK_TIMEZONE = ZoneInfo("Asia/Shanghai")


def is_due(frequency, last_completed, day):
    if frequency == PersonalActionCard.ScheduleFrequency.DAILY:
        return True
    if frequency == PersonalActionCard.ScheduleFrequency.ALTERNATE:
        return last_completed is None or last_completed == day or (day - last_completed).days >= 2
    return False


def plan_available(plan, day):
    return bool(plan and plan.status == TrainingPlan.ACTIVE
                and (not plan.start_date or plan.start_date <= day)
                and (not plan.end_date or day <= plan.end_date))


def today_deck(user, now=None):
    now = now or timezone.now()
    day = timezone.localdate(now, DECK_TIMEZONE)
    tomorrow = day + timedelta(days=1)
    start = datetime.combine(day, time.min, tzinfo=DECK_TIMEZONE)
    end = start + timedelta(days=1)
    plan = current_plan(user)
    open_attempt = TrainingAttempt.objects.filter(
        owner=user, status__in=[TrainingAttempt.IN_PROGRESS, TrainingAttempt.PAUSED]
    ).select_related("card").first()
    result = {
        "date": day, "timezone": str(DECK_TIMEZONE),
        "plan_id": plan.pk if plan else None, "plan_title": plan.title if plan else "",
        "plan_status": plan.status if plan else "no_plan", "available": plan_available(plan, day),
        "cards": [], "tomorrow": [], "done_count": 0, "remaining_count": 0, "rest_count": 0,
        "unconfigured_count": 0, "needs_setup_count": 0,
        "open_attempt": {"id": open_attempt.pk, "card_name": open_attempt.card.name,
                         "status": open_attempt.status} if open_attempt else None,
    }
    if not plan:
        return result
    cards = list(plan.cards.filter(owner=user, active=True).select_related("source_version").order_by("order", "id"))
    # Completion belongs to the local date of the final confirmed set, not the date a user
    # later taps Finish. Partial attempts still contribute actual records, but never reset rest days.
    completions = TrainingAttempt.objects.filter(
        owner=user, plan=plan, status=TrainingAttempt.COMPLETED, ended_at__lte=now,
    ).values("card_id").annotate(last_set_at=Max("sets_done__confirmed_at"))
    last_done = {item["card_id"]: timezone.localdate(item["last_set_at"], DECK_TIMEZONE)
                 for item in completions if item["last_set_at"]}
    counts = SetExecution.objects.filter(
        owner=user, attempt__owner=user, attempt__plan=plan,
        confirmed_at__gte=start, confirmed_at__lt=end, confirmed_at__lte=now,
    ).values("attempt__card_id").annotate(total=Count("pk"))
    today_counts = {item["attempt__card_id"]: item["total"] for item in counts}
    for card in cards:
        if not card.schedule_frequency:
            result["unconfigured_count"] += 1
            continue
        if card.verification_status != PersonalActionCard.READY:
            result["needs_setup_count"] += 1
            continue
        completed = last_done.get(card.pk)
        if result["available"]:
            if is_due(card.schedule_frequency, completed, day):
                result["cards"].append({"card": card, "done": completed == day,
                                        "completed_sets_today": today_counts.get(card.pk, 0)})
            else:
                result["rest_count"] += 1
        if plan_available(plan, tomorrow) and is_due(card.schedule_frequency, completed, tomorrow):
            result["tomorrow"].append({"id": card.pk, "name": card.name})
    result["done_count"] = sum(item["done"] for item in result["cards"])
    result["remaining_count"] = len(result["cards"]) - result["done_count"]
    return result
