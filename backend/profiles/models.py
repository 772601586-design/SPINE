"""身份与基础档案（规格 v2.0 §3、§13）。

设计要点：

- **Profile 与 User 分开**。User 承载微信私有身份（openid 只落在 WechatAccount），
  Profile 承载可展示的昵称与私密档案，两者的序列化器不共用，避免某个接口
  顺手把私密字段带出去。
- **登录不等于拿到昵称/头像**。微信不再默认下发用户资料，`nickname` 由用户自己
  填，`avatar` 由用户自己选；这里不预填任何微信侧资料。
- **身高体重保留历史**。每次测量建一行，最新值从记录派生，不做原地覆盖——
  否则「上次量的多少」这种问题永远答不上来。
"""

import uuid

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models

from core.models import Attachment

# 出生年月只到月：YYYY-MM。不用某月的 1 日去冒充"只知道年月"。
BIRTH_MONTH_VALIDATOR = RegexValidator(
    regex=r"^\d{4}-(0[1-9]|1[0-2])$",
    message="出生年月格式应为 YYYY-MM。",
)


class ManagementMethod(models.TextChoices):
    """管理方式的可选值。

    这是**可编辑的产品字典**，不是医学分类，也不代表平台推荐任何一种。
    """

    OBSERVATION = "observation", "观察随访"
    PHYSIOTHERAPY = "physiotherapy", "物理治疗/康复训练"
    BRACE = "brace", "支具"
    SURGERY = "surgery", "手术"
    OTHER = "other", "其他"


class Profile(models.Model):
    class TreatmentStage(models.TextChoices):
        CHECK = "check", "刚发现侧弯，还在检查"
        NEW = "new", "刚开始戴支具"
        BRACE = "brace", "支具与运动训练"
        MAINTENANCE = "maintenance", "已脱支具，以运动为主"
        ADULT = "adult", "成年后自我管理"

    class Gender(models.TextChoices):
        FEMALE = "female", "女"
        MALE = "male", "男"
        CUSTOM = "custom", "自定义"

    class MenarcheStatus(models.TextChoices):
        NOT_YET = "not_yet", "还没有"
        STARTED = "started", "已经来了"
        PREFER_NOT = "prefer_not", "不想填"

    class OnboardingStatus(models.TextChoices):
        DRAFT = "draft", "待补充 X 光影像"
        COMPLETE = "complete", "建档资料已确认"
        NEEDS_UPDATE = "needs_update", "需要更新档案"
    class DiagnosisStatus(models.TextChoices):
        DIAGNOSED = "diagnosed", "已诊断"
        UNDER_INVESTIGATION = "under_investigation", "正在检查"
        UNCLEAR = "unclear", "暂不清楚"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile"
    )
    nickname = models.CharField(max_length=50)
    # 头像也是一个私有附件：换头像不删除旧附件对象，由附件自身的生命周期管理。
    avatar = models.ForeignKey(
        Attachment, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    birth_month = models.CharField(max_length=7, blank=True, default="", validators=[BIRTH_MONTH_VALIDATOR])
    treatment_stage = models.CharField(max_length=16, choices=TreatmentStage.choices, blank=True, default="")
    gender = models.CharField(max_length=16, choices=Gender.choices, blank=True, default="")
    gender_custom = models.CharField(max_length=50, blank=True, default="")
    menarche_status = models.CharField(max_length=16, choices=MenarcheStatus.choices, blank=True, default="")
    # 建档只强制昵称；诊断状态留空表示"还没填"，不替用户猜。
    diagnosis_status = models.CharField(
        max_length=24, choices=DiagnosisStatus.choices, blank=True, null=True
    )
    first_diagnosed_date = models.DateField(null=True, blank=True)
    # 受控多选，存 code 列表；不用 JSON 锁死结构，便于以后扩字典。
    management_methods = models.JSONField(default=list, blank=True)
    notes = models.TextField(blank=True, max_length=2000)
    onboarding_status = models.CharField(
        max_length=16, choices=OnboardingStatus.choices, default=OnboardingStatus.DRAFT
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_revision = models.PositiveIntegerField(null=True, blank=True)
    revision = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Profile"
        verbose_name_plural = "Profiles"

    def __str__(self):
        return f"Profile<{self.user_id}>"


class BodyMeasurement(models.Model):
    class Source(models.TextChoices):
        SELF = "self", "自己记录"
        VISIT = "visit", "就诊记录"
        OTHER = "other", "其他"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="body_measurements"
    )
    measured_at = models.DateTimeField()
    height_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    weight_kg = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.SELF)
    notes = models.TextField(blank=True, max_length=1000)
    revision = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-measured_at", "-created_at"]
        indexes = [models.Index(fields=["user", "-measured_at"])]
        constraints = [
            # 两样都空的行没有意义，会污染"最新身高/体重"的派生。
            models.CheckConstraint(
                condition=models.Q(height_cm__isnull=False) | models.Q(weight_kg__isnull=False),
                name="body_measurement_has_value",
            ),
        ]

    def __str__(self):
        return f"BodyMeasurement<{self.user_id} {self.measured_at:%Y-%m-%d}>"
