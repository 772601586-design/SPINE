from rest_framework import serializers

from .models import ExerciseVersion, Goal, Muscle, Region


class TermSerializer(serializers.ModelSerializer):
    class Meta:
        fields = ("code", "name", "description")


class RegionSerializer(TermSerializer):
    class Meta(TermSerializer.Meta):
        model = Region


class MuscleSerializer(TermSerializer):
    class Meta(TermSerializer.Meta):
        model = Muscle


class GoalSerializer(TermSerializer):
    class Meta(TermSerializer.Meta):
        model = Goal


class ExerciseVersionSerializer(serializers.ModelSerializer):
    already_added = serializers.BooleanField(read_only=True, default=False)
    category_label = serializers.CharField(source="get_category_display", read_only=True)
    requires_individual_setup = serializers.BooleanField(read_only=True)
    regions = RegionSerializer(many=True, read_only=True)
    primary_muscles = MuscleSerializer(many=True, read_only=True)
    secondary_muscles = MuscleSerializer(many=True, read_only=True)
    goals = GoalSerializer(many=True, read_only=True)
    region_names = serializers.SerializerMethodField()
    primary_muscle_names = serializers.SerializerMethodField()
    secondary_muscle_names = serializers.SerializerMethodField()
    goal_names = serializers.SerializerMethodField()

    def _names(self, obj, relation) -> str:
        return "、".join(getattr(obj, relation).values_list("name", flat=True))

    def get_region_names(self, obj) -> str: return self._names(obj, "regions")
    def get_primary_muscle_names(self, obj) -> str: return self._names(obj, "primary_muscles")
    def get_secondary_muscle_names(self, obj) -> str: return self._names(obj, "secondary_muscles")
    def get_goal_names(self, obj) -> str: return self._names(obj, "goals")

    class Meta:
        model = ExerciseVersion
        fields = ("id", "version", "name", "summary", "category_label", "category", "requires_individual_setup", "already_added",
                  "regions", "primary_muscles", "secondary_muscles", "goals", "region_names",
                  "primary_muscle_names", "secondary_muscle_names", "goal_names", "starting_position",
                  "equipment", "preparation", "steps", "hold_and_return", "breathing",
                  "common_compensations", "cautions", "side_notes", "media", "source_url", "author",
                  "reviewer", "reviewed_at")
