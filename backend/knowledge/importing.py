"""Bounded, non-extracting import with persistent preview and atomic commit/rollback."""
import csv
import hashlib
import io
import json
import re
import zipfile
from pathlib import PurePosixPath

import yaml
from django.db import transaction
from rest_framework.exceptions import ValidationError

from .models import Article, ArticleVersion, Category, ImportJob, Question, Source, Topic
from .permissions import ADMIN, EDITOR, require_role
from .services import audit, create_article

LIMIT = 12 * 1024 * 1024
LIST_FIELDS = ['source_ids', 'source_urls', 'keywords', 'related_article_ids', 'evidence_locations']


def source_values(sid, item):
    return {'id': sid, 'title': item.get('name', item.get('title', sid)), 'url': item.get('url', ''),
            'organization': item.get('organization', ''), 'authors': item.get('authors', ''), 'year': item.get('year'),
            'doi': item.get('doi', ''), 'pmid': item.get('pmid', ''), 'evidence_type': item.get('evidence_type', item.get('type', '')),
            'population': item.get('population', item.get('scope', '')), 'metadata': item}


def parse_document(name, raw):
    try:
        text = raw.decode('utf-8-sig')
        if name.lower().endswith('.json'):
            value = json.loads(text)
            return value.get('articles', []) if isinstance(value, dict) else value
        if name.lower().endswith('.csv'):
            rows = list(csv.DictReader(io.StringIO(text)))
            for row in rows:
                for key in LIST_FIELDS:
                    if row.get(key):
                        try:
                            row[key] = json.loads(row[key])
                        except ValueError:
                            row[key] = [x.strip() for x in re.split(r'[;；|]', row[key]) if x.strip()]
            return rows
        if name.lower().endswith('.md'):
            parts = re.split(r'^---\s*$', text, maxsplit=2, flags=re.M)
            if len(parts) != 3 or parts[0].strip():
                raise ValueError('Markdown 需要 YAML front matter（id/title/category/summary），后接正文。')
            row = yaml.safe_load(parts[1])
            if not isinstance(row, dict):
                raise ValueError('Markdown 元数据必须是对象。')
            row['body_markdown'] = parts[2].strip()
            return [row]
    except (ValueError, UnicodeError, yaml.YAMLError) as exc:
        raise ValidationError(str(exc)) from exc
    raise ValidationError('支持 JSON、CSV、Markdown 或包含 articles.json 的 ZIP。')


def read_package(filename, raw):
    if len(raw) > LIMIT:
        raise ValidationError('导入文件不得超过 12 MB。')
    sources, manifest = {}, []
    if filename.lower().endswith('.zip'):
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                if len(z.infolist()) > 500 or sum(i.file_size for i in z.infolist()) > 40 * 1024 * 1024:
                    raise ValidationError('压缩包文件数量或解压体积超限。')
                files = [i for i in z.infolist() if not i.is_dir()]
                if any('..' in PurePosixPath(i.filename).parts or i.filename.startswith('/') or '\\' in i.filename for i in files):
                    raise ValidationError('压缩包含不安全路径。')
                candidates = [i for i in files if PurePosixPath(i.filename).name == 'articles.json']
                if len(candidates) != 1:
                    raise ValidationError('ZIP 必须包含且仅包含一个 articles.json，避免重复导入 Markdown/CSV 副本。')
                rows = parse_document('articles.json', z.read(candidates[0]))
                source_files = [i for i in files if PurePosixPath(i.filename).name == 'sources.json']
                if len(source_files) > 1:
                    raise ValidationError('sources.json 重复。')
                if source_files:
                    sources = json.loads(z.read(source_files[0]).decode('utf-8-sig'))
                manifest = [{'path': i.filename, 'bytes': i.file_size, 'sha256': hashlib.sha256(z.read(i)).hexdigest()} for i in files]
        except (zipfile.BadZipFile, ValueError, UnicodeError, RuntimeError) as exc:
            raise ValidationError('压缩包无法读取：' + str(exc)) from exc
    else:
        rows = parse_document(filename, raw)
    if not isinstance(rows, list) or not 1 <= len(rows) <= 500:
        raise ValidationError('文章数组必须包含 1—500 条记录。')
    if not isinstance(sources, dict) or any(not isinstance(s, dict) for s in sources.values()):
        raise ValidationError('sources.json 必须是以来源 ID 为键的对象。')
    # Ensure YAML dates and other non-JSON types cannot escape into JSONField.
    try:
        json.dumps({'rows': rows, 'sources': sources})
    except (TypeError, ValueError) as exc:
        raise ValidationError('元数据必须可转为 JSON；日期请加引号。') from exc
    return rows, sources, manifest


