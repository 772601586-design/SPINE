from django.db import models
from django.core.exceptions import ValidationError


class TaxonomyTerm(models.Model):
    code = models.SlugField(max_length=64, unique=True)
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=300, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        abstract = True
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name


class Region(TaxonomyTerm):
    """可配置的身体区域浏览入口。"""


class Muscle(TaxonomyTerm):
    """独立知识标签；区域和肌群之间允许多对多关联。"""


class Goal(TaxonomyTerm):
    """动作目标标签，不代表个人处方。"""


class Exercise(models.Model):
    GENERAL = "general_fitness", "普通体能"
    SPECIAL = "scoliosis_specific", "侧弯专项"
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.current_version.name if hasattr(self, "current_version") else str(self.pk)


class ExerciseVersion(models.Model):
    DRAFT = "draft"
    REVIEWED = "reviewed"
    PUBLISHED = "published"
    RETIRED = "retired"
    STATUSES = [(v, v.title()) for v in (DRAFT, REVIEWED, PUBLISHED, RETIRED)]
    category = models.CharField(max_length=32, choices=[Exercise.GENERAL, Exercise.SPECIAL], default=Exercise.GENERAL[0])
    requires_individual_setup = models.BooleanField(default=False)

    exercise = models.ForeignKey(Exercise, related_name="versions", on_delete=models.PROTECT)
    version = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=16, choices=STATUSES, default=DRAFT)
    name = models.CharField(max_length=160)
    summary = models.CharField(max_length=500, blank=True)
    regions = models.ManyToManyField(Region, related_name="exercise_versions", blank=True)
    primary_muscles = models.ManyToManyField(Muscle, related_name="primary_exercise_versions", blank=True)
    secondary_muscles = models.ManyToManyField(Muscle, related_name="secondary_exercise_versions", blank=True)
    goals = models.ManyToManyField(Goal, related_name="exercise_versions", blank=True)
    starting_position = models.CharField(max_length=80, blank=True)
    equipment = models.JSONField(default=list, blank=True)
    preparation = models.TextField(blank=True)
    steps = models.JSONField(default=list, blank=True)
    hold_and_return = models.TextField(blank=True)
    breathing = models.TextField(blank=True)
    common_compensations = models.TextField(blank=True)
    cautions = models.TextField(blank=True)
    side_notes = models.TextField(blank=True)
    source_url = models.URLField(blank=True)
    author = models.CharField(max_length=160, blank=True)
    reviewer = models.CharField(max_length=160, blank=True)
    reviewed_at = models.DateField(null=True, blank=True)
    license_basis = models.CharField(max_length=300, blank=True)
    media = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name", "-version"]
        constraints = [models.UniqueConstraint(fields=["exercise", "version"], name="exercise_version_unique")]

    def save(self, *args, **kwargs):
        if self.status == self.PUBLISHED and not (self.reviewer and self.reviewed_at and self.author and self.source_url and self.license_basis):
            raise ValidationError("Published exercise versions require an author, source URL, reviewer, review date, and usage basis.")
        if self.pk:
            previous = type(self).objects.get(pk=self.pk)
            if previous.status in (self.PUBLISHED, self.RETIRED):
                changed = [field.name for field in self._meta.concrete_fields
                           if field.name not in ("id", "status", "created_at")
                           and getattr(previous, field.attname) != getattr(self, field.attname)]
                if changed or (previous.status == self.RETIRED and self.status != self.RETIRED):
                    raise ValidationError("Published exercise content is immutable; create a new version instead.")
                if self.status not in (self.PUBLISHED, self.RETIRED):
                    raise ValidationError("A published version may only be retired.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Exercise versions are retained for history; retire them instead of deleting.")

    def __str__(self):
        return f"{self.name} v{self.version} ({self.status})"
