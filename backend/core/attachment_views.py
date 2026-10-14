"""私有附件的 HTTP 接口（规格 v2.0 §14、§15）。

流程刻意分成两段，而不是"一个 POST 把文件塞进来"：

    upload-intent  ->  字节上传（带签名地址）  ->  complete

这样服务端在收字节**之前**就知道用途、声明类型与体积，可以在申请阶段就按用途
策略拒绝（例如把 PDF 传给"头像"、把 200MiB 塞给"医疗资料"），而不是收完再删。
`complete` 之前行一直是 `pending`，业务表只能绑定 `ready` 的附件。
"""

from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.http import FileResponse
from django.urls import reverse
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.errors import ErrorCode, SpineError
from core.models import Attachment
from core.storage import (
    EXPLICITLY_UNSUPPORTED,
    StorageError,
    UploadTooLarge,
    allowed_mime_types,
    build_storage_key,
    extension_for,
    extension_matches,
    get_storage,
    issue_access_token,
    max_bytes_for,
    read_access_token,
    sniff_mime,
)

# 允许其他登录用户读取的用途：这些内容本来就是给他人看的
# （社区帖子、科普、动作示范，以及社区里要展示的头像）。
# 医疗资料与私人记录永远不在此列——社区展示用的是独立附件，不复用医疗原件。
PUBLIC_READ_PURPOSES = (
    Attachment.Purpose.COMMUNITY,
    Attachment.Purpose.EXERCISE,
    Attachment.Purpose.ARTICLE,
    Attachment.Purpose.AVATAR,
)


def access_payload(request, attachment):
    """签发一条只对这张附件有效的短期地址。"""
    token, ttl = issue_access_token(attachment.id, attachment.owner_id)
    path = reverse("attachment-content", args=[attachment.id])
    url = request.build_absolute_uri(f"{path}?token={quote(token)}")
    return url, timezone.now() + timedelta(seconds=ttl)


class AttachmentSerializer(serializers.ModelSerializer):
    access_url = serializers.SerializerMethodField()
    access_expires_at = serializers.SerializerMethodField()

    class Meta:
        model = Attachment
        fields = (
            "id", "purpose", "status", "original_filename", "mime_type",
            "size_bytes", "created_at", "access_url", "access_expires_at",
        )
        read_only_fields = fields

    def _payload(self, obj):
        request = self.context.get("request")
        if request is None or obj.status != Attachment.Status.READY:
            return None, None
        return access_payload(request, obj)

    def get_access_url(self, obj) -> str | None:
        return self._payload(obj)[0]

    def get_access_expires_at(self, obj) -> str | None:
        return self._payload(obj)[1]


def serialize_attachment(request, attachment):
    return AttachmentSerializer(attachment, context={"request": request}).data


class UploadIntentSerializer(serializers.Serializer):
    purpose = serializers.ChoiceField(choices=Attachment.Purpose.choices)
    filename = serializers.CharField(max_length=255, trim_whitespace=True)
    mime_type = serializers.CharField(max_length=128, trim_whitespace=True)
    size_bytes = serializers.IntegerField(min_value=1)

    def validate(self, attrs):
        purpose = attrs["purpose"]
        mime_type = attrs["mime_type"].lower()
        filename = attrs["filename"]
        suffix = extension_for(filename)
        if suffix in EXPLICITLY_UNSUPPORTED:
            raise SpineError(EXPLICITLY_UNSUPPORTED[suffix], ErrorCode.UNSUPPORTED_FILE_TYPE, 415)
        allowed = allowed_mime_types(purpose)
        if mime_type not in allowed:
            raise SpineError(
                f"该用途只接受 {'、'.join(allowed)}。",
                ErrorCode.UNSUPPORTED_FILE_TYPE,
                415,
            )
        if not extension_matches(mime_type, filename):
            raise SpineError(
                "文件扩展名与声明的类型不一致。",
                ErrorCode.UNSUPPORTED_FILE_TYPE,
                415,
            )
        limit = max_bytes_for(purpose)
        if attrs["size_bytes"] > limit:
            raise SpineError(
                f"文件超过该用途上限（{limit // (1024 * 1024)} MiB）。",
                ErrorCode.UPLOAD_TOO_LARGE,
                413,
            )
        attrs["mime_type"] = mime_type
        return attrs


class UploadIntentResponseSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    upload_url = serializers.CharField()
    method = serializers.CharField()
    field_name = serializers.CharField()
    expires_at = serializers.DateTimeField()
    max_bytes = serializers.IntegerField()


