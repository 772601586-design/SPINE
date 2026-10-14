"""副作用请求的幂等与并发编辑保护（规格 v2.0 §13.5、§14）。

两个不同的失败模式，需要两套机制，不能互相替代：

- **重试同一请求**（网络超时、用户连点）→ `Idempotency-Key`。同一用户 + 同一
  操作 + 同一 key 只产生一次副作用；同 key 但内容不同说明客户端复用了键，必须
  报冲突而不是当作重试。
- **两端同时改同一条记录**（丢更新）→ `expected_revision`。版本不一致就拒绝，
  不静默覆盖对方的修改。

注意：幂等表只记 id 与状态码，不复制响应体——响应里常有健康数据。
"""

import hashlib
import json

from django.db import IntegrityError, transaction

from core.errors import ErrorCode, SpineError
from core.models import IdempotencyKey

HEADER = "Idempotency-Key"


def payload_hash(payload):
    normalized = json.dumps(payload, default=str, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def request_key(request):
    return (request.headers.get(HEADER) or request.META.get("HTTP_IDEMPOTENCY_KEY") or "").strip()


def claim(request, operation, payload):
    """登记（或取回）一次幂等请求。

    返回 `(record, replayed)`：
    - `record` 为 None 表示客户端没带 key，调用方按普通请求处理；
    - `replayed=True` 表示这是重复请求，调用方应直接返回既有结果，不得再产生副作用。
    """
    key = request_key(request)
    if not key:
        return None, False
    if len(key) > 128:
        raise SpineError("Idempotency-Key 过长。", ErrorCode.VALIDATION_ERROR, 400)
    digest = payload_hash(payload)
    user = request.user
    existing = IdempotencyKey.objects.filter(user=user, operation=operation, key=key).first()
    if existing is not None:
        _assert_same_payload(existing, digest)
        return existing, True
    try:
        with transaction.atomic():
            record = IdempotencyKey.objects.create(
                user=user, operation=operation, key=key, payload_hash=digest
            )
    except IntegrityError:
        # 两个并发请求同时抢占同一个键，后到的复用先到的那条。
        existing = IdempotencyKey.objects.filter(user=user, operation=operation, key=key).first()
        if existing is None:  # pragma: no cover - 唯一约束保证存在
            raise
        _assert_same_payload(existing, digest)
        return existing, True
    return record, False


def record_result(record, status_code, object_id=None):
    if record is None:
        return
    IdempotencyKey.objects.filter(pk=record.pk).update(
        response_status=status_code, object_id="" if object_id is None else str(object_id)
    )


def _assert_same_payload(existing, digest):
    if existing.payload_hash != digest:
        raise SpineError(
            "同一 Idempotency-Key 不能用于不同内容，请换一个键。",
            ErrorCode.IDEMPOTENCY_CONFLICT,
            409,
        )


def check_expected_revision(instance, expected):
    """乐观并发：版本不一致说明另一端已改过，拒绝覆盖。"""
    if expected in (None, ""):
        return
    try:
        expected_value = int(expected)
    except (TypeError, ValueError):
        raise SpineError("expected_revision 必须是整数。", ErrorCode.VALIDATION_ERROR, 400)
    if expected_value != instance.revision:
        raise SpineError(
            "记录已被其他设备更新，请刷新后重试。",
            ErrorCode.REVISION_CONFLICT,
            409,
        )


def load_object(model, object_id):
    if not object_id:
        return None
    return model.objects.filter(pk=object_id).first()
