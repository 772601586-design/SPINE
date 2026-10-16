"""Private daily life records and explicitly published community content."""
import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.core.exceptions import ValidationError
from django.db import models


class Preferences(models.Model):
    owner = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    review_enabled = models.BooleanField(default=False)
    review_date = models.DateField(null=True, blank=True)
    sedentary_minutes = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(240)])
    swim_weekdays = models.JSONField(default=list, blank=True)
    brace_target_hours = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(24)])


class DailyRecord(models.Model):
    class Kind(models.TextChoices):
        SWIM = "swim", "游泳"
        PAIN = "pain", "身体记录"
        DRAWING = "drawing", "每周绘画"
        STANDING = "standing", "站姿记录"
        MAKEUP = "makeup", "日历补记"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    request_id = models.UUIDField(default=uuid.uuid4)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    date = models.DateField()
    minutes = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(1440)])
    pain = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(10)])
    notes = models.TextField(max_length=2000, blank=True)
    attachment = models.ForeignKey("core.Attachment", null=True, blank=True, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "-id"]
        constraints = [models.UniqueConstraint(fields=["owner", "request_id"], name="life_record_request_unique"),
            models.UniqueConstraint(fields=["owner", "date"], condition=models.Q(kind="makeup"), name="life_makeup_date_unique")]


class Article(models.Model):
    title = models.CharField(max_length=160)
    category = models.CharField(max_length=32, choices=[("guide", "支具生活"), ("learning", "认知学习")])
    topic = models.CharField(max_length=40, blank=True)
    body = models.TextField(max_length=20000)
    reviewer = models.CharField(max_length=100, blank=True)
    published = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)
    question = models.CharField(max_length=300, blank=True)
    options = models.JSONField(default=list, blank=True)
    correct_option = models.PositiveSmallIntegerField(default=0)
    explanation = models.CharField(max_length=1000, blank=True)

    def clean(self):
        if self.published and (not self.reviewer.strip() or not self.body.strip()):
            raise ValidationError("发布文章必须有正文和审核人。")
        if self.question and (not isinstance(self.options, list) or len(self.options) < 2
                or any(not isinstance(option, str) or not option.strip() for option in self.options)
                or not 0 <= self.correct_option < len(self.options)):
            raise ValidationError("请设置至少两个有效选项和正确答案。")


class LearningRecord(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    article = models.ForeignKey(Article, on_delete=models.PROTECT)
    read_at = models.DateTimeField(auto_now_add=True)
    passed = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "article"], name="life_learning_unique")]


class Reward(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    event = models.CharField(max_length=100)
    points = models.SmallIntegerField()
    label = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]
        constraints = [models.UniqueConstraint(fields=["owner", "event"], name="life_reward_event_unique")]


class Post(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    request_id = models.UUIDField(default=uuid.uuid4)
    group = models.CharField(max_length=20, choices=[("companions", "同行伙伴"), ("brace", "支具生活"), ("deco", "Deco")])
    body = models.TextField(max_length=2000)
    status = models.CharField(max_length=16, default="pending", choices=[("pending", "审核中"), ("published", "已发布"), ("rejected", "未通过")])
    moderation_note = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]
        constraints = [models.UniqueConstraint(fields=["owner", "request_id"], name="life_post_request_unique")]


class PostLike(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name="likes")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "post"], name="life_post_like_unique")]


class PostReport(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    post = models.ForeignKey(Post, on_delete=models.CASCADE)
    reason = models.CharField(max_length=500)
    resolved = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "post"], name="life_post_report_unique")]


class PrescriptionImport(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    request_id = models.UUIDField()
    rows = models.JSONField()
    result = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "request_id"], name="life_prescription_request_unique")]
