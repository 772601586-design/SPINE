from django.db import transaction
from django.db.models import Case, IntegerField, Q, Value, When
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import MethodNotAllowed, ValidationError
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import importing
from .models import Article, ArticleVersion, AuditLog, Bookmark, Category, CommunityLink, Feedback, ImportJob, Question, Source, Tag, Topic
from .permissions import ADMIN, EDITOR, REVIEWER, EditorialPermission, require_role, roles
from .serializers import CategoryInput, SourceInput, TagInput, TopicInput, source_data, version_data
from .services import audit, clone_version, create_article, edit_version, public_articles, transition, verify_evidence, visible_versions
from .schema import KnowledgeSchema

DISCLAIMER = '仅供健康教育，不用于自动诊断、个体训练处方或治疗决策。请与治疗团队讨论个人情况。'
SYNONYMS = [('侧弯度数', 'Cobb角', 'Cobb 角', 'cobb'), ('施罗斯', 'Schroth'), ('矫形器', '支具'), ('侧弯特异性运动', 'PSSE')]


class KnowledgeView(APIView):
    schema = KnowledgeSchema()

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method in ['POST', 'PUT', 'PATCH'] and not isinstance(request.data, dict):
            raise ValidationError('请求体必须是对象。')

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        # Retractions and account-specific bookmarks must not be served from a stale shared cache.
        response['Cache-Control'] = 'no-store'
        return response


def paging(request, rows, serialize):
    try:
        page = min(1000000, max(1, int(request.query_params.get('page', 1))))
        size = min(30, max(1, int(request.query_params.get('page_size', 12))))
    except ValueError as exc:
        raise ValidationError('分页参数必须是整数。') from exc
    count = rows.count()
    return {'count': count, 'page': page, 'next': page + 1 if page * size < count else None,
            'results': [serialize(r) for r in rows[(page - 1) * size:page * size]]}


class CatalogView(KnowledgeView):
    permission_classes = [AllowAny]

    def get(self, request):
        versions = list(visible_versions().select_related('article').order_by('-updated_at', 'article_id')[:6])
        return Response({'categories': CategoryInput(Category.objects.all(), many=True).data,
                         'topics': TopicInput(Topic.objects.filter(active=True), many=True).data,
                         'recommended': [version_data(v) for v in versions],
                         'questions': list(Question.objects.filter(articleversion__in=visible_versions().values('pk')).distinct().order_by('-featured', 'id').values('id', 'text', 'category_id')[:8]),
                         'disclaimer': DISCLAIMER})


class ArticlesView(KnowledgeView):
    permission_classes = [AllowAny]

    def get(self, request):
        rows = visible_versions()
        for key, field in [('category', 'categories__pk'), ('topic', 'topics__pk'), ('question', 'questions__pk')]:
            if request.query_params.get(key):
                rows = rows.filter(**{field: request.query_params[key]})
        if request.query_params.get('bookmarked') == '1':
            if not request.user:
                return Response({'detail': '请先登录。'}, status=401)
            rows = rows.filter(article__bookmark__user=request.user)
        query = request.query_params.get('q', '').strip()[:100]
        if query:
            terms = {query}
            for group in SYNONYMS:
                if any(t.casefold() in query.casefold() for t in group):
                    terms.update(group)
            for tag in Tag.objects.all()[:500]:
                if any(t.casefold() in query.casefold() for t in [tag.name] + tag.synonyms):
                    terms.update([tag.name] + tag.synonyms)
            score = Value(0, output_field=IntegerField())
            for term in sorted(terms)[:30]:
                questions = Question.objects.filter(text__icontains=term).values('articleversion__id')
                tag_versions = Tag.objects.filter(name__icontains=term).values('articleversion__id')
                for condition, weight in [
                    (Q(title__icontains=term), 100),
                    (Q(pk__in=questions), 80),
                    (Q(keywords__icontains=term) | Q(pk__in=tag_versions), 45),
                    (Q(summary__icontains=term), 25),
                    (Q(body_markdown__icontains=term), 5),
                ]:
                    score += Case(When(condition, then=Value(weight)), default=Value(0), output_field=IntegerField())
            rows = rows.annotate(relevance=score).filter(relevance__gt=0).order_by('-relevance', 'article_id')
        else:
            rows = rows.order_by('-updated_at', 'article_id')
        result = paging(request, rows.select_related('article').distinct(), version_data)
        result['suggestions'] = list(Question.objects.filter(articleversion__in=visible_versions().values('pk')).distinct().order_by('-featured', 'id').values_list('text', flat=True)[:5])
        result['questions'] = list(Question.objects.filter(articleversion__in=rows.values('pk')).distinct().order_by('-featured', 'id').values('id', 'text')[:30]) if request.query_params.get('category') else []
        return Response(result)


