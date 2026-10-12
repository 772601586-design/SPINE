from unittest.mock import patch

from django.db import OperationalError
from django.test import SimpleTestCase
from django.urls import reverse
from rest_framework.test import APIClient


class InfrastructureTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def test_health_requires_no_database(self):
        response = self.client.get(reverse("health"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["service"], "spine-backend")
        self.assertEqual(response.json()["api_version"], "v1")

    @patch("core.views.connection")
    def test_readiness_returns_503_without_disclosing_database_error(self, database):
        database.cursor.side_effect = OperationalError("sensitive connection details")
        response = self.client.get(reverse("ready"))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "unavailable", "database": "unavailable"})

    @patch("core.views.connection")
    def test_readiness_checks_database(self, database):
        cursor = database.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (1,)
        response = self.client.get(reverse("ready"))
        cursor.execute.assert_called_once_with("SELECT 1")
        self.assertEqual(response.status_code, 200)

    def test_openapi_describes_both_endpoints(self):
        response = self.client.get(reverse("schema"))
        self.assertEqual(response.status_code, 200)
        schema = response.json()
        self.assertTrue(schema["openapi"].startswith("3."))
        self.assertIn("/api/v1/health/", schema["paths"])
        self.assertIn("503", schema["paths"]["/api/v1/ready/"]["get"]["responses"])

    def test_allowed_browser_origin(self):
        response = self.client.get(reverse("health"), HTTP_ORIGIN="http://localhost:5173")
        self.assertEqual(response["Access-Control-Allow-Origin"], "http://localhost:5173")
