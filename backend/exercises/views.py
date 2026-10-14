from rest_framework import mixins, serializers, viewsets
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Exists, OuterRef, Q
from drf_spectacular.utils import OpenApiParameter, extend_schema_view, extend_schema

from .models import ExerciseVersion, Goal, Muscle, Region
from .serializers import ExerciseVersionSerializer, GoalSerializer, MuscleSerializer, RegionSerializer


class ExerciseTaxonomySerializer(serializers.Serializer):
    regions = RegionSerializer(many=True)
    muscles = MuscleSerializer(many=True)
    goals = GoalSerializer(many=True)
    postures = serializers.ListField(child=serializers.DictField())
    equipment = serializers.ListField(child=serializers.CharField())


class ExerciseTaxonomyView(APIView):
    serializer_class = ExerciseTaxonomySerializer
    permission_classes = [AllowAny]

    def get(self, request):
        published = ExerciseVersion.objects.filter(status=ExerciseVersion.PUBLISHED, reviewer__gt="", reviewed_at__isnull=False)
        equipment = sorted({value for values in published.values_list("equipment", flat=True) for value in values if isinstance(value, str) and value.strip()})
        return Response({
            "regions": RegionSerializer(Region.objects.filter(is_active=True), many=True).data,
            "muscles": MuscleSerializer(Muscle.objects.filter(is_active=True), many=True).data,
            "goals": GoalSerializer(Goal.objects.filter(is_active=True), many=True).data,
            "postures": [{"code": code, "name": name} for code, name in [
                ("standing", "站立"), ("sitting", "坐"), ("supine", "仰卧"), ("prone", "俯卧"),
                ("side_lying", "侧卧"), ("quadruped", "四点支撑"), ("other", "其他"),
            ]],
            "equipment": equipment,
        })


@extend_schema_view(list=extend_schema(parameters=[
    OpenApiParameter("region", str, description="按身体区域 code 筛选"),
    OpenApiParameter("muscle", str, description="按主肌群或次肌群 code 筛选"),
    OpenApiParameter("goal", str, description="按目标 code 筛选"),
    OpenApiParameter("category", str, description="general_fitness 或 scoliosis_specific"),
    OpenApiParameter("posture", str, description="按起始体位筛选"),
    OpenApiParameter("equipment", str, description="按器材筛选"),
]))
class ExerciseViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Public catalog is limited to reviewed resources explicitly published by editors."""
    permission_classes = [AllowAny]
    serializer_class = ExerciseVersionSerializer
    lookup_field = "id"

    def get_queryset(self):
        queryset = ExerciseVersion.objects.filter(
            status=ExerciseVersion.PUBLISHED, exercise__is_active=True,
            reviewer__gt="", reviewed_at__isnull=False,
        ).select_related("exercise").prefetch_related("regions", "primary_muscles", "secondary_muscles", "goals")
        for param, field in (("region", "regions__code"), ("goal", "goals__code")):
            value = self.request.query_params.get(param)
            if value:
                queryset = queryset.filter(**{field: value})
        muscle = self.request.query_params.get("muscle")
        if muscle:
            queryset = queryset.filter(Q(primary_muscles__code=muscle) | Q(secondary_muscles__code=muscle))
        category = self.request.query_params.get("category")
        if category in ("general_fitness", "scoliosis_specific"):
            queryset = queryset.filter(category=category)
        posture = self.request.query_params.get("posture")
        if posture:
            queryset = queryset.filter(starting_position__iexact=posture)
        equipment = self.request.query_params.get("equipment")
        if equipment:
            queryset = queryset.filter(equipment__contains=[equipment])
        if getattr(self.request.user, "is_authenticated", False):
            from training.models import PersonalActionCard
            queryset = queryset.annotate(already_added=Exists(PersonalActionCard.objects.filter(
                owner=self.request.user, source_version_id=OuterRef("pk"), active=True,
            )))
        return queryset.distinct()