class UploadIntentView(APIView):
    """申请一次上传：先校验用途与声明，再给出一条带签名的上传地址。

    申请即建行：如果不限流，客户端可以零成本刷出无限 `pending` 行（占库、
    占存储键、也让清理任务永远追不上）。配额只数 pending——完成的、删除的
    都不计入，所以正常"传了但还没 complete"的并发上传不受影响。
    """

    @extend_schema(request=UploadIntentSerializer, responses=UploadIntentResponseSerializer,
                   tags=["Attachments"])
    def post(self, request):
        serializer = UploadIntentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        limit = getattr(settings, "ATTACHMENT_PENDING_LIMIT", 20)
        pending_count = Attachment.objects.filter(
            owner=request.user, status=Attachment.Status.PENDING
        ).count()
        if pending_count >= limit:
            raise SpineError(
                "未完成的上传请求过多，请先完成或取消它们后再试。",
                ErrorCode.THROTTLED,
                status.HTTP_429_TOO_MANY_REQUESTS,
            )
        attachment = Attachment.objects.create(
            owner=request.user,
            purpose=values["purpose"],
            status=Attachment.Status.PENDING,
            storage_key=build_storage_key(values["purpose"], values["filename"]),
            original_filename=values["filename"][:255],
            mime_type=values["mime_type"],
            declared_size_bytes=values["size_bytes"],
        )
        token, ttl = issue_access_token(attachment.id, request.user.id)
        path = reverse("attachment-content", args=[attachment.id])
        upload_url = request.build_absolute_uri(f"{path}?token={quote(token)}")
        return Response(
            {
                "id": attachment.id,
                "upload_url": upload_url,
                "method": "POST",
                "field_name": "file",
                "expires_at": timezone.now() + timedelta(seconds=ttl),
                "max_bytes": max_bytes_for(values["purpose"]),
            },
            status=status.HTTP_201_CREATED,
        )


