from django.contrib import admin

from .models import Exercise, ExerciseVersion, Goal, Muscle, Region


class ExerciseAdmin(admin.ModelAdmin):
    list_display = ("id", "current_name", "is_active", "created_at")
    list_filter = ("is_active",)
    search_fields = ("versions__name",)

    @admin.display(description="当前名称")
    def current_name(self, obj):
        version = obj.versions.order_by("-version").first()
        return version.name if version else "（未命名草稿）"


class ExerciseVersionAdmin(admin.ModelAdmin):
    list_display = ("name", "exercise", "version", "category", "status", "reviewer", "reviewed_at")
    list_filter = ("status", "category", "requires_individual_setup")
    search_fields = ("name", "summary", "author", "source_url")
    filter_horizontal = ("regions", "primary_muscles", "secondary_muscles", "goals")
    readonly_fields = ("created_at",)

    def get_readonly_fields(self, request, obj=None):
        readonly = list(super().get_readonly_fields(request, obj))
        if obj and obj.status in (ExerciseVersion.PUBLISHED, ExerciseVersion.RETIRED):
            readonly.extend(field.name for field in obj._meta.concrete_fields if field.name not in ("id", "status", "created_at"))
            readonly.extend(field.name for field in obj._meta.many_to_many)
        return tuple(dict.fromkeys(readonly))


class RegionAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "sort_order", "is_active")
    list_editable = ("sort_order", "is_active")
    search_fields = ("name", "code")


class MuscleAdmin(RegionAdmin):
    pass


class GoalAdmin(RegionAdmin):
    pass
