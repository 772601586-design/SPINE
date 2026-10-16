from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .models import PersonalActionCard, PlanVersion, SetExecution, TrainingAttempt, TrainingPlan
from .scheduler import today_deck


class DailyDeckTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="deck-owner")
        self.other = get_user_model().objects.create_user(username="deck-other")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.plan = TrainingPlan.objects.create(owner=self.user, current_version_no=1)
        self.version = PlanVersion.objects.create(plan=self.plan, version_no=1)
        self.now = datetime(2026, 10, 15, 12, tzinfo=ZoneInfo("Asia/Shanghai"))

    def card(self, frequency="daily", **kwargs):
        values = dict(owner=self.user, plan=self.plan, name="个人动作", sets=2, reps_per_set=5,
                      side="not_applicable", schedule_frequency=frequency, verification_status=PersonalActionCard.READY)
        values.update(kwargs)
        return PersonalActionCard.objects.create(**values)

    def record(self, card, when, status=TrainingAttempt.COMPLETED, count=2, ended=None):
        attempt = TrainingAttempt.objects.create(owner=self.user, plan=self.plan, plan_version=self.version,
            card=card, card_revision=card.revision, planned_dose=card.dose_snapshot(),
            status=status, ended_at=ended or when)
        for index in range(1, count + 1):
            execution = SetExecution.objects.create(owner=self.user, attempt=attempt, set_index=index, actual_reps=5)
            SetExecution.objects.filter(pk=execution.pk).update(confirmed_at=when)
        return attempt

    def ids(self, deck):
        return [item["card"].pk for item in deck["cards"]]

    def test_unconfigured_cards_are_not_silently_scheduled(self):
        self.card("")
        self.card("daily", verification_status=PersonalActionCard.NEEDS_CHECK)
        deck = today_deck(self.user, self.now)
        self.assertEqual(deck["cards"], [])
        self.assertEqual(deck["unconfigured_count"], 1)
        self.assertEqual(deck["needs_setup_count"], 1)

    def test_daily_and_never_done_alternate_follow_personal_order(self):
        second = self.card("daily", order=2)
        first = self.card("alternate", order=1)
        self.card("daily", active=False)
        deck = today_deck(self.user, self.now)
        self.assertEqual(self.ids(deck), [first.pk, second.pk])
        self.assertEqual(deck["remaining_count"], 2)

    def test_alternate_completed_yesterday_rests_today_and_returns_tomorrow(self):
        card = self.card("alternate")
        self.record(card, self.now - timedelta(days=1))
        deck = today_deck(self.user, self.now)
        self.assertEqual(deck["cards"], [])
        self.assertEqual(deck["rest_count"], 1)
        self.assertEqual(deck["tomorrow"], [{"id": card.pk, "name": card.name}])

    def test_alternate_completed_two_days_ago_returns_and_missed_day_rolls_forward(self):
        card = self.card("alternate")
        self.record(card, self.now - timedelta(days=2))
        self.assertEqual(self.ids(today_deck(self.user, self.now)), [card.pk])
        self.assertEqual(self.ids(today_deck(self.user, self.now + timedelta(days=1))), [card.pk])

    def test_today_completion_is_visible_once_and_updates_tomorrow(self):
        alternate = self.card("alternate")
        daily = self.card("daily")
        self.record(alternate, self.now - timedelta(minutes=1))
        self.record(daily, self.now - timedelta(minutes=1))
        deck = today_deck(self.user, self.now)
        self.assertEqual(deck["done_count"], 2)
        self.assertEqual(deck["remaining_count"], 0)
        self.assertEqual([item["completed_sets_today"] for item in deck["cards"]], [2, 2])
        self.assertEqual([item["id"] for item in deck["tomorrow"]], [daily.pk])

    def test_partial_and_unfinished_attempts_do_not_count_as_full_completion(self):
        card = self.card("alternate")
        self.record(card, self.now - timedelta(days=1), status=TrainingAttempt.PARTIAL, count=1)
        self.record(card, self.now - timedelta(minutes=1), status=TrainingAttempt.PAUSED, count=1)
        deck = today_deck(self.user, self.now)
        self.assertEqual(self.ids(deck), [card.pk])
        self.assertFalse(deck["cards"][0]["done"])
        self.assertEqual(deck["cards"][0]["completed_sets_today"], 1)
        self.assertEqual(deck["open_attempt"]["status"], "paused")

    def test_completion_uses_final_set_date_not_later_finish_button(self):
        card = self.card("alternate")
        # Finishing today must not turn yesterday's final set into a new training day.
        self.record(card, self.now - timedelta(days=1), ended=self.now - timedelta(minutes=1))
        self.assertEqual(today_deck(self.user, self.now)["rest_count"], 1)

    def test_shanghai_midnight_changes_completion_day(self):
        card = self.card("daily")
        completed = datetime(2026, 10, 14, 16, 5, tzinfo=ZoneInfo("UTC"))
        self.record(card, completed)
        deck = today_deck(self.user, self.now)
        self.assertTrue(deck["cards"][0]["done"])
        self.assertEqual(deck["cards"][0]["completed_sets_today"], 2)
        next_day = today_deck(self.user, self.now + timedelta(days=1))
        self.assertFalse(next_day["cards"][0]["done"])
        self.assertEqual(next_day["cards"][0]["completed_sets_today"], 0)

    def test_plan_status_and_date_bounds_are_respected(self):
        self.card()
        self.plan.start_date = self.now.date() + timedelta(days=1)
        self.plan.save()
        deck = today_deck(self.user, self.now)
        self.assertFalse(deck["available"])
        self.assertEqual(len(deck["tomorrow"]), 1)
        self.plan.start_date = None
        self.plan.end_date = self.now.date() - timedelta(days=1)
        self.plan.save()
        self.assertEqual(today_deck(self.user, self.now)["cards"], [])
        self.plan.end_date = None
        self.plan.status = TrainingPlan.PAUSED
        self.plan.save()
        self.assertEqual(today_deck(self.user, self.now)["cards"], [])

    def test_api_uses_server_date_and_filters_by_owner(self):
        card = self.card()
        with patch("training.scheduler.timezone.now", return_value=self.now):
            response = self.client.get("/api/v1/training/today/?date=1900-01-01")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["date"], "2026-10-15")
        self.assertEqual(response.data["cards"][0]["card"]["id"], card.pk)
        self.client.force_authenticate(self.other)
        other = self.client.get("/api/v1/training/today/")
        self.assertEqual(other.data["cards"], [])
        self.assertIsNone(other.data["plan_id"])
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/v1/training/today/").status_code, 401)

    def test_schedule_update_is_validated_versioned_and_keeps_history(self):
        card = self.card("")
        attempt = self.record(card, self.now - timedelta(days=1))
        endpoint = f"/api/v1/training/cards/{card.pk}/"
        invalid = self.client.patch(endpoint, {"expected_revision": 1, "schedule_frequency": "by_module"}, format="json")
        self.assertEqual(invalid.status_code, 400)
        response = self.client.patch(endpoint, {
            "expected_revision": 1, "schedule_frequency": "alternate", "confirm_parameters": True,
        }, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data["schedule_frequency"], "alternate")
        self.assertEqual(response.data["revision"], 2)
        attempt.refresh_from_db()
        self.assertEqual(attempt.planned_dose["schedule_frequency"], "")
        self.assertEqual(attempt.sets_done.count(), 2)
        self.assertEqual(card.history.latest("revision").snapshot["schedule_frequency"], "alternate")

    def test_real_api_checkin_and_finish_retry_count_one_completion(self):
        card = self.card("alternate", sets=1)
        with patch("training.scheduler.timezone.now", return_value=self.now):
            started = self.client.post("/api/v1/training/attempts/start/", {"card_id": card.pk}, format="json")
            self.assertEqual(started.status_code, 201, started.content)
            attempt_id = started.data["id"]
            payload = {"set_index": 1, "actual_reps": 5, "client_request_id": "00000000-0000-4000-8000-000000000001"}
            endpoint = f"/api/v1/training/attempts/{attempt_id}/complete-set/"
            self.assertEqual(self.client.post(endpoint, payload, format="json").status_code, 201)
            self.assertEqual(self.client.post(endpoint, payload, format="json").status_code, 200)
            finish = f"/api/v1/training/attempts/{attempt_id}/finish/"
            self.assertEqual(self.client.post(finish, {}, format="json").status_code, 200)
            self.assertEqual(self.client.post(finish, {}, format="json").status_code, 200)
            deck = self.client.get("/api/v1/training/today/").data
        self.assertEqual(deck["done_count"], 1)
        self.assertEqual(deck["cards"][0]["completed_sets_today"], 1)
        self.assertEqual(deck["tomorrow"], [])
        self.assertIsNone(deck["open_attempt"])
