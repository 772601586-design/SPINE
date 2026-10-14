import uuid
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from braces.models import Brace, WearSession
from exercises.models import Exercise, ExerciseVersion
from .models import (PersonalActionCard, PlanVersion, SetExecution, TrainingAttempt,
                     TrainingPlan)
from .services import brace_training_prompt


class TrainingFlowTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(username="training-owner", password="test-password")
        self.other = user_model.objects.create_user(username="training-other", password="test-password")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        exercise = Exercise.objects.create()
        self.source = ExerciseVersion.objects.create(
            exercise=exercise, version=1, status=ExerciseVersion.PUBLISHED, name="Catalog action",
            category=Exercise.GENERAL[0], author="Source author", source_url="https://example.org/action",
            reviewer="reviewer", reviewed_at=date(2026, 10, 1), license_basis="authorized test fixture",
        )

    def add_card(self):
        return self.client.post("/api/v1/training/cards/from-exercise/", {"exercise_version_id": self.source.pk}, format="json")

    def test_add_from_library_is_idempotent_and_card_is_private(self):
        first = self.add_card()
        again = self.add_card()
        self.assertEqual(first.status_code, 201)
        self.assertEqual(again.status_code, 200)
        self.assertEqual(first.data["id"], again.data["id"])
        self.assertEqual(PersonalActionCard.objects.filter(owner=self.user).count(), 1)
        catalog = self.client.get("/api/v1/exercises/")
        self.assertTrue(catalog.json()["data"][0]["already_added"])

        card_id = first.data["id"]
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f"/api/v1/training/cards/{card_id}/").status_code, 404)
        self.assertEqual(self.client.patch(f"/api/v1/training/cards/{card_id}/", {"expected_revision": 1, "name": "stolen"}, format="json").status_code, 404)

    def test_card_requires_user_settings_before_attempt_and_set_is_idempotent(self):
        card = self.add_card().data
        rejected = self.client.post("/api/v1/training/attempts/start/", {"card_id": card["id"]}, format="json")
        self.assertEqual(rejected.status_code, 400)

        updated = self.client.patch(f"/api/v1/training/cards/{card['id']}/", {
            "expected_revision": card["revision"], "sets": 3, "reps_per_set": 5,
            "side": "not_applicable", "confirm_parameters": True,
        }, format="json")
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["verification_status"], PersonalActionCard.READY)
        started = self.client.post("/api/v1/training/attempts/start/", {"card_id": card["id"]}, format="json")
        self.assertEqual(started.status_code, 201)
        attempt_id = started.data["id"]
        request_id = str(uuid.uuid4())
        payload = {"set_index": 1, "client_request_id": request_id, "actual_reps": 4}
        first = self.client.post(f"/api/v1/training/attempts/{attempt_id}/complete-set/", payload, format="json")
        retry = self.client.post(f"/api/v1/training/attempts/{attempt_id}/complete-set/", payload, format="json")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(first.data["id"], retry.data["id"])
        self.assertEqual(SetExecution.objects.filter(attempt_id=attempt_id).count(), 1)
        finished = self.client.post(f"/api/v1/training/attempts/{attempt_id}/finish/", {}, format="json")
        self.assertEqual(finished.data["status"], TrainingAttempt.PARTIAL)

    def test_plan_snapshots_preserve_personal_card_changes(self):
        card = self.add_card().data
        plan = TrainingPlan.objects.get(pk=card["plan"])
        first = PlanVersion.objects.get(plan=plan, version_no=plan.current_version_no)
        self.client.patch(f"/api/v1/training/cards/{card['id']}/", {
            "expected_revision": card["revision"], "sets": 2, "reps_per_set": 8,
            "side": "left", "confirm_parameters": True,
        }, format="json")
        plan.refresh_from_db()
        second = PlanVersion.objects.get(plan=plan, version_no=plan.current_version_no)
        self.assertNotEqual(first.pk, second.pk)
        self.assertEqual(first.snapshot["cards"][0]["dose"]["sets"], None)
        self.assertEqual(second.snapshot["cards"][0]["dose"]["sets"], 2)

    def test_brace_training_prompt_requires_ready_card_and_is_one_event(self):
        plan = TrainingPlan.objects.create(owner=self.user, status=TrainingPlan.ACTIVE)
        brace = Brace.objects.create(owner=self.user, name="Test brace")
        interval = WearSession.objects.create(owner=self.user, brace=brace, started_at=timezone.now(),
            ended_at=timezone.now() + timedelta(minutes=20), request_id=uuid.uuid4(), initial_payload="test")
        no_ready_card = brace_training_prompt(interval)
        self.assertFalse(no_ready_card["eligible"])

        # A second completed interval for the eligible case must be distinct and confirmed.
        interval2 = WearSession.objects.create(owner=self.user, brace=brace, started_at=timezone.now() + timedelta(hours=1),
            ended_at=timezone.now() + timedelta(hours=1, minutes=20), request_id=uuid.uuid4(), initial_payload="test2")
        PersonalActionCard.objects.create(owner=self.user, plan=plan, source_version=self.source, name="Ready", sets=1,
            reps_per_set=1, side="not_applicable", verification_status=PersonalActionCard.READY)
        prompted = brace_training_prompt(interval2)
        self.assertTrue(prompted["eligible"])
        self.assertEqual(brace_training_prompt(interval2)["prompt_id"], prompted["prompt_id"])
