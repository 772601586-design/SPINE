from django.utils import timezone
from rest_framework import serializers

from core.models import Attachment
from .models import Article, DailyRecord, Post, Preferences


class PreferencesSerializer(serializers.ModelSerializer):
    class Meta:
        model = Preferences
        fields = ["review_enabled", "review_date", "sedentary_minutes", "swim_weekdays", "brace_target_hours"]

    def validate_swim_weekdays(self, value):
        if not isinstance(value, list) or len(value) > 7 or any(type(day) is not int or not 0 <= day <= 6 for day in value):
            raise serializers.ValidationError("请选择周一到周日，不能重复。")
        if len(value) != len(set(value)):
            raise serializers.ValidationError("星期不能重复。")
        return sorted(value)

    def validate(self, attrs):
        enabled = attrs.get("review_enabled", getattr(self.instance, "review_enabled", False))
        date = attrs.get("review_date", getattr(self.instance, "review_date", None))
        if enabled and not date:
            raise serializers.ValidationError({"review_date": "开启提醒时请选择复查日期。"})
        minutes = attrs.get("sedentary_minutes", 0)
        if minutes and minutes < 10:
            raise serializers.ValidationError({"sedentary_minutes": "设为 0 关闭，或设置 10～240 分钟。"})
        return attrs


class DailyRecordSerializer(serializers.ModelSerializer):
    request_id = serializers.UUIDField(required=True)

    class Meta:
        model = DailyRecord
        fields = ["id", "request_id", "kind", "date", "minutes", "pain", "notes", "attachment", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate(self, attrs):
        if attrs["date"] > timezone.localdate():
            raise serializers.ValidationError({"date": "不能记录尚未发生的活动。"})
        if attrs["kind"] == "swim" and not attrs.get("minutes"):
            raise serializers.ValidationError({"minutes": "请填写实际游泳分钟数。"})
        if attrs["kind"] == "pain" and attrs.get("pain") is None:
            raise serializers.ValidationError({"pain": "请填写 0～10 分。"})
        attachment = attrs.get("attachment")
        if attachment and (attachment.owner_id != self.context["request"].user.pk or attachment.status != Attachment.Status.READY
                           or attachment.purpose != Attachment.Purpose.PRIVATE_RECORD):
            raise serializers.ValidationError({"attachment": "请选择本人已上传的私人记录图片。"})
        if attrs["kind"] == "drawing" and not attachment:
            raise serializers.ValidationError({"attachment": "请先选择并上传绘画图片。"})
        if attrs["kind"] == "makeup" and attrs["date"] >= timezone.localdate():
            raise serializers.ValidationError({"date": "补记请选择过去的日期。"})
        return attrs


class ArticleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Article
        fields = ["id", "title", "category", "topic", "body", "reviewer", "updated_at", "question", "options"]


class PostSerializer(serializers.ModelSerializer):
    request_id = serializers.UUIDField(required=True, write_only=True)
    mine = serializers.SerializerMethodField()
    author = serializers.SerializerMethodField()
    like_count = serializers.IntegerField(read_only=True)
    liked = serializers.BooleanField(read_only=True)

    class Meta:
        model = Post
        fields = ["id", "request_id", "group", "body", "status", "moderation_note", "created_at", "mine", "author", "like_count", "liked"]
        read_only_fields = ["id", "status", "moderation_note", "created_at"]

    def get_mine(self, obj):
        return obj.owner_id == self.context["request"].user.pk

    def get_author(self, obj):
        # Public posts never serialize health profile, real name or internal user ID.
        return "我" if self.get_mine(obj) else "同行伙伴"
