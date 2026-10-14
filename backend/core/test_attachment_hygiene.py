"""上传卫生的测试（规格 §15；原 Task #16）。

两件事：
1. **配额**：`upload-intent` 即建行，必须限流，否则零成本刷无限 pending 行。
2. **清理**：中途放弃的 pending（行 + 可能已落盘的字节）由
   `cleanup_attachments` 命令兜底删除；ready 的附件绝不能被误删。
"""

import shutil
from datetime import timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient, APITestCase

from core.models import Attachment
from core.storage import get_storage
from core.tests import failure, payload

STORAGE_ROOT = Path(__file__).resolve().parents[2] / ".tmp" / "attachment-hygiene-test-storage"
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)


def make_user(name):
    user = get_user_model().objects.create_user(username=name, password="pw-for-tests")
    token, _ = Token.objects.get_or_create(user=user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return user, client


def make_pending(user, filename="scan.png", purpose="medical"):
    return Attachment.objects.create(
        owner=user,
        purpose=purpose,
        status=Attachment.Status.PENDING,
        storage_key=f"{purpose}/{user.pk}/{filename}",
        original_filename=filename,
        mime_type="image/png",
        declared_size_bytes=100,
    )


@override_settings(PRIVATE_STORAGE_ROOT=STORAGE_ROOT)
class AttachmentHygieneTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(STORAGE_ROOT, ignore_errors=True)

    def setUp(self):
        self.user, self.client = make_user("hygiene-owner")

    def test_pending_quota_blocks_unbounded_intent_spam(self):
        for index in range(20):
            make_pending(self.user, filename=f"p{index}.png")
        response = self.client.post(
            reverse("attachment-upload-intent"),
            {"purpose": "medical", "filename": "a.png", "mime_type": "image/png", "size_bytes": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 429)
        self.assertEqual(failure(response)["code"], "THROTTLED")

    def test_pending_quota_ignores_completed_and_deleted(self):
        # ready / deleted 不占配额：正常"传完没 complete"的并发上传不受影响。
        ready = make_pending(self.user, filename="done.png")
        ready.status = Attachment.Status.READY
        ready.size_bytes = 100  # 库级约束：ready 必须有实测体积
        ready.save(update_fields=["status", "size_bytes"])
        deleted = make_pending(self.user, filename="gone.png")
        deleted.status = Attachment.Status.DELETED
        deleted.save(update_fields=["status"])
        response = self.client.post(
            reverse("attachment-upload-intent"),
            {"purpose": "medical", "filename": "a.png", "mime_type": "image/png", "size_bytes": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

    def test_quota_is_per_user(self):
        other, other_client = make_user("hygiene-other")
        for index in range(20):
            make_pending(self.user, filename=f"p{index}.png")
        response = other_client.post(
            reverse("attachment-upload-intent"),
            {"purpose": "medical", "filename": "a.png", "mime_type": "image/png", "size_bytes": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

    def test_cleanup_removes_expired_pending_rows_and_bytes(self):
        attachment = make_pending(self.user, filename="old.png")
        attachment.created_at = timezone.now() - timedelta(hours=25)
        attachment.save(update_fields=["created_at"])
        storage = get_storage()
        # 中途放弃也可能已落盘：清理必须连字节一起删。
        storage.path(attachment.storage_key).parent.mkdir(parents=True, exist_ok=True)
        storage.path(attachment.storage_key).write_bytes(b"\x89PNG\r\n\x1a\n")

        call_command("cleanup_attachments", stdout=__import__("io").StringIO())

        self.assertFalse(Attachment.objects.filter(pk=attachment.pk).exists())
        self.assertFalse(storage.exists(attachment.storage_key))

    def test_cleanup_keeps_fresh_pending_and_all_ready(self):
        fresh = make_pending(self.user, filename="fresh.png")
        ready = make_pending(self.user, filename="kept.png")
        ready.status = Attachment.Status.READY
        ready.size_bytes = 100  # 库级约束：ready 必须有实测体积
        ready.save(update_fields=["status", "size_bytes"])

        call_command("cleanup_attachments", stdout=__import__("io").StringIO())

        self.assertTrue(Attachment.objects.filter(pk__in=[fresh.pk, ready.pk]).count() == 2)

    def test_cleanup_dry_run_changes_nothing(self):
        attachment = make_pending(self.user, filename="dry.png")
        attachment.created_at = timezone.now() - timedelta(hours=25)
        attachment.save(update_fields=["created_at"])
        out = __import__("io").StringIO()

        call_command("cleanup_attachments", "--dry-run", stdout=out)

        self.assertTrue(Attachment.objects.filter(pk=attachment.pk).exists())
        self.assertIn("dry-run", out.getvalue())

    def test_cleanup_reports_remaining_quota_slots_via_payload_shape(self):
        # 清理后配额立即恢复：同一批 pending 被删掉后可以再次申请。
        for index in range(20):
            row = make_pending(self.user, filename=f"p{index}.png")
            row.created_at = timezone.now() - timedelta(hours=25)
            row.save(update_fields=["created_at"])
        call_command("cleanup_attachments", stdout=__import__("io").StringIO())
        response = self.client.post(
            reverse("attachment-upload-intent"),
            {"purpose": "medical", "filename": "a.png", "mime_type": "image/png", "size_bytes": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertIn("upload_url", payload(response))
