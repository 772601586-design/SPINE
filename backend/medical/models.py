"""医疗资料：按就诊事件整理（规格 v2.0 §4、§13）。

三条最容易写错、也最要紧的规则，都在这里用数据模型固定下来：

1. **日期精度必须诚实**。一次就诊只知道年月时写 `date_precision=month`，
   而不是把 1 月 1 日当成真日期塞进 `visit_date`——用假日期冒充未知日期，
   会在几年后的趋势比对里变成事实。
2. **附件类型不能合并**。X 光片照片/扫描件（`xray_image`）和影像报告
   （`imaging_report`）是两种东西，不能混成一个"诊断图片"的分类。
3. **多弯分别记录**。同一次检查允许多条 `CurveMeasurement`，不存在一个全局
   "侧弯角度"字段；历史趋势只并列同类指标，不自动合并不同弯。

**所有手填数值一律是"用户录入"，不是平台核验的医学结果**；本层不做 OCR、
不从影像推导角度、不生成诊断。
"""

import uuid

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models
from django.db.models import F

from core.models import Attachment

VISIT_MONTH_VALIDATOR = RegexValidator(
    regex=r"^\d{4}-(0[1-9]|1[0-2])$",
    message="就诊年月格式应为 YYYY-MM。",
)


class Visit(models.Model):
    class DatePrecision(models.TextChoices):
        DAY = "day", "精确到天"
        MONTH = "month", "精确到月"
        UNKNOWN = "unknown", "不详"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="visits"
    )
    visit_date = models.DateField(null=True, blank=True)
    visit_month = models.CharField(
        max_length=7, blank=True, default="", validators=[VISIT_MONTH_VALIDATOR]
    )
    date_precision = models.CharField(
        max_length=8, choices=DatePrecision.choices, default=DatePrecision.UNKNOWN
    )
    institution = models.CharField(max_length=200, blank=True, default="")
    department = models.CharField(max_length=200, blank=True, default="")
    title = models.CharField(max_length=200, blank=True, default="")
    # 医生写的原话摘录，不是平台结论；界面必须标明"用户录入"。
    diagnosis_excerpt = models.TextField(blank=True, default="", max_length=4000)
    advice_excerpt = models.TextField(blank=True, default="", max_length=4000)
    notes = models.TextField(blank=True, default="", max_length=2000)
    # 个人备忘：不等于医院已成功预约（规格 §4.2）。
    next_review_date = models.DateField(null=True, blank=True)
    revision = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # "日期不详"的就诊没有日期可比，必须排到最后：PostgreSQL 在 DESC 下默认
        # NULLS FIRST，不显式声明的话未知日期会冒充"最近一次就诊"排在时间线最前。
        ordering = [
            F("visit_date").desc(nulls_last=True),
            F("visit_month").desc(nulls_last=True),
            "-created_at",
        ]
        indexes = [models.Index(fields=["user", "-visit_date"])]
        constraints = [
            # 日期精度与日期字段严格互斥，且"精确到天/月"时对应字段必须有值。
            models.CheckConstraint(
                condition=(
                    models.Q(date_precision="day", visit_date__isnull=False, visit_month="")
                    | models.Q(date_precision="month", visit_date__isnull=True, visit_month__gt="")
                    | models.Q(date_precision="unknown", visit_date__isnull=True, visit_month="")
                ),
                name="visit_date_precision_exclusive",
            ),
        ]

    def __str__(self):
        return f"Visit<{self.user_id} {self.date_precision}>"


class MedicalAttachment(models.Model):
    """就诊资料与私有附件的绑定，带分类。

    `Attachment.purpose` 必须是 `medical`——私人医学文件不能复用为社区附件
    （规格 §4.3），所以在绑定时校验用途，而不是靠调用方自觉。
    """

    class Category(models.TextChoices):
        XRAY_IMAGE = "xray_image", "X 光影像/扫描件"
        IMAGING_REPORT = "imaging_report", "影像报告"
        DIAGNOSIS_RECORD = "diagnosis_record", "医生诊断记录"
        OTHER = "other", "其他"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    visit = models.ForeignKey(Visit, on_delete=models.CASCADE, related_name="medical_attachments")
    attachment = models.OneToOneField(
        Attachment, on_delete=models.PROTECT, related_name="medical_link"
    )
    category = models.CharField(max_length=32, choices=Category.choices)
    caption = models.CharField(max_length=200, blank=True, default="")
    # Completion of onboarding only records the user's classification/preview
    # confirmation; it is not an assessment of image quality or diagnosis.
    owner_confirmed_xray = models.BooleanField(default=False)
    xray_confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            # 一张附件只能属于一次就诊，避免同一个原件出现在两条时间线上。
            models.UniqueConstraint(fields=["attachment"], name="medical_attachment_single_visit"),
        ]

    def __str__(self):
        return f"MedicalAttachment<{self.pk} {self.category}>"


class CurveMeasurement(models.Model):
    """一次检查里的一条弯曲记录（规格 §4.2）。

    全部字段允许留空/未知：用户可能只知道"有两个弯"而不知道角度，
    系统不替他补，也不从影像推导。
    """

    class Region(models.TextChoices):
        CERVICAL = "cervical", "颈段"
        THORACIC = "thoracic", "胸段"
        THORACOLUMBAR = "thoracolumbar", "胸腰段"
        LUMBAR = "lumbar", "腰段"
        UNKNOWN = "unknown", "不详"

    class Direction(models.TextChoices):
        LEFT = "left", "左凸"
        RIGHT = "right", "右凸"
        UNKNOWN = "unknown", "不详"

    class EntrySource(models.TextChoices):
        MANUAL = "manual", "用户录入"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    visit = models.ForeignKey(Visit, on_delete=models.CASCADE, related_name="curves")
    region = models.CharField(max_length=24, choices=Region.choices)
    direction = models.CharField(max_length=16, choices=Direction.choices, default=Direction.UNKNOWN)
    cobb_angle = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    end_vertebrae = models.CharField(max_length=32, blank=True, default="")
    # 指向本次就诊里的某张附件（例如角度是在哪份报告里看到的）。
    source_attachment = models.ForeignKey(
        MedicalAttachment, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    source_text = models.CharField(max_length=500, blank=True, default="")
    entered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    # 首版只有手工录入；保留字段是为了以后接 OCR 时能区分来源，而不是现在就说有 OCR。
    entry_source = models.CharField(
        max_length=16, choices=EntrySource.choices, default=EntrySource.MANUAL, editable=False
    )
    revision = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(cobb_angle__isnull=True) | models.Q(cobb_angle__gte=0, cobb_angle__lte=180),
                name="curve_angle_0_180",
            ),
        ]

    def __str__(self):
        return f"CurveMeasurement<{self.visit_id} {self.region}>"
