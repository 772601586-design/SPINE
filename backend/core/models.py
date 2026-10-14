import uuid

from django.conf import settings
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver


class WechatAccount(models.Model):
    """绑定微信小程序身份(openid)与 Django 用户。

    `session_key` 有意不落库：它是每次登录下发的会话密钥，仅用于解密微信侧数据，
    在 Token 认证体系里没有用途，长期保存只会扩大泄露面。
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="wechat_account",
    )
    openid = models.CharField(max_length=64, unique=True)
    unionid = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    last_login_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "WeChat account"
        verbose_name_plural = "WeChat accounts"

    def __str__(self):
        return f"WeChat account #{self.pk}"


class Attachment(models.Model):
    """私有附件（规格 v2.0 §13、§15）。

    三条不可动摇的规则：

    1. **一律私有**。项目里没有公开的 `MEDIA_URL`，字节只能通过带签名、会
       过期的临时地址读出，且每次读出都会重新校验归属。
    2. **`purpose` 受控**。用途决定体积上限与允许的 MIME，同时也是隔离手段：
       社区媒体与医疗原件是不同用途、不同行，不存在「换个接口就能拿到病历」。
    3. **先申请后确认**。行先以 `pending` 存在，字节落盘并通过大小/MIME/魔数
       校验后才转 `ready`；业务表只允许绑定 `ready` 且归属正确的附件。
    """

    class Purpose(models.TextChoices):
        MEDICAL = "medical", "医疗资料"
        PRIVATE_RECORD = "private_record", "私人记录"
        COMMUNITY = "community", "社区内容"
        EXERCISE = "exercise", "动作素材"
        ARTICLE = "article", "科普素材"
        AVATAR = "avatar", "头像"

    class Status(models.TextChoices):
        PENDING = "pending", "待上传"
        READY = "ready", "可用"
        REJECTED = "rejected", "已拒绝"
        DELETED = "deleted", "已删除"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # owner 为空表示平台自有素材（动作示范、科普配图），只能由后台创建。
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    purpose = models.CharField(max_length=32, choices=Purpose.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    # 对象键，不外发；外发的是签名后的短期访问地址。
    storage_key = models.CharField(max_length=255, unique=True)
    original_filename = models.CharField(max_length=255, blank=True, default="")
    mime_type = models.CharField(max_length=128)
    # 申请时客户端声明的值，只用于提前拒绝，不作为真值。
    declared_size_bytes = models.PositiveBigIntegerField(default=0)
    # 落盘后实测的值，这才是真值。
    size_bytes = models.PositiveBigIntegerField(default=0)
    checksum_sha256 = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["owner", "purpose", "status"])]
        constraints = [
            # 只有 ready 才可能被业务引用，因此大小/校验和必须存在。
            models.CheckConstraint(
                condition=~models.Q(status="ready") | models.Q(size_bytes__gt=0),
                name="attachment_ready_has_size",
            ),
        ]

    def __str__(self):
        return f"Attachment {self.id} ({self.purpose}/{self.status})"


@receiver(post_delete, sender=Attachment)
def _drop_attachment_object(sender, instance, **kwargs):
    """行被删除时同步清掉对象，避免留下无法追溯的孤儿文件。

    `DELETE /attachments/{id}` 走的是软删除（保留审计），只有在账号注销等
    真正删行时才触发这里。
    """
    from core.storage import StorageError, get_storage

    try:
        get_storage().delete(instance.storage_key)
    except StorageError:
        pass


class IdempotencyKey(models.Model):
    """副作用请求的幂等记录（规格 v2.0 §13.5、§14）。

    有意**不保存响应体**：响应里常含疼痛分、病历摘录这类健康数据，复制一份到
    幂等表等于凭空扩大暴露面。这里只留 `object_id` 与状态码，重放时按 id 重新
    序列化，数据始终只有一个真源。
    """

    id = models.BigAutoField(primary_key=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="idempotency_keys"
    )
    operation = models.CharField(max_length=64)
    key = models.CharField(max_length=128)
    payload_hash = models.CharField(max_length=64)
    response_status = models.PositiveSmallIntegerField(null=True, blank=True)
    object_id = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "operation", "key"], name="idempotency_unique_key"),
        ]

    def __str__(self):
        return f"IdempotencyKey<{self.user_id} {self.operation}>"
