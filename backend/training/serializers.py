from rest_framework import serializers
from django.db.models import Prefetch
from drf_spectacular.utils import extend_schema_field

from exercises.models import ExerciseVersion

from .models import PersonalActionCard, PlanVersion, SetExecution, TrainingAttempt, TrainingPlan


class PersonalActionCardSerializer(serializers.ModelSerializer):
    source_title = serializers.CharField(source="source_version.name", read_only=True, allow_null=True)
    source_summary = serializers.CharField(source="source_version.summary", read_only=True, allow_null=True)
    source_steps = serializers.JSONField(source="source_version.steps", read_only=True, allow_null=True)
    source_precautions = serializers.CharField(source="source_version.cautions", read_only=True, allow_null=True)
    source_media = serializers.JSONField(source="source_version.media", read_only=True, allow_null=True)
    source_url = serializers.CharField(source="source_version.source_url", read_only=True, allow_null=True)
    source_category = serializers.CharField(source="source_version.get_category_display", read_only=True, allow_null=True)
    completed_sets = serializers.SerializerMethodField()

    class Meta:
        model = PersonalActionCard
        fields = ("id", "plan", "source_version", "source_type", "source_title", "source_summary",
                  "source_steps", "source_precautions", "source_media", "source_url", "source_category",
                  "name", "order", "revision", "active", "verification_status", "sets", "reps_per_set",
                  "breaths_per_set", "hold_seconds", "side", "rest_seconds", "equipment", "focus_points",
                  "personal_notes", "schedule_frequency", "completed_sets", "created_at", "updated_at")
        read_only_fields = fields

    def get_completed_sets(self, obj) -> int:
        attempts = getattr(obj, "prefetched_attempts", None)
        attempt = next(iter(attempts), None) if attempts is not None else obj.attempts.order_by("-started_at").first()
        return attempt.sets_done.count() if attempt else 0


class CardUpdateSerializer(serializers.Serializer):
    expected_revision = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=160, required=False)
    sets = serializers.IntegerField(min_value=1, max_value=50, required=False, allow_null=True)
    reps_per_set = serializers.IntegerField(min_value=1, max_value=500, required=False, allow_null=True)
    breaths_per_set = serializers.IntegerField(min_value=1, max_value=500, required=False, allow_null=True)
    hold_seconds = serializers.IntegerField(min_value=1, max_value=3600, required=False, allow_null=True)
    side = serializers.ChoiceField(choices=["left", "right", "bilateral", "alternating", "not_applicable", "individualized"], required=False, allow_blank=True)
    rest_seconds = serializers.IntegerField(min_value=0, max_value=3600, required=False, allow_null=True)
    equipment = serializers.ListField(child=serializers.CharField(max_length=80), required=False)
    focus_points = serializers.ListField(child=serializers.CharField(max_length=240), max_length=3, required=False)
    personal_notes = serializers.CharField(max_length=3000, required=False, allow_blank=True)
    confirm_parameters = serializers.BooleanField(required=False, default=False)
    schedule_frequency = serializers.ChoiceField(choices=PersonalActionCard.ScheduleFrequency.choices, allow_blank=True, required=False)


class TodayActionSerializer(serializers.ModelSerializer):
    source_category = serializers.CharField(source="source_version.get_category_display", read_only=True, allow_null=True)

    class Meta:
        model = PersonalActionCard
        fields = ("id", "name", "order", "source_category", "sets", "reps_per_set", "breaths_per_set",
                  "hold_seconds", "schedule_frequency", "verification_status")


class TodayCardSerializer(serializers.Serializer):
    card = TodayActionSerializer()
    done = serializers.BooleanField()
    completed_sets_today = serializers.IntegerField()


class DeckPreviewSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class OpenAttemptSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    card_name = serializers.CharField()
    status = serializers.CharField()