def validate_rows(rows, sources):
    from .serializers import SourceInput
    from .services import VersionInput
    errors, warnings, seen, titles = [], [], set(), set()
    categories = set(Category.objects.values_list('name', flat=True))
    for sid, item in sources.items():
        values = source_values(sid, item)
        validator = SourceInput(data=values)
        if not validator.is_valid():
            errors.append({'source': sid, 'error': str(validator.errors)})
        existing = Source.objects.filter(pk=sid).first()
        if existing and any(getattr(existing, key) != value for key, value in values.items() if key != 'id'):
            errors.append({'source': sid, 'error': '来源 ID 已存在且元数据不同；请先核对文献，不可静默覆盖。'})
    for i, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            errors.append({'row': i, 'error': '记录必须是对象。'})
            continue
        aid = row.get('id')
        issues = []
        if not isinstance(aid, str) or not re.fullmatch(r'[-a-zA-Z0-9_]{1,100}', aid):
            issues.append('缺少有效稳定 ID')
            aid = str(aid)
        if aid in seen:
            issues.append('文件内 ID 重复')
        seen.add(aid)
        for field in ['title', 'summary', 'body_markdown', 'category']:
            if not isinstance(row.get(field), str) or not row[field].strip():
                issues.append(field + ' 必须为非空文本')
        if row.get('category') not in categories:
            issues.append('未知分类')
        if len(str(row.get('title', ''))) > 300 or len(str(row.get('body_markdown', ''))) > 200000:
            issues.append('标题或正文过长')
        for field in LIST_FIELDS:
            if field in row and not isinstance(row[field], list):
                issues.append(field + ' 必须为数组')
        if isinstance(row.get('body_markdown'), str):
            try:
                VersionInput().validate_body_markdown(row['body_markdown'])
            except ValidationError as exc:
                issues.append(str(exc.detail))
        if (row.get('risk_level') or row.get('medical_risk_level') or 'medium') not in ['low', 'medium', 'high']:
            issues.append('未知风险分级')
        for field, value in {'title': row.get('title'), 'summary': row.get('summary'), 'keywords': row.get('keywords', []),
                             'audience': row.get('target_population') or '待审核适用范围', 'content_type': row.get('content_type') or 'patient_education',
                             'related_ids': row.get('related_article_ids', [])}.items():
            try:
                VersionInput().fields[field].run_validation(value)
            except ValidationError as exc:
                issues.append(field + ': ' + str(exc.detail))
        for field in ['source_ids', 'source_urls', 'keywords', 'related_article_ids']:
            values = row.get(field, [])
            if isinstance(values, list) and any(not isinstance(v, str) for v in values):
                issues.append(field + ' 的元素必须是文本')
        urls = row.get('source_urls', [])
        if isinstance(urls, list):
            for url in urls:
                validator = SourceInput(data={'id': 'preview', 'title': 'preview', 'url': url})
                if not validator.is_valid():
                    issues.append('无效原文链接：' + str(url)[:100])
        locations = row.get('evidence_locations', [])
        if isinstance(locations, list):
            for location in locations:
                if not isinstance(location, dict) or not isinstance(location.get('url'), str):
                    issues.append('证据定位必须包含 URL')
                elif not SourceInput(data={'id': 'preview', 'title': 'preview', 'url': location['url']}).is_valid():
                    issues.append('证据定位 URL 无效')
        if str(row.get('title')) in titles:
            warnings.append({'row': i, 'id': aid, 'warning': '标题重复，请检查是否应合并。'})
        titles.add(str(row.get('title')))
        if Article.objects.filter(pk=aid).exists():
            issues.append('ID 已存在；导入不覆盖文章，请用新版本编辑')
        if row.get('clinical_review_status') not in [None, '', 'pending']:
            warnings.append({'row': i, 'id': aid, 'warning': '外部审核声明仅保留在原始元数据，不赋予平台审核通过状态。'})
        ids, urls = row.get('source_ids', []), row.get('source_urls', [])
        if isinstance(ids, list) and isinstance(urls, list):
            for sid, url in zip(ids, urls):
                if str(sid) in sources and sources[str(sid)].get('url') != url:
                    warnings.append({'row': i, 'id': aid, 'warning': f'来源 ID {sid} 与并列 URL 不一致；两者均保留，待人工核对。'})
            for sid in ids:
                if isinstance(sid, str) and sid not in sources and not Source.objects.filter(pk=sid).exists():
                    warnings.append({'row': i, 'id': aid, 'warning': f'缺少来源 {sid} 的元数据，原始引用保留待补全。'})
        if issues:
            errors.append({'row': i, 'id': aid, 'error': '；'.join(issues)})
    return errors, warnings


def preview(user, filename, raw):
    require_role(user, ADMIN, EDITOR)
    rows, sources, manifest = read_package(filename, raw)
    errors, warnings = validate_rows(rows, sources)
    report = {'count': len(rows), 'source_count': len(sources), 'errors': errors, 'warnings': warnings,
              'manifest': manifest, 'preview': [{'id': r.get('id'), 'title': r.get('title'), 'category': r.get('category'),
                                               'original_review_status': r.get('clinical_review_status'), 'import_status': 'draft'} for r in rows if isinstance(r, dict)]}
    job = ImportJob.objects.create(actor=user, filename=filename[:300], checksum=hashlib.sha256(raw).hexdigest(),
                                   payload={'rows': rows, 'sources': sources}, report=report)
    audit(user, 'import_preview', job, {'checksum': job.checksum, 'count': len(rows), 'errors': errors})
    return job


