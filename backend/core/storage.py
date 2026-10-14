"""私有对象存储适配层（规格 v2.0 §15）。

医疗附件、私人记录、社区媒体一律**私有**：项目里不存在公开的 `MEDIA_URL`，
读取必须经过带签名、会过期的临时地址。本地实现把文件写到
`settings.PRIVATE_STORAGE_ROOT`（独立于 static/media，不经任何公开静态路由暴露）。

生产切换到 S3/OSS 时，实现同样的 `save_stream/open/delete/exists/size` 接口，
并把 `STORAGE_BACKEND` 指向新实现即可，调用方不感知。
"""

import hashlib
import hmac
import re
import uuid
from pathlib import Path

from django.conf import settings
from django.core import signing

# 存储键只允许这几类字符，从源头排除目录穿越与怪字符。
_KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")

# MIME 与扩展名必须一致；不一致说明客户端在伪装类型。
MIME_EXTENSIONS = {
    "image/jpeg": (".jpg", ".jpeg"),
    "image/png": (".png",),
    "image/webp": (".webp",),
    "application/pdf": (".pdf",),
    "video/mp4": (".mp4",),
}

# 只靠扩展名和客户端自报的 MIME 不足以挡住伪装文件，落盘前再核一次魔数。
_MAGIC_SIGNATURES = (
    ("image/jpeg", lambda head: head.startswith(b"\xff\xd8\xff")),
    ("image/png", lambda head: head.startswith(b"\x89PNG\r\n\x1a\n")),
    ("image/webp", lambda head: head[:4] == b"RIFF" and head[8:12] == b"WEBP"),
    ("application/pdf", lambda head: head.startswith(b"%PDF")),
    ("video/mp4", lambda head: len(head) >= 12 and head[4:8] == b"ftyp"),
)

# 明确不支持、且必须给出专门提示的类型：不能让 DICOM 被当成普通图片存进来。
EXPLICITLY_UNSUPPORTED = {
    ".dcm": "DICOM 影像首版不支持，请上传 JPG/PNG 图片或 PDF 报告。",
}

ACCESS_SALT = "spine.attachment.access"
DEFAULT_ACCESS_TTL_SECONDS = 300


class StorageError(Exception):
    """存储层故障或非法键，属于服务端问题，不把细节暴露给客户端。"""


class UploadTooLarge(Exception):
    """实际字节数超过该用途允许的上限。"""


def max_bytes_for(purpose):
    policy = settings.ATTACHMENT_PURPOSE_POLICIES.get(purpose)
    if policy is None:
        raise StorageError(f"未配置的附件用途：{purpose}")
    return policy["max_bytes"]


def allowed_mime_types(purpose):
    policy = settings.ATTACHMENT_PURPOSE_POLICIES.get(purpose)
    if policy is None:
        raise StorageError(f"未配置的附件用途：{purpose}")
    return tuple(policy["mime_types"])


def extension_for(filename):
    return Path(filename or "").suffix.lower()


def extension_matches(mime_type, filename):
    allowed = MIME_EXTENSIONS.get(mime_type)
    if not allowed:
        return False
    return extension_for(filename) in allowed


def build_storage_key(purpose, filename):
    """键里不带原始文件名，避免把用户文件名（可能含姓名/医院号）带进对象路径。"""
    suffix = extension_for(filename) or ".bin"
    return f"{purpose}/{uuid.uuid4().hex}{suffix}"


def sniff_mime(head):
    for mime, predicate in _MAGIC_SIGNATURES:
        try:
            if predicate(head):
                return mime
        except Exception:  # pragma: no cover - 防御性，签名函数不应抛错
            continue
    return None


