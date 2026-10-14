"""档案与身体测量的读写规则（规格 v2.0 §3、§14）。

写入口只信任 token 里的用户，不接受请求体里的 owner；档案更新用
`expected_revision` 防覆盖，副作用请求可用 `Idempotency-Key` 去重。
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from core.attachment_views import serialize_attachment
from core.errors import ErrorCode, SpineError
from core.models import Attachment
from profiles.models import BIRTH_MONTH_VALIDATOR, BodyMeasurement, ManagementMethod, Profile

# 容忍客户端时钟偏差与时区边界：超过一天才算"未来"。
FUTURE_TOLERANCE = timedelta(days=1)


class AvatarField(serializers.PrimaryKeyRelatedField):
    """头像字段：只接受"头像用途 + 已完成 + 属于本人"的附件。

    校验放在这里而不是视图，是为了让 `/me` 与 `/me/profile` 两个入口共用同一套
    规则，不会因为某个入口忘了检查而被拿去引用别人的附件。
    """

    def __init__(self, **kwargs):
        kwargs.setdefault("queryset", Attachment.objects.all())
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_null", True)
        super().__init__(**kwargs)

    def use_pk_only_optimization(self):
        # 读的时候要拿完整对象（需要状态、用途、归属）来生成签名地址，
        # 不能让 DRF 只取一个 pk 占位对象。
        return False

    def to_internal_value(self, data):
        attachment = super().to_internal_value(data)
        if attachment is None:
            return None
        request = self.context.get("request")
        if attachment.purpose != Attachment.Purpose.AVATAR:
            raise SpineError("只能使用头像用途的附件。", ErrorCode.VALIDATION_ERROR, 400)
        if attachment.status != Attachment.Status.READY:
            raise SpineError("附件尚未完成上传。", ErrorCode.VALIDATION_ERROR, 409)
        if request is not None and attachment.owner_id != request.user.id:
            raise SpineError("无权使用该附件。", ErrorCode.FORBIDDEN, 403)
        return attachment

    def to_representation(self, value):
        if value is None:
            return None
        request = self.context.get("request")
        if request is None:  # pragma: no cover - 仅 schema 生成时会走到
            return {"id": str(value.id)}
        return serialize_attachment(request, value)


class ProfileSerializer(serializers.ModelSerializer):
    avatar = AvatarField()
    # 写入口不接受请求体里的 owner，也不需要客户端传 id。
    expected_revision = serializers.IntegerField(required=False, write_only=True, min_value=1)

    class Meta:
        model = Profile
        fields = (
            "id", "nickname", "avatar", "birth_month", "diagnosis_status",
            "first_diagnosed_date", "management_methods", "notes",
            "onboarding_status", "completed_at", "completed_revision",
            "revision", "created_at", "updated_at", "expected_revision",
        )
        read_only_fields = ("id", "onboarding_status", "completed_at", "completed_revision",
                            "revision", "created_at", "updated_at")
        extra_kwargs = {
            "nickname": {"max_length": 50, "allow_blank": False, "trim_whitespace": True},
            "birth_month": {"validators": [BIRTH_MONTH_VALIDATOR]},
            "notes": {"allow_blank": True, "max_length": 2000},
        }

    def validate_diagnosis_status(self, value):
        # 客户端用 "" 表示"没填"也接受，统一归一化为 None。
        return value or None

    def validate_management_methods(self, value):
        if value is None:
            return []
        allowed = set(ManagementMethod.values)
        unknown = [item for item in value if item not in allowed]
        if unknown:
            raise serializers.ValidationError(f"未知的管理方式：{'、'.join(unknown)}。")
        # 去重但保留用户选择顺序，避免同一项在档案里出现两次。
        seen, ordered = set(), []
        for item in value:
            if item not in seen:
                seen.add(item)
                ordered.append(item)
        return ordered

    def validate_first_diagnosed_date(self, value):
        if value and value > timezone.localdate():
            raise serializers.ValidationError("确诊日期不能在未来。")
        return value

    def validate_birth_month(self, value):
        if value:
            year, month = (int(part) for part in value.split("-"))
            today = timezone.localdate()
            if (year, month) > (today.year, today.month):
                raise serializers.ValidationError("出生年月不能在未来。")
        return value


class BodyMeasurementSerializer(serializers.ModelSerializer):
    expected_revision = serializers.IntegerField(required=False, write_only=True, min_value=1)

    class Meta:
        model = BodyMeasurement
        fields = (
            "id", "measured_at", "height_cm", "weight_kg", "source", "notes",
            "revision", "created_at", "updated_at", "expected_revision",
        )
        read_only_fields = ("id", "revision", "created_at", "updated_at")

    def validate_measured_at(self, value):
        if value > timezone.now() + FUTURE_TOLERANCE:
            raise serializers.ValidationError("测量时间不能在未来。")
        return value

    def validate_height_cm(self, value):
        if value is not None and not (30 <= float(value) <= 250):
            raise serializers.ValidationError("身高应在 30–250 cm 之间。")
        return value

    def validate_weight_kg(self, value):
        if value is not None and not (2 <= float(value) <= 400):
            raise serializers.ValidationError("体重应在 2–400 kg 之间。")
        return value

    def validate(self, attrs):
        height = attrs.get("height_cm", getattr(self.instance, "height_cm", None))
        weight = attrs.get("weight_kg", getattr(self.instance, "weight_kg", None))
        if height is None and weight is None:
            raise serializers.ValidationError("身高和体重至少要填一项。")
        return attrs


def latest_measurement_payload(user):
    """最新身高/体重从测量记录派生，不写回档案，避免出现两个真源。"""
    latest = BodyMeasurement.objects.filter(user=user).order_by("-measured_at", "-created_at").first()
    if latest is None:
        return None
    return {
        "measured_at": latest.measured_at,
        "height_cm": latest.height_cm,
        "weight_kg": latest.weight_kg,
        "source": latest.source,
    }