class TodayDeckSerializer(serializers.Serializer):
    date = serializers.DateField()
    timezone = serializers.CharField()
    plan_id = serializers.IntegerField(allow_null=True)
    plan_title = serializers.CharField()
    plan_status = serializers.CharField()
    available = serializers.BooleanField()
    cards = TodayCardSerializer(many=True)
    tomorrow = DeckPreviewSerializer(many=True)
    done_count = serializers.IntegerField()
    remaining_count = serializers.IntegerField()
    rest_count = serializers.IntegerField()
    unconfigured_count = serializers.IntegerField()
    needs_setup_count = serializers.IntegerField()
    open_attempt = OpenAttemptSerializer(allow_null=True)


class PlanVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlanVersion
        fields = ("version_no", "snapshot", "reason", "created_at")


class TrainingPlanSerializer(serializers.ModelSerializer):
    current_version = serializers.SerializerMethodField()
    cards = serializers.SerializerMethodField()
    completed_sets = serializers.SerializerMethodField()

    class Meta:
        model = TrainingPlan
        fields = ("id", "title", "start_date", "end_date", "timezone", "status", "current_version_no",
                  "current_version", "cards", "completed_sets")

    @extend_schema_field(PlanVersionSerializer(allow_null=True))
    def get_current_version(self, obj):
        version = obj.versions.filter(version_no=obj.current_version_no).first()
        return PlanVersionSerializer(version).data if version else None

    @extend_schema_field(PersonalActionCardSerializer(many=True))
    def get_cards(self, obj):
        cards = obj.cards.filter(active=True).select_related("source_version", "source_version__exercise").prefetch_related(
            Prefetch("attempts", queryset=TrainingAttempt.objects.order_by("-started_at").prefetch_related("sets_done"), to_attr="prefetched_attempts")
        )
        return PersonalActionCardSerializer(cards, many=True).data

    @extend_schema_field(serializers.IntegerField())
    def get_completed_sets(self, obj) -> int:
        return SetExecution.objects.filter(attempt__plan=obj).count()


class AttemptSerializer(serializers.ModelSerializer):
    card_name = serializers.CharField(source="card.name", read_only=True)
    completed_sets = serializers.SerializerMethodField()
    voice_media = serializers.SerializerMethodField()

    class Meta:
        model = TrainingAttempt
        fields = ("id", "plan", "plan_version", "card", "card_name", "card_revision", "planned_dose",
                  "status", "started_at", "ended_at", "completed_sets", "voice_media")

    def get_completed_sets(self, obj) -> int: return obj.sets_done.count()

    def get_voice_media(self, obj) -> list:
        if not obj.card.source_version_id:
            return []
        return [item for item in obj.card.source_version.media if isinstance(item, dict) and item.get("type") == "audio" and item.get("url")]


class AddActionCardSerializer(serializers.Serializer):
    exercise_version_id = serializers.IntegerField(min_value=1)


class ReorderCardsSerializer(serializers.Serializer):
    card_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=True)


class StartAttemptSerializer(serializers.Serializer):
    card_id = serializers.IntegerField(min_value=1)


class SetExecutionSerializer(serializers.ModelSerializer):
    class Meta:
        model = SetExecution
        fields = ("id", "set_index", "planned_dose_snapshot", "actual_reps", "actual_breaths",
                  "actual_hold_seconds", "confirmation_source", "sync_status", "client_request_id", "confirmed_at")
        read_only_fields = fields


class ConfirmSetSerializer(serializers.Serializer):
    set_index = serializers.IntegerField(min_value=1)
    client_request_id = serializers.UUIDField()
    actual_reps = serializers.IntegerField(min_value=0, max_value=500, required=False, allow_null=True)
    actual_breaths = serializers.IntegerField(min_value=0, max_value=500, required=False, allow_null=True)
    actual_hold_seconds = serializers.IntegerField(min_value=0, max_value=3600, required=False, allow_null=True)
    confirmation_source = serializers.ChoiceField(choices=["guided", "self_reported"], default="guided")

    def validate(self, attrs):
        if not any(attrs.get(key) is not None and attrs[key] > 0 for key in ("actual_reps", "actual_breaths", "actual_hold_seconds")):
            raise serializers.ValidationError("请填写本组实际完成量。")
        return attrs
