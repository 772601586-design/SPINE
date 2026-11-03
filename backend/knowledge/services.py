import hashlib
import json
import re
from datetime import timedelta
from urllib.parse import urlparse

from django.conf import settings
from django.db import IntegrityError, transaction
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import F, OuterRef, Q, Subquery
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from .models import Article, ArticleVersion, AuditLog, Category, Claim, ClaimSource, Question, Review, Source, Tag, Topic
from .permissions import ADMIN, EDITOR, REVIEWER, require_role

SECTIONS = ['核心回答', '详细医学解释', '相关概念', '需要区分的情况', '常见误区', '就医提示', '延伸阅读']
SOURCE_FIELDS = ['id', 'title', 'organization', 'authors', 'year', 'url', 'doi', 'pmid', 'evidence_type', 'population']


def source_identity(source):
    return {k: getattr(source, k) for k in SOURCE_FIELDS}


def audit(user, action, obj, changes=None):
    AuditLog.objects.create(actor=user, action=action, object_type=type(obj).__name__, object_id=str(obj.pk), changes=changes or {})


def preview_enabled():
    """预览模式：把"科普整理、未经医学审核"的草稿放进公开读取接口。

    产品决定（2026-11-03）：小程序需要在内测/演示环境展示未过审的科普稿，
    并在列表与详情显式标注"未经医学审核"。仅在 DEBUG 进程且显式设置
    KNOWLEDGE_PREVIEW_DRAFTS=true 时生效；验收与生产（DEBUG=false）永远关闭。
    """
    return bool(getattr(settings, 'KNOWLEDGE_PREVIEW_DRAFTS', False))


def public_articles():
    """对外可读的文章（收藏、反馈等需要 Article 的场景）。"""
    if preview_enabled():
        rows = Article.objects.filter(Q(publication_status='published') |
                                      Q(versions__imported_metadata__preview=True))
    else:
        rows = Article.objects.filter(publication_status='published',
                                      published_version__review_status='approved',
                                      published_version__reviews__decision='approved')
    return rows.exclude(
        published_version__sources__verification_status='invalid').exclude(
        published_version__claims__evidence__source__verification_status='invalid').distinct()


def visible_versions():
    """对外可读的文章版本（阅读、搜索、详情用）。

    默认只返回各文章已发布的版本；预览模式额外返回被显式标记为
    `imported_metadata.preview=true` 的草稿最新版本。
    """
    latest = ArticleVersion.objects.filter(article=OuterRef('article')).order_by('-number').values('pk')[:1]
    if not preview_enabled():
        return ArticleVersion.objects.filter(article__published_version_id=F('pk'))
    return ArticleVersion.objects.filter(pk=Subquery(latest)).filter(
        Q(article__publication_status='published') | Q(imported_metadata__preview=True))


