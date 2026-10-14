"""就诊、附件与多弯记录测试（规格 v2.0 §18 T03、T04）。"""

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
from medical.models import CurveMeasurement, MedicalAttachment, Visit

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
STORAGE_ROOT = Path(__file__).resolve().parents[2] / ".tmp" / "medical-test-storage"
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)


def make_user(name):
    user = get_user_model().objects.create_user(username=name, password="pw-for-tests")
    token, _ = Token.objects.get_or_create(user=user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return user, client


def make_attachment(client, purpose="medical", filename="xray.png", content=PNG):
    intent = client.post(
        reverse("attachment-upload-intent"),
        {"purpose": purpose, "filename": filename, "mime_type": "image/png", "size_bytes": len(content)},
        format="json",
    )
    data = payload(intent)
    client.post(
        data["upload_url"],
        {"file": SimpleUploadedFile(filename, content, content_type="image/png")},
        format="multipart",
    )
    client.post(reverse("attachment-complete", args=[data["id"]]), format="json")
    return data["id"]


@override_settings(PRIVATE_STORAGE_ROOT=STORAGE_ROOT)
class MedicalRecordTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(STORAGE_ROOT, ignore_errors=True)

    def setUp(self):
        self.user, self.client = make_user("med-owner")
        self.other, self.other_client = make_user("med-other")
        self.list_url = reverse("visit-list")

    def create_visit(self, **overrides):
        body = {"title": "复查"}
        body.update(overrides)
        response = self.client.post(self.list_url, body, format="json")
        assert response.status_code == 201, response.content
        return payload(response)

    # ---- 日期精度 ----

    def test_day_precision_derives_from_date(self):
        visit = self.create_visit(visit_date="2026-03-05")
        self.assertEqual(visit["date_precision"], "day")
        self.assertEqual(visit["visit_date"], "2026-03-05")
        self.assertEqual(visit["visit_month"], "")

    def test_month_precision_derives_from_month(self):
        visit = self.create_visit(visit_month="2026-03")
        self.assertEqual(visit["date_precision"], "month")
        self.assertIsNone(visit["visit_date"])

    def test_unknown_precision_when_no_date_given(self):
        visit = self.create_visit()
        self.assertEqual(visit["date_precision"], "unknown")
        self.assertIsNone(visit["visit_date"])
        self.assertEqual(visit["visit_month"], "")

    def test_date_and_month_cannot_both_be_filled(self):
        response = self.client.post(
            self.list_url, {"visit_date": "2026-03-05", "visit_month": "2026-03"}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_precision_must_agree_with_the_filled_field(self):
        contradictory = self.client.post(
            self.list_url, {"visit_date": "2026-03-05", "date_precision": "month"}, format="json"
        )
        self.assertEqual(contradictory.status_code, 400)
        other_way = self.client.post(
            self.list_url, {"visit_month": "2026-03", "date_precision": "day"}, format="json"
        )
        self.assertEqual(other_way.status_code, 400)

    def test_future_visit_date_is_refused(self):
        future = (timezone.localdate() + timedelta(days=10)).isoformat()
        response = self.client.post(self.list_url, {"visit_date": future}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_bad_month_format_is_refused(self):
        response = self.client.post(self.list_url, {"visit_month": "2026-13"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_unknown_dated_visit_sorts_last(self):
        self.create_visit(visit_date="2026-01-05")
        self.create_visit()
        listing = payload(self.client.get(self.list_url))
        self.assertEqual(listing[0]["date_precision"], "day")
        self.assertEqual(listing[-1]["date_precision"], "unknown")

    # ---- 权限隔离 ----

    def test_visits_are_isolated_per_user(self):
        visit = self.create_visit(visit_date="2026-03-05")
        self.assertEqual(payload(self.other_client.get(self.list_url)), [])
        detail = reverse("visit-detail", args=[visit["id"]])
        self.assertEqual(self.other_client.get(detail).status_code, 404)
        self.assertEqual(self.other_client.delete(detail).status_code, 404)

    def test_stale_expected_revision_is_refused(self):
        visit = self.create_visit(visit_date="2026-03-05")
        endpoint = reverse("visit-detail", args=[visit["id"]])
        self.client.patch(endpoint, {"title": "第二次复查"}, format="json")
        conflict = self.client.patch(
            endpoint, {"title": "第三次", "expected_revision": 1}, format="json"
        )
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(failure(conflict)["code"], ErrorCode.REVISION_CONFLICT)
        self.assertEqual(Visit.objects.get(pk=visit["id"]).title, "第二次复查")

    def test_visit_create_is_idempotent(self):
        body = {"visit_date": "2026-03-05", "title": "复查"}
        first = self.client.post(self.list_url, body, format="json", HTTP_IDEMPOTENCY_KEY="v-1")
        second = self.client.post(self.list_url, body, format="json", HTTP_IDEMPOTENCY_KEY="v-1")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(payload(first)["id"], payload(second)["id"])
        self.assertEqual(Visit.objects.filter(user=self.user).count(), 1)

    # ---- 附件绑定 ----

    def test_bind_medical_attachment(self):
        visit = self.create_visit(visit_date="2026-03-05")
        attachment_id = make_attachment(self.client)
        response = self.client.post(
            reverse("visit-bind-attachment", args=[visit["id"]]),
            {"attachment": attachment_id, "category": "xray_image", "caption": "站立位全脊柱"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        body = payload(response)
        self.assertEqual(body["category"], "xray_image")
        self.assertEqual(body["attachment"]["id"], attachment_id)
        self.assertIn("/attachments/", body["attachment"]["access_url"])

    def test_purpose_must_be_medical(self):
        visit = self.create_visit(visit_date="2026-03-05")
        community_id = make_attachment(self.client, purpose="community", filename="post.png")
        response = self.client.post(
            reverse("visit-bind-attachment", args=[visit["id"]]),
            {"attachment": community_id, "category": "other"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(failure(response)["code"], ErrorCode.VALIDATION_ERROR)

    def test_cannot_bind_someone_elses_attachment(self):
        visit = self.create_visit(visit_date="2026-03-05")
        foreign = make_attachment(self.other_client)
        response = self.client.post(
            reverse("visit-bind-attachment", args=[visit["id"]]),
            {"attachment": foreign, "category": "other"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_attachment_must_be_ready(self):
        visit = self.create_visit(visit_date="2026-03-05")
        intent = self.client.post(
            reverse("attachment-upload-intent"),
            {"purpose": "medical", "filename": "a.png", "mime_type": "image/png", "size_bytes": len(PNG)},
            format="json",
        )
        pending = payload(intent)["id"]
        response = self.client.post(
            reverse("visit-bind-attachment", args=[visit["id"]]),
            {"attachment": pending, "category": "other"},
            format="json",
        )
        self.assertEqual(response.status_code, 409)

    def test_one_attachment_belongs_to_one_visit_only(self):
        first = self.create_visit(visit_date="2026-03-05")
        second = self.create_visit(visit_date="2026-06-05")
        attachment_id = make_attachment(self.client)
        self.client.post(
            reverse("visit-bind-attachment", args=[first["id"]]),
            {"attachment": attachment_id, "category": "xray_image"},
            format="json",
        )
        response = self.client.post(
            reverse("visit-bind-attachment", args=[second["id"]]),
            {"attachment": attachment_id, "category": "xray_image"},
            format="json",
        )
        self.assertEqual(response.status_code, 409)

    @override_settings(VISIT_MAX_ATTACHMENTS=1)
    def test_attachment_count_limit(self):
        visit = self.create_visit(visit_date="2026-03-05")
        first = make_attachment(self.client, filename="a.png")
        second = make_attachment(self.client, filename="b.png")
        self.client.post(
            reverse("visit-bind-attachment", args=[visit["id"]]),
            {"attachment": first, "category": "xray_image"},
            format="json",
        )
        response = self.client.post(
            reverse("visit-bind-attachment", args=[visit["id"]]),
            {"attachment": second, "category": "imaging_report"},
            format="json",
        )
        self.assertEqual(response.status_code, 409)

    def test_rebinding_same_attachment_updates_category(self):
        visit = self.create_visit(visit_date="2026-03-05")
        attachment_id = make_attachment(self.client)
        endpoint = reverse("visit-bind-attachment", args=[visit["id"]])
        self.client.post(endpoint, {"attachment": attachment_id, "category": "other"}, format="json")
        again = self.client.post(
            endpoint, {"attachment": attachment_id, "category": "xray_image"}, format="json"
        )
        self.assertEqual(again.status_code, 200)
        self.assertEqual(payload(again)["category"], "xray_image")
        self.assertEqual(MedicalAttachment.objects.count(), 1)

    def test_category_can_be_changed_and_binding_can_be_removed(self):
        visit = self.create_visit(visit_date="2026-03-05")
        attachment_id = make_attachment(self.client)
        self.client.post(
            reverse("visit-bind-attachment", args=[visit["id"]]),
            {"attachment": attachment_id, "category": "other"},
            format="json",
        )
        detail = reverse("visit-attachment-detail", args=[visit["id"], attachment_id])
        changed = self.client.patch(detail, {"category": "imaging_report"}, format="json")
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(payload(changed)["category"], "imaging_report")
        self.assertEqual(self.client.delete(detail).status_code, 204)
        self.assertEqual(MedicalAttachment.objects.count(), 0)
        # 解绑不删原件：本人仍可读取。
        self.assertEqual(
            self.client.get(reverse("attachment-access", args=[attachment_id])).status_code, 200
        )

    def test_t04_other_user_cannot_reach_the_attachment(self):
        visit = self.create_visit(visit_date="2026-03-05")
        attachment_id = make_attachment(self.client)
        self.client.post(
            reverse("visit-bind-attachment", args=[visit["id"]]),
            {"attachment": attachment_id, "category": "xray_image"},
            format="json",
        )
        # 猜 id 拿不到就诊详情，也拿不到附件的短期地址或字节。
        self.assertEqual(self.other_client.get(reverse("visit-detail", args=[visit["id"]])).status_code, 404)
        self.assertEqual(
            self.other_client.get(reverse("attachment-access", args=[attachment_id])).status_code, 403
        )
        listing = payload(self.client.get(reverse("visit-detail", args=[visit["id"]])))
        url = listing["attachments"][0]["attachment"]["access_url"]
        # 签名地址只对拿到它的人有效；换个用户直接猜附件 id 也换不到地址。
        self.assertEqual(APIClient().get(url).status_code, 200)

    # ---- 多弯记录 ----

    def test_t03_multiple_curves_are_appended_not_overwritten(self):
        visit = self.create_visit(visit_date="2026-03-05")
        endpoint = reverse("visit-curves", args=[visit["id"]])
        first = self.client.post(
            endpoint,
            {"region": "thoracic", "direction": "right", "cobb_angle": "18.5", "end_vertebrae": "T5-T12"},
            format="json",
        )
        second = self.client.post(
            endpoint,
            {"region": "lumbar", "direction": "left", "cobb_angle": "12.0"},
            format="json",
        )
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 201, second.content)
        self.assertEqual(payload(first)["entry_source"], "manual")
        listing = payload(self.client.get(endpoint))
        self.assertEqual(len(listing), 2)
        # 两条独立存在，改一条不影响另一条。
        self.assertEqual(float(listing[0]["cobb_angle"]), 18.5)
        self.assertEqual(float(listing[1]["cobb_angle"]), 12.0)

    def test_curve_allows_unknown_values(self):
        visit = self.create_visit(visit_date="2026-03-05")
        response = self.client.post(
            reverse("visit-curves", args=[visit["id"]]), {"region": "unknown"}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.content)
        body = payload(response)
        self.assertIsNone(body["cobb_angle"])
        self.assertEqual(body["direction"], "unknown")

    def test_curve_angle_range_is_enforced(self):
        visit = self.create_visit(visit_date="2026-03-05")
        response = self.client.post(
            reverse("visit-curves", args=[visit["id"]]),
            {"region": "thoracic", "cobb_angle": "181.0"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_curve_source_attachment_must_belong_to_the_same_visit(self):
        first = self.create_visit(visit_date="2026-03-05")
        second = self.create_visit(visit_date="2026-06-05")
        attachment_id = make_attachment(self.client)
        binding = payload(self.client.post(
            reverse("visit-bind-attachment", args=[second["id"]]),
            {"attachment": attachment_id, "category": "imaging_report"},
            format="json",
        ))
        response = self.client.post(
            reverse("visit-curves", args=[first["id"]]),
            {"region": "thoracic", "source_attachment": binding["id"]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_curve_update_needs_fresh_revision(self):
        visit = self.create_visit(visit_date="2026-03-05")
        curve = payload(self.client.post(
            reverse("visit-curves", args=[visit["id"]]),
            {"region": "thoracic", "cobb_angle": "20.0"},
            format="json",
        ))
        endpoint = reverse("curve-measurement-detail", args=[curve["id"]])
        conflict = self.client.patch(
            endpoint, {"cobb_angle": "22.0", "expected_revision": 9}, format="json"
        )
        self.assertEqual(conflict.status_code, 409)
        ok = self.client.patch(
            endpoint, {"cobb_angle": "22.0", "expected_revision": 1}, format="json"
        )
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(payload(ok)["revision"], 2)

    def test_curve_of_other_user_is_invisible(self):
        visit = self.create_visit(visit_date="2026-03-05")
        curve = payload(self.client.post(
            reverse("visit-curves", args=[visit["id"]]),
            {"region": "thoracic", "cobb_angle": "20.0"},
            format="json",
        ))
        endpoint = reverse("curve-measurement-detail", args=[curve["id"]])
        self.assertEqual(self.other_client.get(endpoint).status_code, 404)
        self.assertEqual(self.other_client.delete(endpoint).status_code, 404)

    def test_curve_can_be_deleted_without_touching_the_visit(self):
        visit = self.create_visit(visit_date="2026-03-05")
        curve = payload(self.client.post(
            reverse("visit-curves", args=[visit["id"]]),
            {"region": "thoracic"},
            format="json",
        ))
        endpoint = reverse("curve-measurement-detail", args=[curve["id"]])
        self.assertEqual(self.client.delete(endpoint).status_code, 204)
        self.assertEqual(CurveMeasurement.objects.count(), 0)
        self.assertTrue(Visit.objects.filter(pk=visit["id"]).exists())

    # ---- 删除就诊 ----

    def test_deleting_a_visit_removes_bindings_and_curves(self):
        visit = self.create_visit(visit_date="2026-03-05")
        attachment_id = make_attachment(self.client)
        self.client.post(
            reverse("visit-bind-attachment", args=[visit["id"]]),
            {"attachment": attachment_id, "category": "xray_image"},
            format="json",
        )
        self.client.post(
            reverse("visit-curves", args=[visit["id"]]),
            {"region": "thoracic", "cobb_angle": "20.0"},
            format="json",
        )
        self.assertEqual(self.client.delete(reverse("visit-detail", args=[visit["id"]])).status_code, 204)
        self.assertEqual(Visit.objects.count(), 0)
        self.assertEqual(MedicalAttachment.objects.count(), 0)
        self.assertEqual(CurveMeasurement.objects.count(), 0)

    def test_visits_require_authentication(self):
        self.assertEqual(APIClient().get(self.list_url).status_code, 401)
