"""私有附件基座的测试（规格 v2.0 §15、§18 T04）。

重点不是"能上传成功"，而是**不能越界**：类型伪装、跨用途引用、跨用户猜 id、
签名过期，都必须被拒绝，并且拒绝之后不留残留字节。
"""

import shutil
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient, APITestCase

from core.errors import ErrorCode
from core.models import Attachment
from core.storage import ACCESS_SALT, StorageError, get_storage, issue_access_token, read_access_token
from core.tests import failure, payload

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PDF = b"%PDF-1.4\n" + b"\x00" * 64
TXT = b"just some text pretending to be an image" + b"\x00" * 16

STORAGE_ROOT = Path(__file__).resolve().parents[2] / ".tmp" / "attachment-test-storage"
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)


def make_user(name):
    user = get_user_model().objects.create_user(username=name, password="pw-for-tests")
    token, _ = Token.objects.get_or_create(user=user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return user, client


def upload(client, purpose, filename, mime, content, expect_status=201):
    intent = client.post(
        reverse("attachment-upload-intent"),
        {"purpose": purpose, "filename": filename, "mime_type": mime, "size_bytes": len(content)},
        format="json",
    )
    if intent.status_code != 201:
        return intent, None
    data = payload(intent)
    from django.core.files.uploadedfile import SimpleUploadedFile

    upload_response = client.post(
        data["upload_url"],
        {"file": SimpleUploadedFile(filename, content, content_type=mime)},
        format="multipart",
    )
    if upload_response.status_code != 201:
        return upload_response, data
    complete = client.post(reverse("attachment-complete", args=[data["id"]]), format="json")
    return complete, data


@override_settings(PRIVATE_STORAGE_ROOT=STORAGE_ROOT)
class AttachmentTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(STORAGE_ROOT, ignore_errors=True)

    def setUp(self):
        self.user, self.client = make_user("att-owner")
        self.other, self.other_client = make_user("att-other")

    def test_upload_intent_requires_authentication(self):
        response = APIClient().post(
            reverse("attachment-upload-intent"),
            {"purpose": "medical", "filename": "a.png", "mime_type": "image/png", "size_bytes": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(failure(response)["code"], ErrorCode.AUTH_REQUIRED)

    def test_unknown_purpose_is_rejected(self):
        response = self.client.post(
            reverse("attachment-upload-intent"),
            {"purpose": "diary", "filename": "a.png", "mime_type": "image/png", "size_bytes": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_dicom_is_refused_with_explicit_message(self):
        response = self.client.post(
            reverse("attachment-upload-intent"),
            {"purpose": "medical", "filename": "scan.dcm", "mime_type": "application/pdf", "size_bytes": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 415)
        self.assertEqual(failure(response)["code"], ErrorCode.UNSUPPORTED_FILE_TYPE)
        self.assertIn("DICOM", failure(response)["message"])

    def test_mime_not_allowed_for_purpose(self):
        # 头像不接受 PDF，即使 PDF 本身是"允许的类型"之一（只是不属于该用途）。
        response = self.client.post(
            reverse("attachment-upload-intent"),
            {"purpose": "avatar", "filename": "a.pdf", "mime_type": "application/pdf", "size_bytes": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 415)

    def test_extension_must_match_declared_mime(self):
        response = self.client.post(
            reverse("attachment-upload-intent"),
            {"purpose": "avatar", "filename": "a.png", "mime_type": "image/jpeg", "size_bytes": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 415)

    def test_oversize_is_rejected_before_upload(self):
        response = self.client.post(
            reverse("attachment-upload-intent"),
            {"purpose": "avatar", "filename": "a.png", "mime_type": "image/png", "size_bytes": 6 * 1024 * 1024},
            format="json",
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(failure(response)["code"], ErrorCode.UPLOAD_TOO_LARGE)
        self.assertEqual(Attachment.objects.count(), 0)

    def test_happy_path_marks_ready_with_measured_size(self):
        complete, data = upload(self.client, "avatar", "me.png", "image/png", PNG)
        self.assertEqual(complete.status_code, 200, complete.content)
        body = payload(complete)
        self.assertEqual(body["status"], "ready")
        self.assertEqual(body["size_bytes"], len(PNG))
        self.assertTrue(body["access_url"])
        attachment = Attachment.objects.get(pk=data["id"])
        self.assertEqual(len(attachment.checksum_sha256), 64)

    def test_content_is_readable_through_signed_url(self):
        complete, data = upload(self.client, "avatar", "me.png", "image/png", PNG)
        url = payload(complete)["access_url"]
        response = APIClient().get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), PNG)
        self.assertIn("no-store", response["Cache-Control"])

    def test_spoofed_content_is_refused_and_cleaned_up(self):
        # 声明 PNG、扩展名 .png，实际是文本——魔数校验必须拦住，且不留残文件。
        response, data = upload(self.client, "avatar", "fake.png", "image/png", TXT)
        self.assertEqual(response.status_code, 415)
        self.assertEqual(failure(response)["code"], ErrorCode.UNSUPPORTED_FILE_TYPE)
        attachment = Attachment.objects.get(pk=data["id"])
        self.assertFalse(get_storage().exists(attachment.storage_key))
        self.assertEqual(attachment.status, Attachment.Status.PENDING)

    def test_content_endpoint_rejects_missing_or_bad_token(self):
        complete, data = upload(self.client, "avatar", "me.png", "image/png", PNG)
        endpoint = reverse("attachment-content", args=[data["id"]])
        self.assertEqual(APIClient().get(endpoint).status_code, 401)
        self.assertEqual(APIClient().get(endpoint + "?token=not-a-token").status_code, 401)

    def test_token_cannot_be_reused_for_another_attachment(self):
        _, first = upload(self.client, "avatar", "a.png", "image/png", PNG)
        _, second = upload(self.client, "avatar", "b.png", "image/png", PNG)
        # 用第一张的令牌去读第二张：令牌与路径不一致，必须拒绝。
        token, _ = issue_access_token(first["id"], self.user.id)
        response = APIClient().get(reverse("attachment-content", args=[second["id"]]) + f"?token={token}")
        self.assertEqual(response.status_code, 403)

    def test_expired_token_is_refused(self):
        _, data = upload(self.client, "avatar", "me.png", "image/png", PNG)
        with override_settings(ATTACHMENT_ACCESS_TTL_SECONDS=-1):
            token, _ = issue_access_token(data["id"], self.user.id)
            with self.assertRaises(StorageError):
                read_access_token(token)
            response = APIClient().get(reverse("attachment-content", args=[data["id"]]) + f"?token={token}")
        self.assertEqual(response.status_code, 401)

    def test_other_user_cannot_ask_for_medical_access(self):
        complete, data = upload(self.client, "medical", "xray.png", "image/png", PNG)
        self.assertEqual(complete.status_code, 200)
        response = self.other_client.get(reverse("attachment-access", args=[data["id"]]))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(failure(response)["code"], ErrorCode.FORBIDDEN)

    def test_other_user_can_read_community_media(self):
        complete, data = upload(self.client, "community", "post.png", "image/png", PNG)
        self.assertEqual(payload(complete)["status"], "ready")
        response = self.other_client.get(reverse("attachment-access", args=[data["id"]]))
        self.assertEqual(response.status_code, 200)

    def test_avatar_is_readable_by_other_users_but_private_records_are_not(self):
        # 社区里要展示别人的头像，所以头像是可被其他登录用户读取的；
        # 私人记录（疼痛照片等）不可以。
        avatar = upload(self.client, "avatar", "a.png", "image/png", PNG)[1]
        private = upload(self.client, "private_record", "p.png", "image/png", PNG)[1]
        self.assertEqual(
            self.other_client.get(reverse("attachment-access", args=[avatar["id"]])).status_code, 200
        )
        self.assertEqual(
            self.other_client.get(reverse("attachment-access", args=[private["id"]])).status_code, 403
        )

    def test_delete_is_soft_and_removes_bytes(self):
        _, data = upload(self.client, "avatar", "me.png", "image/png", PNG)
        attachment = Attachment.objects.get(pk=data["id"])
        url = payload(self.client.get(reverse("attachment-access", args=[data["id"]])))["access_url"]
        self.assertEqual(self.client.delete(reverse("attachment-detail", args=[data["id"]])).status_code, 204)
        attachment.refresh_from_db()
        self.assertEqual(attachment.status, Attachment.Status.DELETED)
        self.assertFalse(get_storage().exists(attachment.storage_key))
        # 撤下公开媒体后禁止后续获取。
        self.assertEqual(APIClient().get(url).status_code, 404)

    def test_delete_by_other_user_is_not_found(self):
        _, data = upload(self.client, "avatar", "me.png", "image/png", PNG)
        response = self.other_client.delete(reverse("attachment-detail", args=[data["id"]]))
        self.assertEqual(response.status_code, 404)

    def test_complete_is_idempotent(self):
        _, data = upload(self.client, "avatar", "me.png", "image/png", PNG)
        again = self.client.post(reverse("attachment-complete", args=[data["id"]]), format="json")
        self.assertEqual(again.status_code, 200)
        self.assertEqual(payload(again)["status"], "ready")

    def test_complete_before_bytes_arrive_fails(self):
        intent = self.client.post(
            reverse("attachment-upload-intent"),
            {"purpose": "avatar", "filename": "a.png", "mime_type": "image/png", "size_bytes": 5},
            format="json",
        )
        attachment_id = payload(intent)["id"]
        response = self.client.post(reverse("attachment-complete", args=[attachment_id]), format="json")
        self.assertEqual(response.status_code, 409)


class AttachmentTokenUnitTests(APITestCase):
    def test_signature_salt_is_namespaced(self):
        # 令牌必须绑定专用 salt，避免与 Django 其他签名用途互相通用。
        self.assertEqual(ACCESS_SALT, "spine.attachment.access")
