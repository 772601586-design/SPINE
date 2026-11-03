from urllib.parse import urlparse

from django.utils import timezone
from rest_framework import serializers

from .models import Category, Source, Topic, Tag, CommunityLink
from .rendering import render_markdown


class CategoryInput(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ['id', 'name', 'description', 'order']


class TopicInput(serializers.ModelSerializer):
    def validate_color(self, value):
        import re
        if not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
            raise serializers.ValidationError('颜色须为六位十六进制值。')
        return value

    class Meta:
        model = Topic
        fields = ['id', 'name', 'description', 'color', 'order', 'active']


class TagInput(serializers.ModelSerializer):
    synonyms = serializers.ListField(child=serializers.CharField(max_length=80), max_length=30, default=list)

    class Meta:
        model = Tag
        fields = ['id', 'name', 'synonyms']


class SourceInput(serializers.ModelSerializer):
    # id duplicate handling is explicit in import; CRUD checks in the view.
    id = serializers.SlugField(max_length=100)

    def validate_url(self, value):
        parts = urlparse(value)
        if parts.scheme != 'https' or parts.username or parts.password or parts.fragment and len(parts.fragment) > 500:
            raise serializers.ValidationError('原始来源必须使用不含凭证的 HTTPS 链接。')
        return value

    class Meta:
        model = Source
        fields = ['id', 'title', 'organization', 'authors', 'year', 'url', 'doi', 'pmid', 'evidence_type', 'population', 'metadata']


def source_data(source):
    data = SourceInput(source).data
    data.update(verification_status=source.verification_status, verification_note=source.verification_note,
                verified_at=source.verified_at, link_status=source.link_status, link_checked_at=source.link_checked_at)
    return data


def version_data(version, detail=False, internal=False):
    article = version.article
    result = {key: getattr(version, key) for key in ['title', 'summary', 'audience', 'content_type', 'risk_level', 'keywords', 'review_status', 'updated_at', 'review_due_date']}
    result.update(id=article.pk, version_id=version.pk, version=version.number, publication_status=article.publication_status,
                  reviewed=version.review_status == 'approved' and version.reviews.filter(decision='approved').exists(),
                  categories=list(version.categories.values('id', 'name')), topics=list(version.topics.filter(active=True).values('id', 'name')),
                  questions=list(version.questions.values('id', 'text')), tags=list(version.tags.values('id', 'name')),
                  needs_review=bool(version.review_due_date and version.review_due_date <= timezone.localdate()) or version.sources.exclude(link_status__in=['not_checked', 'ok']).exists() or version.sources.exclude(verification_status='verified').exists())
    if detail:
        result.update(body_markdown=version.body_markdown, body_html=render_markdown(version.body_markdown),
                      sources=version.source_snapshot if version.source_snapshot and not internal else [source_data(s) for s in version.sources.all()],
                      claims=[{'id': c.pk, 'text': c.text, 'article_location': c.article_location, 'important': c.important,
                               'evidence': [{'id': e.pk, 'source': e.source_id, 'locator': e.locator, 'note': e.note,
                                             'verification_status': e.verification_status, 'verified_at': e.verified_at,
                                             'source_snapshot': e.source_snapshot} for e in c.evidence.all()]}
                              for c in version.claims.all()],
                      reviews=[{'decision': r.decision, 'note': r.note, 'created_at': r.created_at,
                                'reviewer': r.reviewer.get_full_name() or r.reviewer.username} for r in version.reviews.all()],
                      related_ids=version.related_ids)
    if internal:
        result.update(revision=version.revision, imported_metadata=version.imported_metadata, editor=version.editor_id)
    return result
