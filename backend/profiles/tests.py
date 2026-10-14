"""档案与身体测量测试（规格 v2.0 §3、§14、§18 T01）。

覆盖：建档只强制昵称、可跳过字段、身高体重历史不被覆盖、owner 隔离、
并发编辑保护与幂等去重。
"""

import shutil
from datetime import timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient, APITestCase

from core.errors import ErrorCode
from core.tests import failure, payload
from profiles.models import BodyMeasurement, Profile
from medical.models import MedicalAttachment

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
STORAGE_ROOT = Path(__file__).resolve().parents[2] / ".tmp" / "profile-medical"
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)


def make_user(name):
    user = get_user_model().objects.create_user(username=name, password="pw-for-tests")
    token, _ = Token.objects.get_or_create(user=user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return user, client


def make_avatar(client, filename="avatar.png"):
    intent = client.post(
        reverse("attachment-upload-intent"),
        {"purpose": "avatar", "filename": filename, "mime_type": "image/png", "size_bytes": len(PNG)},
        format="json",
    )
    data = payload(intent)
    client.post(
        data["upload_url"],
        {"file": SimpleUploadedFile(filename, PNG, content_type="image/png")},
        format="multipart",
    )
    client.post(reverse("attachment-complete", args=[data["id"]]), format="json")
    return data["id"]


@override_settings(PRIVATE_STORAGE_ROOT=STORAGE_ROOT)
class ProfileTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(STORAGE_ROOT, ignore_errors=True)

    def setUp(self):
        self.user, self.client = make_user("profile-owner")
        self.other, self.other_client = make_user("profile-other")

    # ---- 身份与建档状态 ----

    def test_me_before_profile_reports_no_profile(self):
        body = payload(self.client.get(reverse("me-identity")))
        self.assertFalse(body["has_profile"])
        self.assertIsNone(body["nickname"])
        self.assertEqual(body["id"], self.user.id)

    def test_me_does_not_leak_openid_or_token(self):
        body = payload(self.client.get(reverse("me-identity")))
        self.assertNotIn("openid", body)
        self.assertNotIn("token", body)

    def test_profile_before_creation_is_not_found(self):
        response = self.client.get(reverse("me-profile"))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(failure(response)["code"], ErrorCode.NOT_FOUND)

    def test_onboarding_requires_only_nickname(self):
        # T01：首次建档只强制昵称，其余字段可跳过。
        response = self.client.patch(reverse("me-profile"), {"nickname": "小林"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        body = payload(response)
        self.assertEqual(body["nickname"], "小林")
        self.assertIsNone(body["diagnosis_status"])
        self.assertEqual(body["management_methods"], [])
        self.assertEqual(body["revision"], 1)
        self.assertTrue(payload(self.client.get(reverse("me-identity")))["has_profile"])

    def test_nickname_is_required(self):
        response = self.client.patch(reverse("me-profile"), {"notes": "只有备注"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(failure(response)["code"], ErrorCode.VALIDATION_ERROR)

    def test_blank_nickname_is_rejected(self):
        response = self.client.patch(reverse("me-profile"), {"nickname": "   "}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_profile_completion_requires_owner_confirmed_ready_xray(self):
        profile = self.client.patch(reverse("me-profile"), {"nickname": "小林"}, format="json")
        self.assertEqual(profile.status_code, 200)
        url = reverse("me-profile-complete")
        missing = self.client.post(url, {}, format="json")
        self.assertEqual(missing.status_code, 409)
        self.assertEqual(failure(missing)["code"], ErrorCode.PROFILE_INCOMPLETE)

        visit = self.client.post(reverse("visit-list"), {"title": "小树档案影像"}, format="json")
        visit_id = payload(visit)["id"]
        # A report is not an X-ray image and cannot satisfy the gate.
        report_id = make_profile_attachment(self.client, "report.png")
        self.client.post(reverse("visit-bind-attachment", args=[visit_id]), {
            "attachment": report_id, "category": "imaging_report", "owner_confirmed_xray": True,
        }, format="json")
        still_missing = self.client.post(url, {}, format="json")
        self.assertEqual(still_missing.status_code, 409)

        xray_id = make_profile_attachment(self.client, "xray.png")
        bind = self.client.post(reverse("visit-bind-attachment", args=[visit_id]), {
            "attachment": xray_id, "category": "xray_image", "owner_confirmed_xray": True,
        }, format="json")
        self.assertEqual(bind.status_code, 201, bind.content)
        complete = self.client.post(url, {}, format="json")
        self.assertEqual(complete.status_code, 200, complete.content)
        self.assertEqual(payload(complete)["onboarding_status"], "complete")
        self.assertIsNotNone(payload(complete)["completed_at"])
        identity = payload(self.client.get(reverse("me-identity")))
        self.assertEqual(identity["onboarding_status"], "complete")

        # Replaying completion must not advance the profile revision or award repeatedly.
        revision = payload(complete)["revision"]
        replay = self.client.post(url, {}, format="json")
        self.assertEqual(payload(replay)["revision"], revision)

        # Removing the last qualifying image marks the profile for update, without deleting it.
        self.client.delete(reverse("attachment-detail", args=[xray_id]))
        self.assertEqual(Profile.objects.get(user=self.user).onboarding_status, "needs_update")
        self.assertTrue(Profile.objects.filter(user=self.user).exists())


def make_profile_attachment(client, filename):
    intent = client.post(reverse("attachment-upload-intent"), {
        "purpose": "medical", "filename": filename, "mime_type": "image/png", "size_bytes": len(PNG),
    }, format="json")
    data = payload(intent)
    client.post(data["upload_url"], {
        "file": SimpleUploadedFile(filename, PNG, content_type="image/png"),
    }, format="multipart")
    client.post(reverse("attachment-complete", args=[data["id"]]), format="json")
    return data["id"]

    def test_patch_me_is_equivalent_to_patch_profile(self):
        self.client.patch(reverse("me-profile"), {"nickname": "小林"}, format="json")
        response = self.client.patch(reverse("me-identity"), {"notes": "复诊前记录"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload(response)["notes"], "复诊前记录")

    def test_update_bumps_revision(self):
        self.client.patch(reverse("me-profile"), {"nickname": "小林"}, format="json")
        second = payload(self.client.patch(reverse("me-profile"), {"nickname": "小林2"}, format="json"))
        self.assertEqual(second["revision"], 2)

    def test_stale_expected_revision_is_refused(self):
        self.client.patch(reverse("me-profile"), {"nickname": "小林"}, format="json")
        # 另一台设备先改了一次，版本已经变成 2。
        self.client.patch(reverse("me-profile"), {"nickname": "小林2"}, format="json")
        response = self.client.patch(
            reverse("me-profile"), {"nickname": "小林3", "expected_revision": 1}, format="json"
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(failure(response)["code"], ErrorCode.REVISION_CONFLICT)
        self.assertEqual(Profile.objects.get(user=self.user).nickname, "小林2")

    # ---- 字段校验 ----

    def test_birth_month_format_and_future_are_rejected(self):
        bad_format = self.client.patch(
            reverse("me-profile"), {"nickname": "小林", "birth_month": "2011-13"}, format="json"
        )
        self.assertEqual(bad_format.status_code, 400)
        future = self.client.patch(
            reverse("me-profile"), {"nickname": "小林", "birth_month": "2099-01"}, format="json"
        )
        self.assertEqual(future.status_code, 400)

    def test_first_diagnosed_date_cannot_be_in_the_future(self):
        tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
        response = self.client.patch(
            reverse("me-profile"), {"nickname": "小林", "first_diagnosed_date": tomorrow}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_management_methods_are_controlled_and_deduplicated(self):
        unknown = self.client.patch(
            reverse("me-profile"),
            {"nickname": "小林", "management_methods": ["brace", "cupping"]},
            format="json",
        )
        self.assertEqual(unknown.status_code, 400)
        ok = payload(self.client.patch(
            reverse("me-profile"),
            {"nickname": "小林", "management_methods": ["brace", "brace", "physiotherapy"]},
            format="json",
        ))
        self.assertEqual(ok["management_methods"], ["brace", "physiotherapy"])

    def test_empty_diagnosis_status_is_normalised_to_null(self):
        body = payload(self.client.patch(
            reverse("me-profile"), {"nickname": "小林", "diagnosis_status": ""}, format="json"
        ))
        self.assertIsNone(body["diagnosis_status"])

    # ---- 头像 ----

    def test_avatar_must_be_owned_by_the_requester(self):
        foreign = make_avatar(self.other_client, "other.png")
        response = self.client.patch(
            reverse("me-profile"), {"nickname": "小林", "avatar": foreign}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(failure(response)["code"], ErrorCode.FORBIDDEN)

    def test_avatar_must_use_the_avatar_purpose(self):
        intent = self.client.post(
            reverse("attachment-upload-intent"),
            {"purpose": "medical", "filename": "xray.png", "mime_type": "image/png", "size_bytes": len(PNG)},
            format="json",
        )
        data = payload(intent)
        self.client.post(
            data["upload_url"],
            {"file": SimpleUploadedFile("xray.png", PNG, content_type="image/png")},
            format="multipart",
        )
        self.client.post(reverse("attachment-complete", args=[data["id"]]), format="json")
        response = self.client.patch(
            reverse("me-profile"), {"nickname": "小林", "avatar": data["id"]}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_avatar_must_be_ready(self):
        intent = self.client.post(
            reverse("attachment-upload-intent"),
            {"purpose": "avatar", "filename": "a.png", "mime_type": "image/png", "size_bytes": len(PNG)},
            format="json",
        )
        pending_id = payload(intent)["id"]
        response = self.client.patch(
            reverse("me-profile"), {"nickname": "小林", "avatar": pending_id}, format="json"
        )
        self.assertEqual(response.status_code, 409)

    def test_avatar_is_returned_with_a_signed_url(self):
        avatar_id = make_avatar(self.client)
        body = payload(self.client.patch(
            reverse("me-profile"), {"nickname": "小林", "avatar": avatar_id}, format="json"
        ))
        self.assertEqual(body["avatar"]["id"], avatar_id)
        self.assertIn("/attachments/", body["avatar"]["access_url"])

    # ---- 身体测量 ----

    def test_measurement_without_any_value_is_rejected(self):
        response = self.client.post(
            reverse("body-measurement-list"), {"measured_at": timezone.now().isoformat()}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_measurement_range_is_enforced(self):
        response = self.client.post(
            reverse("body-measurement-list"),
            {"measured_at": timezone.now().isoformat(), "height_cm": "12.0"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_measurement_in_the_future_is_rejected(self):
        later = (timezone.now() + timedelta(days=5)).isoformat()
        response = self.client.post(
            reverse("body-measurement-list"), {"measured_at": later, "height_cm": "160.0"}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_history_is_not_overwritten_and_latest_is_derived(self):
        older = (timezone.now() - timedelta(days=30)).isoformat()
        newer = (timezone.now() - timedelta(days=1)).isoformat()
        first = payload(self.client.post(
            reverse("body-measurement-list"),
            {"measured_at": older, "height_cm": "158.0"}, format="json",
        ))
        second = payload(self.client.post(
            reverse("body-measurement-list"),
            {"measured_at": newer, "height_cm": "160.5", "weight_kg": "48.0"}, format="json",
        ))
        self.client.patch(reverse("me-profile"), {"nickname": "小林"}, format="json")
        body = payload(self.client.get(reverse("me-profile")))
        # 两条历史都在，最新值由记录派生，旧值没被改写。
        self.assertEqual(BodyMeasurement.objects.filter(user=self.user).count(), 2)
        self.assertEqual(str(BodyMeasurement.objects.get(pk=first["id"]).height_cm), "158.0")
        self.assertEqual(float(body["latest_measurement"]["height_cm"]), 160.5)
        self.assertEqual(body["latest_measurement"]["measured_at"][:10], newer[:10])
        self.assertNotEqual(second["id"], first["id"])

    def test_measurements_are_isolated_per_user(self):
        self.client.post(
            reverse("body-measurement-list"),
            {"measured_at": timezone.now().isoformat(), "height_cm": "160.0"},
            format="json",
        )
        listing = payload(self.other_client.get(reverse("body-measurement-list")))
        self.assertEqual(listing, [])
        foreign_id = BodyMeasurement.objects.get(user=self.user).id
        self.assertEqual(
            self.other_client.patch(
                reverse("body-measurement-detail", args=[foreign_id]),
                {"height_cm": "170.0"},
                format="json",
            ).status_code,
            404,
        )

    def test_measurement_update_requires_fresh_revision(self):
        created = payload(self.client.post(
            reverse("body-measurement-list"),
            {"measured_at": timezone.now().isoformat(), "height_cm": "160.0"},
            format="json",
        ))
        endpoint = reverse("body-measurement-detail", args=[created["id"]])
        stale = self.client.patch(endpoint, {"height_cm": "161.0", "expected_revision": 99}, format="json")
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(failure(stale)["code"], ErrorCode.REVISION_CONFLICT)
        fresh = self.client.patch(endpoint, {"height_cm": "161.0", "expected_revision": 1}, format="json")
        self.assertEqual(fresh.status_code, 200)
        self.assertEqual(payload(fresh)["revision"], 2)

    def test_measurement_delete_removes_history_row(self):
        created = payload(self.client.post(
            reverse("body-measurement-list"),
            {"measured_at": timezone.now().isoformat(), "weight_kg": "48.0"},
            format="json",
        ))
        endpoint = reverse("body-measurement-detail", args=[created["id"]])
        self.assertEqual(self.client.delete(endpoint).status_code, 204)
        self.assertFalse(BodyMeasurement.objects.filter(pk=created["id"]).exists())

    def test_idempotency_key_deduplicates_retries(self):
        body = {"measured_at": timezone.now().isoformat(), "height_cm": "160.0"}
        first = self.client.post(
            reverse("body-measurement-list"), body, format="json", HTTP_IDEMPOTENCY_KEY="retry-1"
        )
        second = self.client.post(
            reverse("body-measurement-list"), body, format="json", HTTP_IDEMPOTENCY_KEY="retry-1"
        )
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(payload(first)["id"], payload(second)["id"])
        self.assertEqual(BodyMeasurement.objects.filter(user=self.user).count(), 1)

    def test_idempotency_key_reuse_with_different_payload_conflicts(self):
        self.client.post(
            reverse("body-measurement-list"),
            {"measured_at": timezone.now().isoformat(), "height_cm": "160.0"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="retry-2",
        )
        response = self.client.post(
            reverse("body-measurement-list"),
            {"measured_at": timezone.now().isoformat(), "height_cm": "199.0"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="retry-2",
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(failure(response)["code"], ErrorCode.IDEMPOTENCY_CONFLICT)

    def test_measurement_requires_authentication(self):
        response = APIClient().get(reverse("body-measurement-list"))
        self.assertEqual(response.status_code, 401)