class AttachmentContentView(APIView):
    """按签名令牌收发字节。

    这个端点**不使用 Token 认证**：它的可信凭据是 URL 里的短期签名，因为
    `<image src>` / `wx.downloadFile` 无法携带自定义请求头。签名只绑定一张
    附件，过期即失效，也因此不存在"猜 id 就能读别人文件"的通路。
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    serializer_class = AttachmentSerializer

    def _resolve(self, request, attachment_id):
        token = request.query_params.get("token", "")
        if not token:
            raise SpineError("缺少访问令牌。", ErrorCode.AUTH_REQUIRED, 401)
        try:
            signed_id, signed_owner = read_access_token(token)
        except StorageError as error:
            raise SpineError(str(error), ErrorCode.AUTH_REQUIRED, 401)
        attachment = Attachment.objects.filter(pk=attachment_id, status=Attachment.Status.READY).first()
        if attachment is None:
            raise SpineError("附件不存在。", ErrorCode.NOT_FOUND, 404)
        if str(attachment.id) != str(signed_id):
            # 令牌与路径不一致：拿 A 的令牌去读 B，直接拒绝。
            raise SpineError("访问令牌与目标附件不匹配。", ErrorCode.FORBIDDEN, 403)
        expected_owner = str(attachment.owner_id) if attachment.owner_id else ""
        if expected_owner != str(signed_owner or ""):
            raise SpineError("访问令牌无效。", ErrorCode.FORBIDDEN, 403)
        return attachment

    def get(self, request, attachment_id):
        attachment = self._resolve(request, attachment_id)
        storage = get_storage()
        if not storage.exists(attachment.storage_key):
            raise SpineError("附件内容已不可用。", ErrorCode.NOT_FOUND, 404)
        disposition = "attachment" if request.query_params.get("download") else "inline"
        filename = quote(attachment.original_filename or "attachment")
        response = FileResponse(
            storage.open(attachment.storage_key),
            content_type=attachment.mime_type or "application/octet-stream",
        )
        response["Content-Disposition"] = f"{disposition}; filename*=UTF-8''{filename}"
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    @extend_schema(request=None, responses=AttachmentSerializer, tags=["Attachments"],
                   parameters=[OpenApiParameter("token", str, OpenApiParameter.QUERY, required=True)])
    def post(self, request, attachment_id):
        token = request.query_params.get("token", "")
        if not token:
            raise SpineError("缺少上传令牌。", ErrorCode.AUTH_REQUIRED, 401)
        try:
            signed_id, signed_owner = read_access_token(token)
        except StorageError as error:
            raise SpineError(str(error), ErrorCode.AUTH_REQUIRED, 401)
        attachment = Attachment.objects.filter(pk=attachment_id).first()
        if attachment is None:
            raise SpineError("附件不存在。", ErrorCode.NOT_FOUND, 404)
        if str(attachment.id) != str(signed_id) or str(attachment.owner_id or "") != str(signed_owner or ""):
            raise SpineError("上传令牌与目标附件不匹配。", ErrorCode.FORBIDDEN, 403)
        if attachment.status == Attachment.Status.READY:
            # 客户端重试上传同一张已完成的附件，按成功处理，不必再传一次。
            return Response(serialize_attachment(request, attachment))
        if attachment.status != Attachment.Status.PENDING:
            raise SpineError("该附件当前不接受上传。", ErrorCode.VALIDATION_ERROR, 409)
        upload = request.FILES.get("file")
        if upload is None:
            raise SpineError("缺少文件字段 file。", ErrorCode.VALIDATION_ERROR, 400)

        limit = max_bytes_for(attachment.purpose)
        if upload.size and upload.size > limit:
            raise SpineError(
                f"文件超过该用途上限（{limit // (1024 * 1024)} MiB）。",
                ErrorCode.UPLOAD_TOO_LARGE,
                413,
            )
        storage = get_storage()
        try:
            size, checksum, head = storage.save_stream(attachment.storage_key, upload, limit)
        except UploadTooLarge:
            raise SpineError(
                f"文件超过该用途上限（{limit // (1024 * 1024)} MiB）。",
                ErrorCode.UPLOAD_TOO_LARGE,
                413,
            )
        except StorageError:
            raise SpineError("附件写入失败，请重试。", ErrorCode.INTERNAL_ERROR, 500)

        # 客户端自报的 MIME 与扩展名都可能撒谎，落盘后按魔数再核一次，不符就清掉。
        actual = sniff_mime(head)
        if actual is None or actual != attachment.mime_type:
            storage.delete(attachment.storage_key)
            raise SpineError(
                "文件内容与声明的类型不符，已拒绝保存。",
                ErrorCode.UNSUPPORTED_FILE_TYPE,
                415,
            )

        attachment.size_bytes = size
        attachment.checksum_sha256 = checksum
        attachment.save(update_fields=["size_bytes", "checksum_sha256", "updated_at"])
        return Response(serialize_attachment(request, attachment), status=status.HTTP_201_CREATED)


class AttachmentCompleteView(APIView):
    """确认上传完成，把附件从 pending 转为 ready。

    幂等：对同一张已 ready 的附件重复调用返回 200 而不是报错。
    """

    @extend_schema(request=None, responses=AttachmentSerializer, tags=["Attachments"])
    def post(self, request, attachment_id):
        attachment = Attachment.objects.filter(
            pk=attachment_id, owner=request.user
        ).first()
        if attachment is None:
            raise SpineError("附件不存在。", ErrorCode.NOT_FOUND, 404)
        if attachment.status == Attachment.Status.READY:
            return Response(serialize_attachment(request, attachment))
        if attachment.status != Attachment.Status.PENDING:
            raise SpineError("该附件当前无法确认。", ErrorCode.VALIDATION_ERROR, 409)
        storage = get_storage()
        actual_size = storage.size(attachment.storage_key)
        if actual_size is None:
            raise SpineError("尚未收到文件内容。", ErrorCode.VALIDATION_ERROR, 409)
        if actual_size == 0:
            raise SpineError("上传内容为空。", ErrorCode.VALIDATION_ERROR, 409)
        attachment.size_bytes = actual_size
        attachment.status = Attachment.Status.READY
        attachment.save(update_fields=["size_bytes", "status", "updated_at"])
        return Response(serialize_attachment(request, attachment))


class AttachmentAccessView(APIView):
    """为已登录用户再签一条短期地址（预览、下载、刷新过期链接都走这里）。"""

    @extend_schema(responses=AttachmentSerializer, tags=["Attachments"])
    def get(self, request, attachment_id):
        attachment = Attachment.objects.filter(pk=attachment_id, status=Attachment.Status.READY).first()
        if attachment is None:
            raise SpineError("附件不存在。", ErrorCode.NOT_FOUND, 404)
        is_owner = attachment.owner_id == request.user.id
        if not is_owner and attachment.purpose not in PUBLIC_READ_PURPOSES:
            # 不区分"不存在"与"无权限"之外的细节，也不回显附件用途。
            raise SpineError("无权访问该附件。", ErrorCode.FORBIDDEN, 403)
        return Response(serialize_attachment(request, attachment))


class AttachmentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={204: None}, tags=["Attachments"])
    def delete(self, request, attachment_id):
        attachment = Attachment.objects.filter(pk=attachment_id, owner=request.user).first()
        if attachment is None:
            raise SpineError("附件不存在。", ErrorCode.NOT_FOUND, 404)
        if attachment.status != Attachment.Status.DELETED:
            get_storage().delete(attachment.storage_key)
            attachment.status = Attachment.Status.DELETED
            attachment.deleted_at = timezone.now()
            attachment.save(update_fields=["status", "deleted_at", "updated_at"])
            if attachment.purpose == Attachment.Purpose.MEDICAL:
                from profiles.views import refresh_onboarding_status
                refresh_onboarding_status(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)
