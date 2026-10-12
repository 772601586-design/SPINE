from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from rest_framework import serializers

from .models import Brace, ComfortEntry, ComfortFollowUp, WearRevision, WearSession


class BraceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Brace
        fields = ["id", "name", "brace_type", "notes", "started_on", "institution", "is_active", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate(self, attrs):
        if self.instance and attrs.get("is_active") is False:
            if WearSession.objects.filter(brace=self.instance, ended_at__isnull=True).exists():
                raise serializers.ValidationError({"is_active": "该支具仍有未结束佩戴记录，请先结束后再停用。"})
        return attrs


class WearSerializer(serializers.ModelSerializer):
    class Meta:
        model = WearSession
        fields = ["id", "brace", "started_at", "ended_at", "original_timezone", "source", "request_id", "notes", "version", "created_at", "updated_at"]
        read_only_fields = ["id", "source", "version", "created_at", "updated_at"]


class WearInputSerializer(serializers.Serializer):
    brace = serializers.IntegerField(min_value=1)
    request_id = serializers.UUIDField()
    started_at = serializers.DateTimeField(required=False)
    ended_at = serializers.DateTimeField(required=False, allow_null=True)
    original_timezone = serializers.CharField(default="Asia/Shanghai", max_length=64)
    notes = serializers.CharField(default="", allow_blank=True, max_length=2000)

    def validate_original_timezone(self, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise serializers.ValidationError("无效的原始时区。")
        return value


class WearCorrectionSerializer(serializers.Serializer):
    started_at = serializers.DateTimeField(required=False)
    ended_at = serializers.DateTimeField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    version = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(max_length=500)


class WearEndSerializer(serializers.Serializer):
    ended_at = serializers.DateTimeField(required=False)


class RevisionSerializer(serializers.ModelSerializer):
    class Meta:
        model = WearRevision
        fields = ["id", "before", "after", "reason", "created_at"]
        read_only_fields = fields


class ComfortSerializer(serializers.ModelSerializer):
    positions = serializers.ListField(child=serializers.CharField(max_length=100), max_length=20, required=False)
    tags = serializers.ListField(child=serializers.CharField(max_length=100), max_length=20, required=False)
    pain = serializers.IntegerField(min_value=0, max_value=10, allow_null=True, required=False)
    comfort_level = serializers.IntegerField(min_value=1, max_value=5, allow_null=True, required=False)

    class Meta:
        model = ComfortEntry
        fields = ["id", "brace", "wear_session", "comfort_level", "pain", "pain_note", "positions", "tags", "occurred_at", "notes", "request_id", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        owner = self.context["request"].user
        brace = attrs.get("brace", getattr(self.instance, "brace", None))
        wear = attrs.get("wear_session", getattr(self.instance, "wear_session", None))
        if brace is None or brace.owner_id != owner.id:
            raise serializers.ValidationError({"brace": "支具不存在或不可访问。"})
        if wear and (wear.owner_id != owner.id or wear.brace_id != brace.id):
            raise serializers.ValidationError({"wear_session": "佩戴记录必须属于本人及同一支具。"})
        if self.instance and "request_id" in attrs and attrs["request_id"] != self.instance.request_id:
            raise serializers.ValidationError({"request_id": "不能修改请求标识。"})
        return attrs

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if request and request.user and request.user.is_authenticated:
            fields["brace"].queryset = Brace.objects.filter(owner=request.user)
            fields["wear_session"].queryset = WearSession.objects.filter(owner=request.user)
        else:
            fields["brace"].queryset = Brace.objects.none()
            fields["wear_session"].queryset = WearSession.objects.none()
        return fields


class ComfortFollowUpSerializer(serializers.ModelSerializer):
    class Meta:
        model = ComfortFollowUp
        fields = ["id", "entry", "status", "occurred_at", "notes", "request_id", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_entry(self, value):
        if value.owner_id != self.context["request"].user.id:
            raise serializers.ValidationError("感受记录不存在或不可访问。")
        return value

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        fields["entry"].queryset = ComfortEntry.objects.filter(owner=request.user) if request and request.user and request.user.is_authenticated else ComfortEntry.objects.none()
        return fields
