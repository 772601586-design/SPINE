from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone as dt_timezone
from threading import Barrier
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import close_old_connections
from django.test import TransactionTestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient, APITestCase

from .models import Brace, ComfortEntry, ComfortFollowUp, WearRevision, WearSession


PASSWORD = "Test-only-Strong-Password-927!"


class PersonalFlowTests(APITestCase):
    def setUp(self):
        self.a = get_user_model().objects.create_user("a", password=PASSWORD)
        self.b = get_user_model().objects.create_user("b", password=PASSWORD)
        self.token = Token.objects.create(user=self.a)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.token.key}")
        self.brace = Brace.objects.create(owner=self.a, name="A 的支具")
        self.other_brace = Brace.objects.create(owner=self.b, name="B 的支具")

    def create_interval(self, start="2026-10-01T23:30:00+08:00", end="2026-10-02T01:00:00+08:00", **extra):
        data = {"brace": self.brace.pk, "started_at": start, "ended_at": end, "request_id": str(uuid4()), **extra}
        return self.client.post("/api/v1/wear-sessions/", data, format="json")

    def test_login_me_logout_revokes_token(self):
        self.client.credentials()
        invalid = self.client.post("/api/v1/auth/login/", {"username": "a", "password": "wrong"})
        self.assertEqual(invalid.status_code, 400)
        response = self.client.post("/api/v1/auth/login/", {"username": "a", "password": PASSWORD})
        self.assertEqual(response.status_code, 200)
        token = response.data["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        self.assertEqual(self.client.get("/api/v1/auth/me/").data["username"], "a")
        self.assertEqual(self.client.post("/api/v1/auth/logout/").status_code, 204)
        for path in ("/api/v1/auth/me/", "/api/v1/braces/", "/api/v1/wear-sessions/", "/api/v1/comfort-entries/"):
            self.assertEqual(self.client.get(path).status_code, 401)
        relogin = self.client.post("/api/v1/auth/login/", {"username": "a", "password": PASSWORD})
        self.assertNotEqual(relogin.data["token"], token)

    def test_b_cannot_read_or_modify_any_a_record(self):
        wear = self.create_interval().data
        comfort = self.client.post("/api/v1/comfort-entries/", {
            "brace": self.brace.id, "wear_session": wear["id"], "pain": 0,
            "occurred_at": "2026-10-02T00:00:00+08:00", "request_id": str(uuid4()),
        }, format="json").data
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.create(user=self.b).key}")
        for resource, pk in (("braces", self.brace.id), ("wear-sessions", wear["id"]), ("comfort-entries", comfort["id"])):
            path = f"/api/v1/{resource}/{pk}/"
            self.assertEqual(self.client.get(path).status_code, 404)
            data = {"name": "stolen"} if resource == "braces" else (
                {"notes": "stolen", "version": 1, "reason": "stolen"} if resource == "wear-sessions" else {"pain": 10})
            self.assertEqual(self.client.patch(path, data, format="json").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/wear-sessions/").data, [])
        self.assertEqual([brace["id"] for brace in self.client.get("/api/v1/braces/").data], [self.other_brace.id])
        self.assertEqual(self.client.get("/api/v1/comfort-entries/").data, [])
        self.assertEqual(self.client.get("/api/v1/wear-sessions/statistics/").data["days"], [])
        self.assertEqual(self.client.get(f'/api/v1/wear-sessions/{wear["id"]}/revisions/').status_code, 404)
        self.assertEqual(self.client.post(f'/api/v1/wear-sessions/{wear["id"]}/end/', {}, format="json").status_code, 404)
        self.assertEqual(self.client.post("/api/v1/wear-sessions/start/", {"brace": self.brace.id, "request_id": str(uuid4())}, format="json").status_code, 404)
        bad = self.client.post("/api/v1/comfort-entries/", {
            "brace": self.other_brace.id, "wear_session": wear["id"], "occurred_at": "2026-10-02T00:00:00+08:00", "request_id": str(uuid4()),
        }, format="json")
        self.assertEqual(bad.status_code, 400)
        self.brace.refresh_from_db()
        self.assertEqual(self.brace.name, "A 的支具")
        self.assertEqual(ComfortEntry.objects.get(pk=comfort["id"]).pain, 0)

    def test_duplicate_start_end_and_state_restore(self):
        request_id = str(uuid4())
        payload = {"brace": self.brace.id, "request_id": request_id, "started_at": "2026-10-03T09:00:00+08:00"}
        first = self.client.post("/api/v1/wear-sessions/start/", payload, format="json")
        repeat = self.client.post("/api/v1/wear-sessions/start/", payload, format="json")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(repeat.status_code, 200)
        self.assertEqual(first.data["id"], repeat.data["id"])
        self.assertEqual(self.client.get("/api/v1/wear-sessions/").data[0]["ended_at"], None)
        another = self.client.post("/api/v1/wear-sessions/start/", {**payload, "request_id": str(uuid4())}, format="json")
        self.assertEqual(another.status_code, 409)
        endpoint = f'/api/v1/wear-sessions/{first.data["id"]}/end/'
        end = {"ended_at": "2026-10-03T10:00:00+08:00"}
        self.assertEqual(self.client.post(endpoint, end, format="json").status_code, 200)
        self.assertEqual(self.client.post(endpoint, end, format="json").status_code, 200)
        self.assertEqual(self.client.post(endpoint, {}, format="json").status_code, 200)
        self.assertEqual(self.client.post(endpoint, {"ended_at": "2026-10-03T11:00:00+08:00"}, format="json").status_code, 409)
        self.assertEqual(WearSession.objects.count(), 1)
        self.assertEqual(WearRevision.objects.count(), 1)

    def test_illegal_intervals_and_idempotency_conflict(self):
        response = self.create_interval()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.create_interval("2026-10-02T00:00:00+08:00", "2026-10-02T02:00:00+08:00").status_code, 409)
        self.assertEqual(self.create_interval("2026-10-01T22:00:00+08:00", "2026-10-02T02:00:00+08:00").status_code, 409)
        self.assertEqual(self.create_interval("2026-10-03T10:00:00+08:00", "2026-10-03T09:00:00+08:00").status_code, 400)
        self.assertEqual(self.create_interval("2026-10-03T10:00:00+08:00", "2026-10-03T10:00:00+08:00").status_code, 400)
        future = (datetime.now(dt_timezone.utc) + timedelta(days=1)).isoformat()
        self.assertEqual(self.create_interval(future, future).status_code, 400)
        self.assertEqual(self.create_interval("2026-10-02T01:00:00+08:00", "2026-10-02T02:00:00+08:00").status_code, 201)
        original = WearSession.objects.get(pk=response.data["id"])
        self.assertEqual(self.create_interval(request_id=str(original.request_id)).status_code, 200)
        self.assertEqual(self.create_interval("2026-10-04T00:00:00+08:00", "2026-10-04T01:00:00+08:00", request_id=str(original.request_id)).status_code, 409)

    def test_cross_midnight_correction_statistics_and_history(self):
        response = self.create_interval()
        days = {day["date"]: day["minutes"] for day in self.client.get("/api/v1/wear-sessions/statistics/").data["days"]}
        self.assertEqual(days, {"2026-10-01": 30, "2026-10-02": 60})
        endpoint = f'/api/v1/wear-sessions/{response.data["id"]}/'
        values = {"ended_at": "2026-10-02T02:00:00+08:00", "version": 1, "reason": "补正漏记"}
        revised = self.client.patch(endpoint, values, format="json")
        self.assertEqual(revised.status_code, 200)
        self.assertEqual(revised.data["version"], 2)
        self.assertEqual(self.client.patch(endpoint, values, format="json").status_code, 200)
        self.assertEqual(self.client.patch(endpoint, {**values, "ended_at": "2026-10-02T03:00:00+08:00"}, format="json").status_code, 409)
        days = {day["date"]: day["minutes"] for day in self.client.get("/api/v1/wear-sessions/statistics/").data["days"]}
        self.assertEqual(days, {"2026-10-01": 30, "2026-10-02": 120})
        revisions = self.client.get(endpoint + "revisions/").data
        self.assertEqual(len(revisions), 1)
        self.assertEqual(revisions[0]["reason"], "补正漏记")
        self.assertNotEqual(revisions[0]["before"]["ended_at"], revisions[0]["after"]["ended_at"])
        self.assertEqual(self.client.patch(endpoint, {"started_at": "2026-10-02T03:00:00+08:00", "version": 2, "reason": "非法"}, format="json").status_code, 400)
        self.assertEqual(WearRevision.objects.count(), 1)

    def test_correction_cannot_overlap_or_leave_two_open_sessions(self):
        first = self.create_interval("2026-10-03T09:00:00+08:00", "2026-10-03T10:00:00+08:00").data
        second = self.create_interval("2026-10-03T11:00:00+08:00", "2026-10-03T12:00:00+08:00").data
        path = f'/api/v1/wear-sessions/{first["id"]}/'
        self.assertEqual(self.client.patch(path, {"ended_at": "2026-10-03T11:30:00+08:00", "version": 1, "reason": "重叠"}, format="json").status_code, 409)
        second_path = f'/api/v1/wear-sessions/{second["id"]}/'
        self.assertEqual(self.client.patch(second_path, {"ended_at": None, "version": 1, "reason": "恢复未结束"}, format="json").status_code, 200)
        self.assertEqual(self.client.patch(path, {"ended_at": None, "version": 1, "reason": "重复未结束"}, format="json").status_code, 409)
        self.assertEqual(WearSession.objects.filter(ended_at__isnull=True).count(), 1)
        self.assertEqual(WearRevision.objects.count(), 1)

    def test_comfort_null_zero_range_association_and_retry(self):
        wear = self.create_interval().data
        data = {"brace": self.brace.id, "wear_session": wear["id"], "positions": ["腰部"], "tags": ["摩擦"],
                "occurred_at": "2026-10-02T00:00:00+08:00", "notes": "测试", "request_id": str(uuid4())}
        empty = self.client.post("/api/v1/comfort-entries/", data, format="json")
        self.assertEqual(empty.status_code, 201)
        self.assertIsNone(empty.data["pain"])
        self.assertEqual(self.client.post("/api/v1/comfort-entries/", data, format="json").status_code, 200)
        zero = self.client.post("/api/v1/comfort-entries/", {**data, "request_id": str(uuid4()), "pain": 0}, format="json")
        self.assertEqual(zero.status_code, 201)
        self.assertEqual(zero.data["pain"], 0)
        for pain in (-1, 11):
            self.assertEqual(self.client.post("/api/v1/comfort-entries/", {**data, "request_id": str(uuid4()), "pain": pain}, format="json").status_code, 400)
        second = Brace.objects.create(owner=self.a, name="另一支具")
        self.assertEqual(self.client.post("/api/v1/comfort-entries/", {**data, "brace": second.id, "request_id": str(uuid4())}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/v1/comfort-entries/", {**data, "request_id": str(uuid4()), "brace": self.other_brace.id}, format="json").status_code, 400)
        self.assertEqual(ComfortEntry.objects.count(), 2)

    def test_comfort_level_pain_note_follow_up_and_brace_scoped_statistics(self):
        wear = self.client.post("/api/v1/wear-sessions/start/", {
            "brace": self.brace.id, "request_id": str(uuid4()),
            "started_at": "2026-10-05T09:00:00+08:00",
        }, format="json").data
        base = {
            "brace": self.brace.id, "wear_session": wear["id"], "comfort_level": 2,
            "pain_note": "", "positions": ["腰部"], "tags": ["压迫"],
            "occurred_at": "2026-10-05T09:15:00+08:00", "request_id": str(uuid4()),
        }
        response = self.client.post("/api/v1/comfort-entries/", base, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["comfort_level"], 2)
        self.assertEqual(response.data["pain_note"], "")
        self.assertIsNone(response.data["pain"])
        follow_up_data = {
            "entry": response.data["id"], "status": "improved",
            "occurred_at": "2026-10-05T10:00:00+08:00", "notes": "休息后缓解",
            "request_id": str(uuid4()),
        }
        follow_up = self.client.post("/api/v1/comfort-follow-ups/", follow_up_data, format="json")
        self.assertEqual(follow_up.status_code, 201)
        repeat = self.client.post("/api/v1/comfort-follow-ups/", follow_up_data, format="json")
        self.assertEqual(repeat.status_code, 200)
        self.assertEqual(repeat.data["id"], follow_up.data["id"])
        self.assertEqual(ComfortFollowUp.objects.count(), 1)
        self.assertEqual(self.client.get(f'/api/v1/comfort-follow-ups/?entry={response.data["id"]}').data[0]["status"], "improved")
        own_empty_brace = Brace.objects.create(owner=self.a, name="A 的另一支具")
        self.assertEqual(self.client.get(f"/api/v1/wear-sessions/statistics/?brace={own_empty_brace.id}").data["days"], [])

        self.client.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.create(user=self.b).key}")
        self.assertEqual(self.client.get("/api/v1/comfort-follow-ups/").data, [])
        denied = self.client.post("/api/v1/comfort-follow-ups/", {
            "entry": response.data["id"], "status": "worsened",
            "occurred_at": "2026-10-05T10:00:00+08:00", "request_id": str(uuid4()),
        }, format="json")
        self.assertEqual(denied.status_code, 400)

    def test_cannot_deactivate_brace_with_open_wear(self):
        response = self.client.post("/api/v1/wear-sessions/start/", {
            "brace": self.brace.id, "request_id": str(uuid4()),
        }, format="json")
        self.assertEqual(response.status_code, 201)
        deactivate = self.client.patch(f"/api/v1/braces/{self.brace.id}/", {"is_active": False}, format="json")
        self.assertEqual(deactivate.status_code, 400)
        self.assertEqual(self.client.get(f"/api/v1/braces/{self.brace.id}/").data["is_active"], True)
        self.assertEqual(self.client.post(f"/api/v1/wear-sessions/{response.data['id']}/end/", {}, format="json").status_code, 200)
        deactivate = self.client.patch(f"/api/v1/braces/{self.brace.id}/", {"is_active": False}, format="json")
        self.assertEqual(deactivate.status_code, 200)


class ConcurrentWearTests(TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(f"concurrent-{uuid4().hex}", password=PASSWORD)
        self.token = Token.objects.create(user=self.user).key
        self.brace = Brace.objects.create(owner=self.user, name="并发支具")

    def concurrent(self, endpoint, payloads):
        barrier = Barrier(2)

        def send(payload):
            close_old_connections()
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f"Token {self.token}")
            try:
                barrier.wait(timeout=10)
                response = client.post(endpoint, payload, format="json")
                return response.status_code, response.data
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            return list(executor.map(send, payloads))

    def test_simultaneous_start_and_end_are_consistent(self):
        payload = {"brace": self.brace.id, "request_id": str(uuid4()), "started_at": "2026-10-03T09:00:00+08:00"}
        results = self.concurrent("/api/v1/wear-sessions/start/", [payload, payload])
        self.assertEqual(sorted(code for code, _ in results), [200, 201])
        self.assertEqual(WearSession.objects.count(), 1)
        session = WearSession.objects.get()
        end = {"ended_at": "2026-10-03T10:00:00+08:00"}
        results = self.concurrent(f"/api/v1/wear-sessions/{session.id}/end/", [end, end])
        self.assertEqual([code for code, _ in results], [200, 200])
        self.assertEqual(WearRevision.objects.count(), 1)

    def test_simultaneous_overlapping_backfills_only_save_one(self):
        payload = {"brace": self.brace.id, "started_at": "2026-10-03T09:00:00+08:00", "ended_at": "2026-10-03T10:00:00+08:00"}
        results = self.concurrent("/api/v1/wear-sessions/", [{**payload, "request_id": str(uuid4())}, {**payload, "request_id": str(uuid4())}])
        self.assertEqual(sorted(code for code, _ in results), [201, 409])
        self.assertEqual(WearSession.objects.count(), 1)

    def test_simultaneous_distinct_start_requests_only_save_one(self):
        data = {"brace": self.brace.id, "started_at": "2026-10-03T09:00:00+08:00"}
        results = self.concurrent("/api/v1/wear-sessions/start/", [{**data, "request_id": str(uuid4())}, {**data, "request_id": str(uuid4())}])
        self.assertEqual(sorted(code for code, _ in results), [201, 409])
        self.assertEqual(WearSession.objects.count(), 1)