class ArticleDetailView(KnowledgeView):
    permission_classes = [AllowAny]

    def get(self, request, pk):
        version = visible_versions().select_related('article').filter(article_id=pk).order_by('-number').first()
        if not version:
            if Article.objects.filter(pk=pk, publication_status='withdrawn').exists():
                return Response({'detail': '文章已撤稿，暂不可阅读。'}, status=410)
            return Response({'detail': '文章暂未公开或正在复核。'}, status=404)
        article = version.article
        data = version_data(version, detail=True)
        data['bookmarked'] = bool(request.user and Bookmark.objects.filter(user=request.user, article=article).exists())
        related = visible_versions().exclude(article_id=pk).filter(
            Q(article_id__in=version.related_ids) | Q(categories__in=version.categories.all())
        ).distinct().order_by('article_id')[:6]
        data['related'] = [version_data(v) for v in related]
        # Only explicitly linked, moderated public posts. Never serialize owner identity or private records.
        data['discussions'] = [{'id': l.post_id, 'label': '个人经验', 'body': l.post.body, 'group': l.post.group}
                               for l in CommunityLink.objects.filter(article=article, approved=True, post__status='published').select_related('post')[:20]]
        data['disclaimer'] = DISCLAIMER
        return Response(data)


class SourceDetailView(KnowledgeView):
    permission_classes = [AllowAny]

    def get(self, request, pk):
        source = get_object_or_404(Source.objects.filter(articleversion__in=visible_versions().values('pk')).distinct(), pk=pk)
        return Response(source_data(source))


class BookmarkView(KnowledgeView):
    permission_classes = [IsAuthenticated]

    def put(self, request, pk):
        article = get_object_or_404(public_articles(), pk=pk)
        Bookmark.objects.get_or_create(user=request.user, article=article)
        return Response({'bookmarked': True})

    def delete(self, request, pk):
        Bookmark.objects.filter(user=request.user, article_id=pk).delete()
        return Response({'bookmarked': False})