def digest(version):
    fields = ['title', 'summary', 'body_markdown', 'audience', 'content_type', 'risk_level', 'keywords', 'related_ids', 'source_snapshot']
    data = {field: getattr(version, field) for field in fields}
    for field in ['categories', 'topics', 'questions', 'tags', 'sources']:
        data[field] = sorted(str(x) for x in getattr(version, field).values_list('pk', flat=True))
    data['claims'] = [{'text': c.text, 'location': c.article_location, 'important': c.important,
                       'evidence': list(c.evidence.order_by('id').values('source_id', 'locator', 'note', 'verification_status', 'source_snapshot'))}
                      for c in version.claims.order_by('id')]
    return hashlib.sha256(json.dumps(data, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


class EvidenceInput(serializers.Serializer):
    source = serializers.PrimaryKeyRelatedField(queryset=Source.objects.all())
    locator = serializers.CharField(max_length=1000)
    note = serializers.CharField(allow_blank=True, default='')


class ClaimInput(serializers.Serializer):
    text = serializers.CharField(max_length=6000)
    article_location = serializers.CharField(max_length=500)
    important = serializers.BooleanField(default=True)
    evidence = EvidenceInput(many=True)


class VersionInput(serializers.Serializer):
    title = serializers.CharField(max_length=300)
    summary = serializers.CharField(max_length=5000)
    body_markdown = serializers.CharField(max_length=200000)
    audience = serializers.CharField(max_length=500)
    content_type = serializers.ChoiceField(choices=['patient_education', 'professional_education'], default='patient_education')
    risk_level = serializers.ChoiceField(choices=['low', 'medium', 'high'], default='medium')
    keywords = serializers.ListField(child=serializers.CharField(max_length=100), max_length=50, default=list)
    categories = serializers.PrimaryKeyRelatedField(queryset=Category.objects.all(), many=True, allow_empty=False)
    topics = serializers.PrimaryKeyRelatedField(queryset=Topic.objects.all(), many=True, default=list)
    tags = serializers.PrimaryKeyRelatedField(queryset=Tag.objects.all(), many=True, default=list)
    sources = serializers.PrimaryKeyRelatedField(queryset=Source.objects.all(), many=True, default=list)
    questions = serializers.ListField(child=serializers.CharField(max_length=300), max_length=50, default=list)
    related_ids = serializers.ListField(child=serializers.SlugField(max_length=100), max_length=50, default=list)
    claims = ClaimInput(many=True, default=list)

    def validate_body_markdown(self, body):
        # Never use signed private attachment URLs or embedded local files as public media.
        if re.search(r'(?:/api/v1/attachments/|file:|data:|wxfile:|[?&](?:signature|token)=)', body, re.I):
            raise ValidationError('正文不能嵌入私人附件、登录凭证或本地文件。请使用已获授权的公开科普素材。')
        return body


def write_version(version, values):
    relations = {key: values.pop(key) for key in ['categories', 'topics', 'tags', 'sources', 'questions', 'claims']}
    for field, value in values.items():
        setattr(version, field, value)
    version.save()
    for key in ['categories', 'topics', 'tags', 'sources']:
        getattr(version, key).set(relations[key])
    category = relations['categories'][0]
    questions = relations['questions'] or [version.title]
    version.questions.set([Question.objects.get_or_create(text=q, defaults={'category': category})[0] for q in questions])
    version.claims.all().delete()
    for claim in relations['claims']:
        evidence = claim.pop('evidence')
        row = Claim.objects.create(version=version, **claim)
        for item in evidence:
            ClaimSource.objects.create(claim=row, verification_status='located', **item)
            version.sources.add(item['source'])


@transaction.atomic
def create_article(user, article_id, data):
    require_role(user, ADMIN, EDITOR)
    field = serializers.SlugField(max_length=100)
    article_id = field.run_validation(article_id)
    if Article.objects.filter(pk=article_id).exists():
        raise ValidationError('文章 ID 已存在，请创建新版本。')
    s = VersionInput(data=data)
    s.is_valid(raise_exception=True)
    try:
        with transaction.atomic():
            article = Article.objects.create(id=article_id)
    except IntegrityError as exc:
        raise ValidationError('文章 ID 已被另一请求创建，请刷新后编辑新版本。') from exc
    version = ArticleVersion(article=article, number=1, editor=user)
    write_version(version, s.validated_data)
    audit(user, 'create', version, {'digest': digest(version)})
    return version


@transaction.atomic
def edit_version(user, pk, data):
    require_role(user, ADMIN, EDITOR)
    version = ArticleVersion.objects.select_for_update().get(pk=pk)
    if version.review_status not in ['draft', 'changes']:
        raise ValidationError('已提交或已通过的版本不可编辑，请创建新版本。')
    if data.get('revision') != version.revision:
        raise ValidationError('内容已变化，请刷新后再保存。')
    s = VersionInput(data=data)
    s.is_valid(raise_exception=True)
    before = digest(version)
    from .serializers import version_data
    before_content = json.loads(json.dumps(version_data(version, detail=True), cls=DjangoJSONEncoder))
    version.revision += 1
    version.editor = user
    version.review_status = 'draft'
    write_version(version, s.validated_data)
    after_content = json.loads(json.dumps(version_data(version, detail=True), cls=DjangoJSONEncoder))
    audit(user, 'edit', version, {'before': before, 'after': digest(version), 'revision': version.revision,
                                'changed_fields': [k for k in after_content if before_content.get(k) != after_content[k]],
                                'before_content': before_content, 'after_content': after_content})
    return version


@transaction.atomic
def clone_version(user, article_id):
    require_role(user, ADMIN, EDITOR)
    article = Article.objects.select_for_update().get(pk=article_id)
    old = article.versions.order_by('-number').first()
    if article.versions.filter(review_status__in=['draft', 'changes', 'submitted']).exists():
        raise ValidationError('已有未完成版本，请先完成该版本。')
    values = {k: getattr(old, k) for k in ['title', 'summary', 'body_markdown', 'audience', 'content_type', 'risk_level', 'keywords', 'related_ids']}
    for key in ['categories', 'topics', 'tags', 'sources']:
        values[key] = list(getattr(old, key).all())
    values['questions'] = list(old.questions.values_list('text', flat=True))
    values['claims'] = [{'text': c.text, 'article_location': c.article_location, 'important': c.important,
                         'evidence': [{'source': e.source, 'locator': e.locator, 'note': e.note} for e in c.evidence.all()]}
                        for c in old.claims.all()]
    version = ArticleVersion(article=article, number=old.number + 1, editor=user, imported_metadata=old.imported_metadata)
    write_version(version, values)
    audit(user, 'new_version', version, {'previous_version': old.pk})
    return version


def completeness(version):
    if not version.keywords or any(not str(k).strip() for k in version.keywords):
        raise ValidationError('请补全文章关键词。')
    missing = [s for s in SECTIONS if not re.search(r'^#{1,6}\s+.*' + s, version.body_markdown, re.M)]
    if missing:
        raise ValidationError({'body_markdown': '请补全独立内容章节：' + '、'.join(missing)})
    if not version.categories.exists() or not version.claims.filter(important=True).exists():
        raise ValidationError('请设置分类并标注重要医学结论及对应证据。')
    for claim in version.claims.filter(important=True):
        if not claim.evidence.exists():
            raise ValidationError('每条重要医学结论必须关联文献和具体位置。')


@transaction.atomic
def transition(user, version_id, action, data):
    article_id = ArticleVersion.objects.values_list('article_id', flat=True).get(pk=version_id)
    article = Article.objects.select_for_update().get(pk=article_id)
    version = ArticleVersion.objects.select_for_update().get(pk=version_id)
    if action == 'submit':
        require_role(user, ADMIN, EDITOR)
        if version.review_status not in ['draft', 'changes']:
            raise ValidationError('只有草稿或要求修改的版本可提交。')
        completeness(version)
        version.review_status = 'submitted'
    elif action in ['approve', 'changes']:
        require_role(user, REVIEWER)
        if version.review_status != 'submitted' or user.pk == version.editor_id:
            raise ValidationError('仅可审核待审核版本，且不可审核自己的编辑稿。')
        note = str(data.get('note', '')).strip()
        if not note:
            raise ValidationError('必须填写具体医学审核意见。')
        if action == 'approve':
            completeness(version)
            locked_sources = list(Source.objects.select_for_update().filter(pk__in=version.sources.values('pk')).order_by('pk'))
            if data.get('all_claims_checked') is not True or data.get('rights_checked') is not True:
                raise ValidationError('须由医学审核人确认所有重要结论已核对且素材使用权已核查。')
            for claim in version.claims.filter(important=True):
                if not claim.evidence.filter(verification_status='verified', source__verification_status='verified').exists():
                    raise ValidationError('重要结论尚未完成逐条证据核验。')
                for evidence in claim.evidence.filter(verification_status='verified').select_related('source'):
                    if evidence.source_snapshot != source_identity(evidence.source):
                        raise ValidationError('证据核验后文献元数据已改变，请重新核验该条证据。')
            if version.sources.exclude(verification_status='verified').exists():
                raise ValidationError('关联文献仍有未核对或失效项目。')
            version.review_status = 'approved'
            version.review_due_date = timezone.localdate() + timedelta(days=180)
            from .serializers import source_data
            version.source_snapshot = json.loads(json.dumps([source_data(s) for s in locked_sources], cls=DjangoJSONEncoder))
        else:
            version.review_status = 'changes'
        Review.objects.create(version=version, reviewer=user, decision=version.review_status, note=note, content_digest=digest(version))
    elif action == 'publish':
        require_role(user, ADMIN)
        locked_sources = list(Source.objects.select_for_update().filter(pk__in=version.sources.values('pk')).order_by('pk'))
        review = version.reviews.filter(decision='approved').order_by('-id').first()
        if version.review_status != 'approved' or not review or review.content_digest != digest(version):
            raise ValidationError('仅可发布内容未改变且已有真实医学审核记录的版本。')
        if version.sources.exclude(verification_status='verified').exists():
            raise ValidationError('来源状态变化，请重新核对后发布。')
        snapshots = {s['id']: {k: s.get(k) for k in SOURCE_FIELDS} for s in version.source_snapshot}
        if any(snapshots.get(s.pk) != source_identity(s) for s in locked_sources):
            raise ValidationError('审核后来源元数据改变，请创建新版本重新审核。')
        if article.published_version_id and article.published_version.number >= version.number:
            raise ValidationError('此版本已发布，或已有更新的发布版本。')
        article.published_version = version
        article.publication_status = 'published'
        article.withdrawal_reason = ''
        article.save()
    elif action == 'withdraw':
        require_role(user, ADMIN)
        if article.publication_status != 'published' or not str(data.get('note', '')).strip():
            raise ValidationError('撤稿需要已发布文章和撤稿原因。')
        article.publication_status = 'withdrawn'
        article.withdrawal_reason = str(data['note'])[:2000]
        article.save()
    else:
        raise ValidationError('未知状态操作。')
    version.save()
    audit(user, action, version, {'note': str(data.get('note', ''))[:4000], 'digest': digest(version), 'state': version.review_status})
    return version


@transaction.atomic
def verify_evidence(user, pk, data):
    require_role(user, REVIEWER)
    evidence = ClaimSource.objects.select_related('claim').get(pk=pk)
    version = ArticleVersion.objects.select_for_update().get(pk=evidence.claim.version_id)
    evidence = ClaimSource.objects.select_for_update().get(pk=pk)
    if version.review_status != 'submitted' or version.editor_id == user.pk:
        raise ValidationError('仅独立医学审核人可核验待审核稿的证据。')
    source = Source.objects.select_for_update().get(pk=evidence.source_id)
    if source.verification_status != 'verified' or not str(data.get('note', '')).strip():
        raise ValidationError('先核对文献元数据，并填写支持程度、适用范围及具体原文位置核验意见。')
    evidence.verification_status = 'verified'
    evidence.note = str(data['note'])[:10000]
    evidence.verified_by = user
    evidence.verified_at = timezone.now()
    evidence.source_snapshot = source_identity(source)
    evidence.save()
    audit(user, 'verify_evidence', evidence, {'note': evidence.note, 'source': source.pk, 'locator': evidence.locator})
    return evidence