@transaction.atomic
def commit(user, job_id):
    require_role(user, ADMIN, EDITOR)
    job = ImportJob.objects.select_for_update().get(pk=job_id)
    if job.status == 'committed':
        return job
    if job.status != 'preview':
        raise ValidationError('仅可提交预览中的任务。')
    # Serialize concurrent import batches and repeat duplicate checks at commit time.
    list(Category.objects.select_for_update().order_by('pk'))
    rows, sources = job.payload['rows'], job.payload['sources']
    errors, _ = validate_rows(rows, sources)
    if errors:
        raise ValidationError({'rows': errors})
    source_ids, question_ids = [], []
    previous_questions = set(Question.objects.values_list('id', flat=True))
    for sid, item in sources.items():
        from .serializers import SourceInput
        data = source_values(sid, item)
        serializer = SourceInput(data=data)
        serializer.is_valid(raise_exception=True)
        source, created = Source.objects.get_or_create(id=sid, defaults={k: v for k, v in serializer.validated_data.items() if k != 'id'})
        if created:
            source_ids.append(source.id)
    created_ids = []
    for row in rows:
        refs = list(Source.objects.filter(pk__in=row.get('source_ids', [])))
        urls = list(row.get('source_urls', [])) + [e.get('url') for e in row.get('evidence_locations', []) if isinstance(e, dict) and e.get('url')]
        for url in urls:
            from .serializers import SourceInput
            source = Source.objects.filter(url=url).first()
            if not source:
                sid = 'url-' + hashlib.sha256(str(url).encode()).hexdigest()[:24]
                serializer = SourceInput(data={'id': sid, 'title': '待补全文献名称', 'url': url})
                serializer.is_valid(raise_exception=True)
                source, created = Source.objects.get_or_create(pk=sid, defaults={k: v for k, v in serializer.validated_data.items() if k != 'id'})
                if created:
                    source_ids.append(source.id)
            refs.append(source)
        text = row['title'] + row['summary']
        topic_ids = []
        rules = [('new-diagnosis', row['category'] == '刚发现侧弯'), ('imaging', row['category'] == '看懂检查结果'),
                 ('brace', '支具' in text), ('schroth', any(t in text.lower() for t in ['schroth', 'psse', '施罗斯'])),
                 ('daily-life', row['category'] == '每天怎么生活'), ('mental-growth', row['category'] == '情绪与成长')]
        topic_ids = [k for k, yes in rules if yes and Topic.objects.filter(pk=k).exists()]
        version = create_article(user, row['id'], {'title': row['title'], 'summary': row['summary'], 'body_markdown': row['body_markdown'],
            'categories': [Category.objects.get(name=row['category']).pk], 'audience': row.get('target_population') or '青少年侧弯患者、家长（待审核适用范围）',
            'risk_level': row.get('risk_level') or row.get('medical_risk_level') or 'medium',
            'content_type': row.get('content_type') or 'patient_education',
            'keywords': row.get('keywords', []), 'sources': list({s.id for s in refs}), 'topics': topic_ids,
            'related_ids': row.get('related_article_ids', [])})
        version.imported_metadata = row  # Verbatim body/IDs/status/evidence locations preserved here.
        version.save(update_fields=['imported_metadata'])
        created_ids.append(row['id'])
    question_ids = list(set(Question.objects.values_list('id', flat=True)) - previous_questions)
    job.created_ids = created_ids
    job.status = 'committed'
    job.report = {**job.report, 'created_sources': source_ids, 'created_questions': question_ids, 'imported': len(created_ids), 'publicly_published': 0}
    job.save()
    audit(user, 'import_commit', job, {'article_ids': created_ids, 'published': 0})
    return job


@transaction.atomic
def rollback(user, job_id):
    require_role(user, ADMIN)
    job = ImportJob.objects.select_for_update().get(pk=job_id)
    if job.status != 'committed':
        raise ValidationError('仅可回滚已导入任务。')
    articles = list(Article.objects.select_for_update().filter(pk__in=job.created_ids))
    for article in articles:
        versions = list(article.versions.select_for_update())
        if (article.publication_status != 'draft' or len(versions) != 1 or versions[0].revision != 1
                or versions[0].review_status != 'draft' or versions[0].reviews.exists() or article.communitylink_set.exists()):
            raise ValidationError('文章已编辑、审核、关联或发布，回滚已取消以保护后续工作。')
    for article in articles:
        for version in article.versions.all():
            version.claims.all().delete()
            version.delete()
        article.delete()
    # Remove only unreferenced, unchanged metadata created by this batch.
    Source.objects.filter(pk__in=job.report.get('created_sources', []), articleversion__isnull=True,
                          claimsource__isnull=True, verification_status='unchecked').delete()
    Question.objects.filter(pk__in=job.report.get('created_questions', []), articleversion__isnull=True).delete()
    job.status = 'rolled_back'
    job.save()
    audit(user, 'import_rollback', job, {'article_ids': job.created_ids})
    return job
