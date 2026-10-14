from django.core.exceptions import ValidationError
from rest_framework.test import APITestCase

from .models import Exercise, ExerciseVersion, Goal, Muscle, Region


class ExerciseCatalogTests(APITestCase):
    def setUp(self):
        self.region, _ = Region.objects.get_or_create(code="test_back", defaults={"name": "测试区域"})
        self.muscle, _ = Muscle.objects.get_or_create(code="multifidus", defaults={"name": "测试肌群"})
        self.other_muscle, _ = Muscle.objects.get_or_create(code="trapezius", defaults={"name": "测试关联肌群"})
        self.goal, _ = Goal.objects.get_or_create(code="stability", defaults={"name": "测试目标"})
        exercise = Exercise.objects.create()
        published = ExerciseVersion.objects.create(
            exercise=exercise, version=1, status=ExerciseVersion.PUBLISHED, name="Reviewed sample",
            category=Exercise.GENERAL[0], author="Original source", source_url="https://example.org/action",
            license_basis="authorized test fixture", reviewer="内容审核", reviewed_at="2026-10-01",
        )
        published.regions.add(self.region)
        published.primary_muscles.add(self.muscle)
        published.secondary_muscles.add(self.other_muscle)
        published.goals.add(self.goal)
        draft_exercise = Exercise.objects.create()
        ExerciseVersion.objects.create(exercise=draft_exercise, version=1, status=ExerciseVersion.DRAFT, name="Draft sample")

    def test_taxonomy_contains_muscle_filter_terms(self):
        response = self.client.get("/api/v1/exercise-taxonomy/")
        self.assertEqual(response.status_code, 200)
        body = response.json()["data"]
        self.assertIn("multifidus", [row["code"] for row in body["muscles"]])

    def test_catalog_only_exposes_reviewed_published_resources(self):
        response = self.client.get("/api/v1/exercises/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["name"] for row in response.json()["data"]], ["Reviewed sample"])

    def test_muscle_filter_returns_only_matching_resources(self):
        response = self.client.get("/api/v1/exercises/", {"muscle": "multifidus"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"][0]["primary_muscles"][0]["code"], "multifidus")
        response = self.client.get("/api/v1/exercises/", {"muscle": "trapezius"})
        secondary_response = self.client.get("/api/v1/exercises/", {"muscle": "trapezius"})
        self.assertEqual([row["name"] for row in secondary_response.json()["data"]], ["Reviewed sample"])

    def test_published_resource_version_cannot_be_edited_in_place(self):
        published = ExerciseVersion.objects.get(name="Reviewed sample")
        published.name = "Changed after review"
        with self.assertRaises(ValidationError):
            published.save()
