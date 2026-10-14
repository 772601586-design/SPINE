"""就诊、附件绑定与多弯记录的读写规则（规格 v2.0 §4）。"""

from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from core.attachment_views import serialize_attachment
from core.errors import ErrorCode, SpineError
from core.models import Attachment
from medical.models import VISIT_MONTH_VALIDATOR, CurveMeasurement, MedicalAttachment, Visit

# 容忍客户端时钟偏差：超过一天才算"未来"。
FUTURE_TOLERANCE = timedelta(days=1)


class VisitSerializer(serializers.ModelSerializer):
    """列表与写入用的形状。详情另见 `VisitDetailSerializer`。"""

    expected_revision = serializers.IntegerField(required=False, write_only=True, min_value=1)
    attachment_count = serializers.IntegerField(source="medical_attachments.count", read_only=True)
    curve_count = serializers.IntegerField(source="curves.count", read_only=True)

    class Meta:
        model = Visit
        fields = (
            "id", "visit_date", "visit_month", "date_precision",
            "institution", "department", "title",
            "diagnosis_excerpt", "advice_excerpt", "notes", "next_review_date",
            "attachment_count", "curve_count",
            "revision", "created_at", "updated_at", "expected_revision",
        )
        read_only_fields = ("id", "revision", "created_at", "updated_at")
        extra_kwargs = {
            "visit_month": {"validators": [VISIT_MONTH_VALIDATOR], "allow_blank": True},
            "date_precision": {"required": False},
        }

    def validate_visit_date(self, value):
        if value and value > timezone.localdate() + FUTURE_TOLERANCE:
            raise serializers.ValidationError("就诊日期不能在未来。")
        return value

    def validate_visit_month(self, value):
        if value:
            year, month = (int(part) for part in value.split("-"))
            today = timezone.localdate()
            if (year, month) > (today.year, today.month):
                raise serializers.ValidationError("就诊年月不能在未来。")
        return value

    def validate(self, attrs):
        """日期精度与日期字段保持一致，且不互相冒充。

        客户端可以不传 `date_precision`，由字段实际内容推导；一旦传了就必须自洽，
        因为"标记为精确到天却没有日期"这类行会让时间线的排序无声错乱。
        """
        instance = self.instance
        visit_date = attrs.get("visit_date", getattr(instance, "visit_date", None))
        visit_month = attrs.get("visit_month", getattr(instance, "visit_month", None)) or ""
        precision = attrs.get("date_precision", getattr(instance, "date_precision", None))

        if visit_date and visit_month:
            raise serializers.ValidationError("就诊日期与就诊年月不能同时填写。")
        if not visit_date and not visit_month:
            precision = Visit.DatePrecision.UNKNOWN
        elif visit_date:
            if precision == Visit.DatePrecision.MONTH:
                raise serializers.ValidationError({"date_precision": "有具体日期时精度不能是「精确到月」。"})
            precision = Visit.DatePrecision.DAY
        else:
            if precision == Visit.DatePrecision.DAY:
                raise serializers.ValidationError({"date_precision": "没有具体日期时精度不能是「精确到天」。"})
            precision = Visit.DatePrecision.MONTH
        attrs["date_precision"] = precision
        # 与精度不符的字段一律清空，避免库里出现互相矛盾的组合。
        if precision == Visit.DatePrecision.DAY:
            attrs["visit_month"] = ""
        elif precision == Visit.DatePrecision.MONTH:
            attrs["visit_date"] = None
        else:
            attrs["visit_date"] = None
            attrs["visit_month"] = ""
        return attrs


class MedicalAttachmentSerializer(serializers.ModelSerializer):
    """读形状：嵌套附件摘要（含短期地址）。"""

    attachment = serializers.SerializerMethodField()

    class Meta:
        model = MedicalAttachment
        fields = ("id", "attachment", "category", "caption", "owner_confirmed_xray",
                  "xray_confirmed_at", "created_at", "updated_at")
        read_only_fields = fields

    def get_attachment(self, obj) -> dict:
        request = self.context.get("request")
        return serialize_attachment(request, obj.attachment)


class MedicalAttachmentBindingSerializer(serializers.Serializer):
    """写形状：把已有的 `medical` 用途附件挂到这次就诊上。"""

    attachment = serializers.UUIDField()
    category = serializers.ChoiceField(choices=MedicalAttachment.Category.choices)
    caption = serializers.CharField(required=False, allow_blank=True, max_length=200, default="")
    owner_confirmed_xray = serializers.BooleanField(required=False, default=False)

    def validate_attachment(self, value):
        request = self.context.get("request")
        attachment = Attachment.objects.filter(pk=value).first()
        if attachment is None:
            raise SpineError("附件不存在。", ErrorCode.NOT_FOUND, 404)
        if attachment.owner_id != request.user.id:
            raise SpineError("无权使用该附件。", ErrorCode.FORBIDDEN, 403)
        if attachment.purpose != Attachment.Purpose.MEDICAL:
            # 社区媒体与私人记录不能混进医疗档案。
            raise SpineError("只有医疗用途的附件可以挂到就诊记录上。", ErrorCode.VALIDATION_ERROR, 400)
        if attachment.status != Attachment.Status.READY:
            raise SpineError("附件尚未完成上传。", ErrorCode.VALIDATION_ERROR, 409)
        return attachment


class MedicalAttachmentUpdateSerializer(serializers.Serializer):
    """改分类/说明。附件本身不能替换——换文件应该是新的一张附件。"""

    category = serializers.ChoiceField(choices=MedicalAttachment.Category.choices, required=False)
    caption = serializers.CharField(required=False, allow_blank=True, max_length=200)
    owner_confirmed_xray = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("至少填写一个要修改的字段。")
        return attrs


class CurveMeasurementSerializer(serializers.ModelSerializer):
    expected_revision = serializers.IntegerField(required=False, write_only=True, min_value=1)

    class Meta:
        model = CurveMeasurement
        fields = (
            "id", "region", "direction", "cobb_angle", "end_vertebrae",
            "source_attachment", "source_text", "entry_source",
            "revision", "created_at", "updated_at", "expected_revision",
        )
        read_only_fields = ("id", "entry_source", "revision", "created_at", "updated_at")

    def validate_cobb_angle(self, value):
        if value is not None and not (0 <= float(value) <= 180):
            raise serializers.ValidationError("角度应在 0–180 度之间。")
        return value

    def validate_source_attachment(self, value):
        if value is None:
            return None
        visit = self.context.get("visit")
        if visit is not None and value.visit_id != visit.id:
            raise serializers.ValidationError("来源附件必须属于同一次就诊。")
        return value


class VisitDetailSerializer(VisitSerializer):
    attachments = MedicalAttachmentSerializer(source="medical_attachments", many=True, read_only=True)
    curves = CurveMeasurementSerializer(many=True, read_only=True)

    class Meta(VisitSerializer.Meta):
        fields = VisitSerializer.Meta.fields + ("attachments", "curves")