class LocalPrivateStorage:
    """本地私有存储。根目录在仓库工作区内，但不挂任何公开静态路由。"""

    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, storage_key):
        if not _KEY_PATTERN.match(storage_key or ""):
            raise StorageError("非法存储键。")
        root = self.root.resolve()
        target = (root / storage_key).resolve()
        # resolve 之后再比对前缀，符号链接与 `..` 都挡在这一步。
        if target != root and root not in target.parents:
            raise StorageError("非法存储路径。")
        return target

    def save_stream(self, storage_key, fileobj, max_bytes):
        """流式落盘，边写边计数。返回 (size, sha256, head)。

        超限时立即停止并清理，绝不把超限内容留在磁盘上。
        """
        target = self.path(storage_key)
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        head = b""
        size = 0
        try:
            with open(target, "wb") as destination:
                while True:
                    chunk = fileobj.read(64 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > max_bytes:
                        raise UploadTooLarge()
                    if len(head) < 16:
                        head += chunk[: 16 - len(head)]
                    digest.update(chunk)
                    destination.write(chunk)
        except UploadTooLarge:
            target.unlink(missing_ok=True)
            raise
        except OSError as error:
            target.unlink(missing_ok=True)
            raise StorageError("写入附件失败。") from error
        if size == 0:
            target.unlink(missing_ok=True)
            raise StorageError("上传内容为空。")
        return size, digest.hexdigest(), head

    def open(self, storage_key):
        return open(self.path(storage_key), "rb")

    def delete(self, storage_key):
        try:
            self.path(storage_key).unlink(missing_ok=True)
        except StorageError:
            # 键非法说明这行数据本身有问题，删除操作不应因此失败。
            return False
        return True

    def exists(self, storage_key):
        try:
            return self.path(storage_key).is_file()
        except StorageError:
            return False

    def size(self, storage_key):
        try:
            target = self.path(storage_key)
        except StorageError:
            return None
        return target.stat().st_size if target.is_file() else None


_storage_cache = {}


def get_storage():
    backend = getattr(settings, "STORAGE_BACKEND", "local")
    if backend != "local":
        raise StorageError(f"未实现的存储后端：{backend}")
    root = str(settings.PRIVATE_STORAGE_ROOT)
    if root not in _storage_cache:
        _storage_cache[root] = LocalPrivateStorage(root)
    return _storage_cache[root]


def issue_access_token(attachment_id, owner_id, ttl=None):
    """签发短期访问令牌。令牌只绑定这一条附件，不携带任何其他权限。"""
    ttl = ttl or getattr(settings, "ATTACHMENT_ACCESS_TTL_SECONDS", DEFAULT_ACCESS_TTL_SECONDS)
    return signing.dumps(
        {"attachment": str(attachment_id), "owner": str(owner_id or "")},
        salt=ACCESS_SALT,
        compress=True,
    ), ttl


def read_access_token(token):
    max_age = getattr(settings, "ATTACHMENT_ACCESS_TTL_SECONDS", DEFAULT_ACCESS_TTL_SECONDS)
    try:
        payload = signing.loads(token, salt=ACCESS_SALT, max_age=max_age)
    except signing.SignatureExpired as error:
        raise StorageError("访问地址已过期，请重新获取。") from error
    except signing.BadSignature as error:
        raise StorageError("访问地址无效。") from error
    return payload.get("attachment"), payload.get("owner") or None


def constant_time_equals(left, right):
    return hmac.compare_digest(str(left), str(right))


def storage_root_is_private(root):
    """自检：存储根目录不能落在会被公开静态托管的目录里。"""
    root = Path(root).resolve()
    for exposed in (Path(settings.BASE_DIR) / "static", Path(settings.BASE_DIR) / "media"):
        try:
            if exposed.resolve() == root or exposed.resolve() in root.parents:
                return False
        except OSError:  # pragma: no cover
            continue
    return True


def relative_key_parts(storage_key):
    parts = storage_key.split("/")
    if len(parts) < 2 or not all(parts):
        raise StorageError("存储键缺少用途分区。")
    return parts[0], "/".join(parts[1:])