class FeedbackView(KnowledgeView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        article = get_object_or_404(public_articles(), pk=pk)
        text = request.data.get('text')
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 2000:
            raise ValidationError('请填写 1—2000 字的错误描述，不要填写个人病历。')
        row = Feedback.objects.create(user=request.user, version=article.published_version, text=text.strip())
        return Response({'id': row.pk, 'status': row.status}, status=201)


class ManageView(KnowledgeView):
    permission_classes = [EditorialPermission]


class DashboardView(ManageView):
    def get(self, request):
        return Response({'roles': sorted(roles(request.user)), 'categories': CategoryInput(Category.objects.all(), many=True).data,
                         'topics': TopicInput(Topic.objects.all(), many=True).data, 'tags': TagInput(Tag.objects.all(), many=True).data,
                         'counts': {'draft': ArticleVersion.objects.filter(review_status='draft').count(),
                                    'submitted': ArticleVersion.objects.filter(review_status='submitted').count(), 'published': public_articles().count()}})


class ManageArticlesView(ManageView):
    def get(self, request):
        rows = ArticleVersion.objects.select_related('article').order_by('-updated_at', '-id')
        if request.query_params.get('status'):
            rows = rows.filter(review_status=request.query_params['status'])
        if request.query_params.get('article'):
            rows = rows.filter(article_id=request.query_params['article'])
        if request.query_params.get('q'):
            rows = rows.filter(title__icontains=request.query_params['q'][:100])
        return Response(paging(request, rows, lambda v: version_data(v, internal=True)))

    def post(self, request):
        return Response(version_data(create_article(request.user, request.data.get('id'), request.data), detail=True, internal=True), status=201)


class ManageVersionView(ManageView):
    def get(self, request, pk):
        return Response(version_data(get_object_or_404(ArticleVersion, pk=pk), detail=True, internal=True))

    def put(self, request, pk):
        get_object_or_404(ArticleVersion, pk=pk)
        return Response(version_data(edit_version(request.user, pk, request.data), detail=True, internal=True))


class TransitionView(ManageView):
    def post(self, request, pk, action):
        get_object_or_404(ArticleVersion, pk=pk)
        return Response(version_data(transition(request.user, pk, action, request.data), detail=True, internal=True))


class CloneView(ManageView):
    def post(self, request, pk):
        get_object_or_404(Article, pk=pk)
        return Response(version_data(clone_version(request.user, pk), detail=True, internal=True), status=201)


class PreviewView(ManageView):
    def post(self, request):
        from .rendering import render_markdown
        body = request.data.get('body_markdown', '')
        if not isinstance(body, str) or len(body) > 200000:
            raise ValidationError('正文格式或长度无效。')
        return Response({'html': render_markdown(body)})


class MetadataView(ManageView):
    resources = {'categories': (Category, CategoryInput), 'topics': (Topic, TopicInput), 'tags': (Tag, TagInput), 'sources': (Source, SourceInput)}

    def get(self, request, resource, pk=None):
        model, cls = self.resources[resource]
        rows = model.objects.order_by('pk')
        if pk is not None:
            obj = get_object_or_404(rows, pk=pk)
            return Response(source_data(obj) if resource == 'sources' else cls(obj).data)
        if resource == 'sources':
            return Response(paging(request, rows, source_data))
        return Response(cls(rows, many=True).data)

    @transaction.atomic
    def post(self, request, resource, pk=None):
        if pk is not None:
            raise MethodNotAllowed('POST')
        require_role(request.user, ADMIN, EDITOR)
        model, cls = self.resources[resource]
        s = cls(data=request.data)
        s.is_valid(raise_exception=True)
        if model is Source and Source.objects.filter(pk=s.validated_data['id']).exists():
            raise ValidationError('来源 ID 已存在。')
        obj = s.save()
        audit(request.user, 'metadata_create', obj, {'data': cls(obj).data})
        return Response(cls(obj).data, status=201)

    @transaction.atomic
    def patch(self, request, resource, pk=None):
        if pk is None:
            raise MethodNotAllowed('PATCH')
        require_role(request.user, ADMIN, EDITOR)
        model, cls = self.resources[resource]
        obj = get_object_or_404(model.objects.select_for_update(), pk=pk)
        if 'id' in request.data and str(request.data['id']) != str(pk):
            raise ValidationError('稳定 ID 不可修改。')
        before = cls(obj).data
        s = cls(obj, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        obj = s.save()
        if isinstance(obj, Source):
            obj.verification_status = 'unchecked'
            obj.verified_at = None
            obj.verified_by = None
            obj.save()
        audit(request.user, 'metadata_edit', obj, {'before': before, 'after': cls(obj).data})
        return Response(cls(obj).data)


class SourceVerificationView(ManageView):
    @transaction.atomic
    def post(self, request, pk):
        require_role(request.user, REVIEWER)
        source = get_object_or_404(Source.objects.select_for_update(), pk=pk)
        state, note = request.data.get('status'), request.data.get('note')
        if state not in ['unchecked', 'located', 'verified', 'invalid'] or not isinstance(note, str) or not note.strip():
            raise ValidationError('请提供核验状态和具体核验意见。')
        source.verification_status = state
        source.verification_note = note[:10000]
        source.verified_by = request.user
        source.verified_at = timezone.now()
        source.save()
        audit(request.user, 'source_verify', source, {'status': state, 'note': note[:10000]})
        return Response(source_data(source))


class EvidenceVerificationView(ManageView):
    def post(self, request, pk):
        from .models import ClaimSource
        get_object_or_404(ClaimSource, pk=pk)
        row = verify_evidence(request.user, pk, request.data)
        return Response({'id': row.pk, 'status': row.verification_status})


class ImportView(ManageView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request, pk=None, action=None):
        if action is not None:
            raise MethodNotAllowed('GET')
        if pk:
            job = get_object_or_404(ImportJob, pk=pk)
            return Response({'id': job.pk, 'status': job.status, 'report': job.report})
        return Response(paging(request, ImportJob.objects.order_by('-created_at'), lambda j: {'id': j.pk, 'filename': j.filename, 'status': j.status, 'report': j.report}))

    def post(self, request, pk=None, action=None):
        if pk:
            get_object_or_404(ImportJob, pk=pk)
            if action not in ['commit', 'rollback']:
                raise ValidationError('未知导入操作。')
            job = {'commit': importing.commit, 'rollback': importing.rollback}[action](request.user, pk)
        else:
            file = request.FILES.get('file')
            if not file:
                raise ValidationError('请选择导入文件。')
            job = importing.preview(request.user, file.name, file.read(importing.LIMIT + 1))
        return Response({'id': job.pk, 'status': job.status, 'report': job.report})


class ManageFeedbackView(ManageView):
    def get(self, request, pk=None):
        return Response(paging(request, Feedback.objects.order_by('-id'), lambda f: {'id': f.pk, 'article_id': f.version.article_id, 'version': f.version.number, 'text': f.text, 'status': f.status, 'response': f.response}))

    @transaction.atomic
    def post(self, request, pk=None):
        if pk is None:
            raise MethodNotAllowed('POST')
        require_role(request.user, ADMIN, EDITOR, REVIEWER)
        row = get_object_or_404(Feedback.objects.select_for_update(), pk=pk)
        response = request.data.get('response')
        if not isinstance(response, str) or not response.strip() or len(response) > 4000:
            raise ValidationError('请填写处理说明（不超过 4000 字）。')
        row.status, row.response, row.handled_by = 'resolved', response, request.user
        row.save()
        audit(request.user, 'resolve_feedback', row, {'response': response})
        return Response({'status': row.status})


class CommunityLinksView(ManageView):
    def get(self, request):
        return Response(list(CommunityLink.objects.order_by('-id').values('id', 'article_id', 'post_id', 'approved')[:200]))

    @transaction.atomic
    def post(self, request):
        require_role(request.user, ADMIN)
        from life.models import Post
        article = get_object_or_404(Article, pk=request.data.get('article_id'))
        post = get_object_or_404(Post, pk=request.data.get('post_id'), status='published')
        approved = request.data.get('approved')
        if type(approved) is not bool:
            raise ValidationError('关联必须明确批准或取消。')
        row, _ = CommunityLink.objects.update_or_create(article=article, post=post, defaults={'approved': approved, 'created_by': request.user})
        audit(request.user, 'community_link', row, {'article': article.pk, 'post': post.pk, 'approved': approved})
        return Response({'id': row.pk, 'approved': row.approved})


class AuditView(ManageView):
    def get(self, request):
        require_role(request.user, ADMIN)
        return Response(paging(request, AuditLog.objects.all(), lambda r: {'id': r.pk, 'actor': r.actor_id, 'action': r.action,
            'object_type': r.object_type, 'object_id': r.object_id, 'changes': r.changes, 'created_at': r.created_at}))
