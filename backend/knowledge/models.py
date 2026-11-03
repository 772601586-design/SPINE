"""Editorial data only. No foreign keys to private medical/training records."""
import uuid

from django.conf import settings
from django.db import models


class Category(models.Model):
    id = models.SlugField(primary_key=True)
    name = models.CharField(max_length=80, unique=True)
    description = models.CharField(max_length=300, blank=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['order', 'id']


class Tag(models.Model):
    name = models.CharField(max_length=80, unique=True)
    synonyms = models.JSONField(default=list, blank=True)


class Topic(models.Model):
    id = models.SlugField(primary_key=True)
    name = models.CharField(max_length=80)
    description = models.TextField(blank=True)
    color = models.CharField(max_length=7, default='#597F81')
    order = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ['order', 'id']


class Question(models.Model):
    text = models.CharField(max_length=300, unique=True)
    category = models.ForeignKey(Category, on_delete=models.PROTECT)
    featured = models.BooleanField(default=False)


class Source(models.Model):
    class State(models.TextChoices):
        UNCHECKED = 'unchecked', '未核对'
        LOCATED = 'located', '已定位'
        VERIFIED = 'verified', '已核对'
        INVALID = 'invalid', '失效或撤回'

    id = models.SlugField(primary_key=True, max_length=100)
    title = models.CharField(max_length=700)
    organization = models.CharField(max_length=250, blank=True)
    authors = models.TextField(blank=True)
    year = models.PositiveSmallIntegerField(null=True, blank=True)
    url = models.URLField(max_length=1500)
    doi = models.CharField(max_length=200, blank=True)
    pmid = models.CharField(max_length=30, blank=True)
    evidence_type = models.CharField(max_length=100, blank=True)
    population = models.TextField(blank=True)
    verification_status = models.CharField(max_length=16, choices=State.choices, default=State.UNCHECKED)
    verification_note = models.TextField(blank=True)
    verified_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)
    verified_at = models.DateTimeField(null=True)
    link_status = models.CharField(max_length=80, default='not_checked')
    link_checked_at = models.DateTimeField(null=True)
    metadata = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class Article(models.Model):
    id = models.SlugField(primary_key=True, max_length=100)
    publication_status = models.CharField(max_length=16, default='draft', choices=[('draft', '草稿'), ('published', '已发布'), ('withdrawn', '已撤稿')])
    published_version = models.ForeignKey('ArticleVersion', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    withdrawal_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ArticleVersion(models.Model):
    article = models.ForeignKey(Article, related_name='versions', on_delete=models.PROTECT)
    number = models.PositiveIntegerField()
    title = models.CharField(max_length=300)
    summary = models.TextField()
    body_markdown = models.TextField()
    audience = models.CharField(max_length=500)
    content_type = models.CharField(max_length=60, default='patient_education')
    risk_level = models.CharField(max_length=16, default='medium', choices=[('low', '低'), ('medium', '中'), ('high', '高')])
    keywords = models.JSONField(default=list, blank=True)
    categories = models.ManyToManyField(Category)
    questions = models.ManyToManyField(Question)
    tags = models.ManyToManyField(Tag, blank=True)
    topics = models.ManyToManyField(Topic, blank=True)
    sources = models.ManyToManyField(Source, blank=True)
    related_ids = models.JSONField(default=list, blank=True)
    review_status = models.CharField(max_length=16, default='draft', choices=[('draft', '草稿'), ('submitted', '待审核'), ('changes', '要求修改'), ('approved', '审核通过')])
    editor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    revision = models.PositiveIntegerField(default=1)
    review_due_date = models.DateField(null=True, blank=True)
    imported_metadata = models.JSONField(default=dict, blank=True)
    source_snapshot = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-number']
        constraints = [models.UniqueConstraint(fields=['article', 'number'], name='kb_article_version_unique')]


class Claim(models.Model):
    version = models.ForeignKey(ArticleVersion, on_delete=models.PROTECT, related_name='claims')
    text = models.TextField()
    article_location = models.CharField(max_length=500)
    important = models.BooleanField(default=True)


class ClaimSource(models.Model):
    claim = models.ForeignKey(Claim, on_delete=models.CASCADE, related_name='evidence')
    source = models.ForeignKey(Source, on_delete=models.PROTECT)
    locator = models.CharField(max_length=1000)
    note = models.TextField(blank=True)
    verification_status = models.CharField(max_length=16, choices=Source.State.choices, default='unchecked')
    verified_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)
    verified_at = models.DateTimeField(null=True)
    source_snapshot = models.JSONField(default=dict, blank=True)


class Review(models.Model):
    version = models.ForeignKey(ArticleVersion, on_delete=models.PROTECT, related_name='reviews')
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    decision = models.CharField(max_length=16, choices=[('approved', '审核通过'), ('changes', '要求修改')])
    note = models.TextField()
    content_digest = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)


class Bookmark(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    article = models.ForeignKey(Article, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'article'], name='kb_bookmark_unique')]


class Feedback(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    version = models.ForeignKey(ArticleVersion, on_delete=models.PROTECT)
    text = models.CharField(max_length=2000)
    status = models.CharField(max_length=16, default='open', choices=[('open', '待处理'), ('resolved', '已处理')])
    response = models.TextField(blank=True)
    handled_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)


class CommunityLink(models.Model):
    article = models.ForeignKey(Article, on_delete=models.PROTECT)
    post = models.ForeignKey('life.Post', on_delete=models.CASCADE)
    approved = models.BooleanField(default=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['article', 'post'], name='kb_community_link_unique')]


class ImportJob(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    filename = models.CharField(max_length=300)
    checksum = models.CharField(max_length=64)
    status = models.CharField(max_length=20, default='preview')
    payload = models.JSONField(default=dict)
    report = models.JSONField(default=dict)
    created_ids = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class AuditLog(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)
    action = models.CharField(max_length=60)
    object_type = models.CharField(max_length=60)
    object_id = models.CharField(max_length=100)
    changes = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-id']
