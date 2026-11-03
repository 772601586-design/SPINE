"""All 'approved' content in this file is synthetic and exists only in the test DB."""
import io
import json
import zipfile
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .importing import commit, preview, rollback
from .models import Article, ArticleVersion, AuditLog, Bookmark, Category, Claim, CommunityLink, Feedback, Source, Topic
from .permissions import ADMIN, EDITOR, REVIEWER
from .services import SECTIONS, public_articles

BASE = '/api/v1/knowledge/'


@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class KnowledgeTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user('kb-admin', password='test')
        self.editor = User.objects.create_user('kb-editor', password='test')
        self.reviewer = User.objects.create_user('kb-reviewer', password='test')
        self.patient = User.objects.create_user('kb-patient', password='test')
        self.other = User.objects.create_user('kb-other', password='test')
        for user, role in [(self.admin, ADMIN), (self.editor, EDITOR), (self.reviewer, REVIEWER)]:
            user.groups.add(Group.objects.get_or_create(name=role)[0])
        self.client = APIClient()
        Category.objects.get_or_create(id='results', defaults={'name': '看懂检查结果'})
        self.source = Source.objects.create(id='TEST-ONLY', title='Synthetic test source, not medical evidence', url='https://www.niams.nih.gov/health-topics/scoliosis')
        self.client.force_authenticate(self.reviewer)
        self.assertEqual(self.client.post(BASE + 'manage/sources/TEST-ONLY/verify/', {'status': 'verified', 'note': 'Synthetic test verification only'}, format='json').status_code, 200)
        Topic.objects.get_or_create(id='imaging', defaults={'name': '影像检查'})

    def payload(self, title='测试：Cobb角是什么？'):
        return {'id': 'TEST-01', 'title': title, 'summary': '仅用于自动测试，不是健康建议。',
                'body_markdown': '\n\n'.join('## ' + section + '\n\n测试专用内容。' for section in SECTIONS),
                'audience': '自动化测试', 'categories': ['results'], 'topics': ['imaging'], 'keywords': ['Cobb角'],
                'questions': [title], 'sources': ['TEST-ONLY'],
                'claims': [{'text': 'Synthetic claim only.', 'article_location': '核心回答',
                            'evidence': [{'source': 'TEST-ONLY', 'locator': 'Test section 1', 'note': 'Not a real citation'}]}]}

    def create(self, aid='TEST-01', title=None):
        self.client.force_authenticate(self.editor)
        payload = self.payload(title or '测试：Cobb角是什么？'); payload['id'] = aid
        r = self.client.post(BASE + 'manage/articles/', payload, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        return r.data

    def publish(self, aid='TEST-01', title=None):
        v = self.create(aid, title)
        vid = v['version_id']
        r = self.client.post(BASE + f'manage/versions/{vid}/submit/', {}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.client.force_authenticate(self.reviewer)
        eid = v['claims'][0]['evidence'][0]['id']
        self.assertEqual(self.client.post(BASE + f'manage/evidence/{eid}/verify/', {'note': 'Test only: source and locator checked'}, format='json').status_code, 200)
        r = self.client.post(BASE + f'manage/versions/{vid}/approve/', {'note': 'Synthetic approval in test database', 'all_claims_checked': True, 'rights_checked': True}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.client.force_authenticate(self.admin)
        r = self.client.post(BASE + f'manage/versions/{vid}/publish/', {}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        return r.data

    def test_six_categories_and_six_topics_public(self):
        self.client.force_authenticate(None)
        data = self.client.get(BASE + 'catalog/').data
        self.assertEqual(len(data['categories']), 6)
        self.assertEqual(len(data['topics']), 6)
        self.assertEqual(data['recommended'], [])

    def test_unreviewed_hidden_on_all_public_surfaces(self):
        self.create()
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(BASE + 'articles/TEST-01/').status_code, 404)
        for query in ['', '?q=Cobb', '?category=results', '?topic=imaging']:
            self.assertEqual(self.client.get(BASE + 'articles/' + query).data['count'], 0)
        data = self.client.get(BASE + 'catalog/').data
        self.assertEqual(data['questions'], [])
        self.assertEqual(self.client.get(BASE + 'sources/TEST-ONLY/').status_code, 404)

    def test_complete_publish_read_evidence_and_audit_flow(self):
        self.publish()
        self.client.force_authenticate(None)
        r = self.client.get(BASE + 'articles/TEST-01/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['claims'][0]['evidence'][0]['source_snapshot']['id'], 'TEST-ONLY')
        self.assertEqual(r.data['reviews'][0]['reviewer'], 'kb-reviewer')
        self.assertIn('<h2>', r.data['body_html'])
        self.assertFalse('imported_metadata' in r.data)
        self.assertEqual(self.client.get(BASE + 'sources/TEST-ONLY/').status_code, 200)
        self.assertTrue({'create', 'submit', 'verify_evidence', 'approve', 'publish'}.issubset(set(AuditLog.objects.values_list('action', flat=True))))

    def test_role_permissions_server_side(self):
        self.client.force_authenticate(self.patient)
        for path in ['manage/dashboard/', 'manage/articles/', 'manage/imports/', 'manage/sources/', 'manage/feedback/', 'manage/audit/']:
            self.assertEqual(self.client.get(BASE + path).status_code, 403, path)
        self.assertEqual(self.client.post(BASE + 'manage/articles/', self.payload(), format='json').status_code, 403)
        self.client.force_authenticate(self.reviewer)
        self.assertEqual(self.client.post(BASE + 'manage/articles/', self.payload(), format='json').status_code, 403)

    def test_admin_not_implicitly_clinician_and_cannot_bypass(self):
        v = self.create(); vid = v['version_id']
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(BASE + f'manage/versions/{vid}/publish/', {}, format='json').status_code, 400)
        self.assertEqual(self.client.post(BASE + f'manage/versions/{vid}/approve/', {'note': 'x'}, format='json').status_code, 403)

    def test_cannot_review_own_article_even_with_both_roles(self):
        self.editor.groups.add(Group.objects.get(name=REVIEWER))
        v = self.create(); vid = v['version_id']
        self.client.post(BASE + f'manage/versions/{vid}/submit/', {}, format='json')
        self.assertEqual(self.client.post(BASE + f'manage/versions/{vid}/approve/', {'note': 'x', 'all_claims_checked': True, 'rights_checked': True}, format='json').status_code, 400)

    def test_evidence_link_alone_does_not_allow_approval(self):
        v = self.create(); vid = v['version_id']
        self.client.post(BASE + f'manage/versions/{vid}/submit/', {}, format='json')
        self.client.force_authenticate(self.reviewer)
        r = self.client.post(BASE + f'manage/versions/{vid}/approve/', {'note': 'links exist', 'all_claims_checked': True, 'rights_checked': True}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_forged_review_fields_ignored(self):
        p = self.payload(); p['review_status'] = 'approved'; p['publication_status'] = 'published'
        self.client.force_authenticate(self.editor)
        r = self.client.post(BASE + 'manage/articles/', p, format='json')
        self.assertEqual(r.data['review_status'], 'draft')
        self.assertEqual(public_articles().count(), 0)

    def test_new_version_does_not_change_published_content(self):
        first = self.publish()
        self.client.force_authenticate(self.editor)
        r = self.client.post(BASE + 'manage/articles/TEST-01/versions/', {}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        second = r.data
        body = self.payload('NEW DRAFT TITLE'); body['revision'] = second['revision']
        self.assertEqual(self.client.put(BASE + f"manage/versions/{second['version_id']}/", body, format='json').status_code, 200)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(BASE + 'articles/TEST-01/').data['title'], first['title'])
        self.assertEqual(self.client.get(BASE + 'articles/?q=NEW DRAFT TITLE').data['count'], 0)

    def test_approved_version_is_immutable_and_old_publish_rejected(self):
        first = self.publish(); vid = first['version_id']
        self.client.force_authenticate(self.editor)
        p = self.payload(); p['revision'] = 1
        self.assertEqual(self.client.put(BASE + f'manage/versions/{vid}/', p, format='json').status_code, 400)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(BASE + f'manage/versions/{vid}/publish/', {}, format='json').status_code, 400)

    def test_edit_conflict_detected(self):
        v = self.create(); p = self.payload(); p['revision'] = 1
        url = BASE + f"manage/versions/{v['version_id']}/"
        self.assertEqual(self.client.put(url, p, format='json').status_code, 200)
        self.assertEqual(self.client.put(url, p, format='json').status_code, 400)

    def test_required_article_sections_enforced(self):
        p = self.payload(); p['body_markdown'] = 'Only a generic answer'
        self.client.force_authenticate(self.editor)
        r = self.client.post(BASE + 'manage/articles/', p, format='json')
        self.assertEqual(self.client.post(BASE + f"manage/versions/{r.data['version_id']}/submit/", {}, format='json').status_code, 400)

    def test_search_synonyms_rank_dedupe_and_page(self):
        self.publish('TEST-01', '测试：Cobb角是什么？')
        self.publish('TEST-02', '测试：其他问题')
        self.client.force_authenticate(None)
        r = self.client.get(BASE + 'articles/?q=侧弯度数&page_size=1')
        self.assertEqual(r.data['count'], 2)
        self.assertEqual(r.data['results'][0]['id'], 'TEST-01')
        self.assertEqual(r.data['next'], 2)
        r2 = self.client.get(BASE + 'articles/?q=侧弯度数&page_size=1&page=2')
        self.assertEqual(r2.data['results'][0]['id'], 'TEST-02')
        self.assertEqual(self.client.get(BASE + 'articles/?page=oops').status_code, 400)

    def test_withdrawal_hides_search_favorites_related_and_sources(self):
        first = self.publish()
        self.client.force_authenticate(self.patient)
        self.client.put(BASE + 'articles/TEST-01/bookmark/', {}, format='json')
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(BASE + f"manage/versions/{first['version_id']}/withdraw/", {'note': 'Test withdrawal'}, format='json').status_code, 200)
        self.client.force_authenticate(self.patient)
        self.assertEqual(self.client.get(BASE + 'articles/TEST-01/').status_code, 410)
        self.assertEqual(self.client.get(BASE + 'articles/?bookmarked=1').data['count'], 0)
        self.assertEqual(self.client.get(BASE + 'sources/TEST-ONLY/').status_code, 404)
        self.assertEqual(self.client.get(BASE + 'catalog/').data['recommended'], [])

    def test_invalid_source_hides_referencing_article(self):
        self.publish()
        self.client.force_authenticate(self.reviewer)
        self.client.post(BASE + 'manage/sources/TEST-ONLY/verify/', {'status': 'invalid', 'note': 'Test retraction'}, format='json')
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(BASE + 'articles/TEST-01/').status_code, 404)
        self.assertEqual(self.client.get(BASE + 'articles/').data['count'], 0)

    def test_bookmark_and_feedback_are_account_scoped(self):
        self.publish()
        self.client.force_authenticate(self.patient)
        for _ in range(2): self.assertEqual(self.client.put(BASE + 'articles/TEST-01/bookmark/', {}, format='json').status_code, 200)
        self.assertEqual(Bookmark.objects.count(), 1)
        self.assertEqual(self.client.post(BASE + 'articles/TEST-01/feedback/', {'text': 'Test correction'}, format='json').status_code, 201)
        self.client.force_authenticate(self.other)
        self.assertFalse(self.client.get(BASE + 'articles/TEST-01/').data['bookmarked'])
        self.client.delete(BASE + 'articles/TEST-01/bookmark/')
        self.assertEqual(Bookmark.objects.count(), 1)
        self.assertEqual(self.client.get(BASE + 'articles/?bookmarked=1').data['count'], 0)
        self.assertEqual(self.client.get(BASE + 'manage/feedback/').status_code, 403)

    def test_feedback_resolution_audited(self):
        self.publish(); self.client.force_authenticate(self.patient)
        fid = self.client.post(BASE + 'articles/TEST-01/feedback/', {'text': 'Wrong reference'}, format='json').data['id']
        self.client.force_authenticate(self.editor)
        self.assertEqual(self.client.post(BASE + f'manage/feedback/{fid}/', {'response': 'Correction queued for clinical review'}, format='json').status_code, 200)
        self.assertEqual(Feedback.objects.get(pk=fid).status, 'resolved')
        self.assertTrue(AuditLog.objects.filter(action='resolve_feedback').exists())

    def test_no_private_data_in_article_or_community_projection(self):
        from life.models import Post
        self.publish()
        private = Post.objects.create(owner=self.patient, group='brace', body='PRIVATE_PENDING_SENTINEL', status='pending')
        public = Post.objects.create(owner=self.patient, group='brace', body='PUBLIC_EXPERIENCE', status='published')
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(BASE + 'manage/community-links/', {'article_id': 'TEST-01', 'post_id': private.pk, 'approved': True}, format='json').status_code, 404)
        self.client.post(BASE + 'manage/community-links/', {'article_id': 'TEST-01', 'post_id': public.pk, 'approved': True}, format='json')
        self.client.force_authenticate(None)
        data = self.client.get(BASE + 'articles/TEST-01/').data
        self.assertEqual(data['discussions'][0]['label'], '个人经验')
        text = json.dumps(data, default=str)
        self.assertNotIn('PRIVATE_PENDING_SENTINEL', text)
        self.assertNotIn('kb-patient', text)
        public.status = 'rejected'; public.save()
        self.assertEqual(self.client.get(BASE + 'articles/TEST-01/').data['discussions'], [])

    def test_private_attachment_url_cannot_be_published(self):
        self.client.force_authenticate(self.editor)
        p = self.payload(); p['body_markdown'] += '\n![private](/api/v1/attachments/test/content/?signature=secret)'
        self.assertEqual(self.client.post(BASE + 'manage/articles/', p, format='json').status_code, 400)

    def test_markdown_sanitizes_xss_and_supports_tables(self):
        self.client.force_authenticate(self.editor)
        md = '<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n![caption](https://example.org/figure.png)'
        html = self.client.post(BASE + 'manage/preview/', {'body_markdown': md}, format='json').data['html']
        self.assertNotIn('<script', html)
        self.assertNotIn('href="javascript:', html)
        self.assertIn('<table>', html)
        self.assertIn('alt="caption"', html)

    def import_row(self):
        return {'id': 'IMPORT-01', 'title': 'Imported original', 'category': '看懂检查结果', 'summary': 'Original summary',
                'body_markdown': 'Original long body preserved', 'clinical_review_status': 'pending', 'publication_status': 'draft_not_approved', 'version': '6.0',
                'evidence_locations': [{'url': self.source.url, 'section': 'Diagnosis', 'verified': 'section_identified_not_claim_audited'}]}

    def test_import_preview_commit_duplicate_and_rollback(self):
        row = self.import_row()
        job = preview(self.editor, 'articles.json', json.dumps([row]).encode())
        self.assertFalse(Article.objects.filter(pk=row['id']).exists())
        job = commit(self.editor, job.pk)
        version = ArticleVersion.objects.get(article_id=row['id'])
        self.assertEqual(version.body_markdown, row['body_markdown'])
        self.assertEqual(version.imported_metadata, row)
        self.assertEqual(version.review_status, 'draft')
        self.assertFalse(version.claims.exists())
        self.assertEqual(public_articles().count(), 0)
        commit(self.editor, job.pk)
        self.assertEqual(ArticleVersion.objects.filter(article_id=row['id']).count(), 1)
        duplicate = preview(self.editor, 'articles.json', json.dumps([row]).encode())
        self.assertTrue(duplicate.report['errors'])
        rollback(self.admin, job.pk)
        self.assertFalse(Article.objects.filter(pk=row['id']).exists())
        self.assertTrue(AuditLog.objects.filter(action='import_rollback').exists())

    def test_import_atomic_validation_and_rollback_guard(self):
        from rest_framework.exceptions import ValidationError
        row = self.import_row()
        bad = {**row, 'id': 'BAD', 'category': 'unknown'}
        job = preview(self.editor, 'articles.json', json.dumps([row, bad]).encode())
        with self.assertRaises(ValidationError): commit(self.editor, job.pk)
        self.assertFalse(Article.objects.filter(pk=row['id']).exists())
        job = commit(self.editor, preview(self.editor, 'articles.json', json.dumps([row]).encode()).pk)
        ArticleVersion.objects.filter(article_id=row['id']).update(revision=2)
        with self.assertRaises(ValidationError): rollback(self.admin, job.pk)
        self.assertTrue(Article.objects.filter(pk=row['id']).exists())

    def test_json_csv_markdown_and_zip_import_formats(self):
        import csv
        row = self.import_row(); row.pop('evidence_locations')
        stream = io.StringIO(); writer = csv.DictWriter(stream, fieldnames=row.keys()); writer.writeheader(); writer.writerow(row)
        for name, raw in [('articles.json', json.dumps([row]).encode()), ('articles.csv', stream.getvalue().encode()),
                          ('article.md', ('---\nid: MD-01\ntitle: Markdown article\ncategory: 看懂检查结果\nsummary: markdown test\n---\n## 正文\nOriginal content').encode())]:
            job = preview(self.editor, name, raw)
            self.assertEqual(job.report['count'], 1)
            self.assertEqual(job.report['errors'], [])
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as z:
            z.writestr('pack/articles.json', json.dumps([row])); z.writestr('pack/sources.json', '{}'); z.writestr('pack/duplicate.md', '# same content')
        job = preview(self.editor, 'package.zip', buffer.getvalue())
        self.assertEqual(job.report['count'], 1)
        self.assertEqual(len(job.report['manifest']), 3)

    def test_zip_path_traversal_and_duplicate_ids_rejected(self):
        from rest_framework.exceptions import ValidationError
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as z:
            z.writestr('../articles.json', json.dumps([self.import_row()]))
        with self.assertRaises(ValidationError): preview(self.editor, 'unsafe.zip', buffer.getvalue())
        job = preview(self.editor, 'duplicate.json', json.dumps([self.import_row(), self.import_row()]).encode())
        self.assertTrue(job.report['errors'])

    def test_import_forged_external_approval_does_not_publish(self):
        row = {**self.import_row(), 'clinical_review_status': 'approved', 'reviewer': 'unverified-person'}
        job = commit(self.editor, preview(self.editor, 'articles.json', json.dumps([row]).encode()).pk)
        self.assertTrue(job.report['warnings'])
        self.assertEqual(ArticleVersion.objects.get(article_id=row['id']).review_status, 'draft')

    def test_invalid_payload_produces_report_not_server_error(self):
        row = {**self.import_row(), 'title': ['bad'], 'source_ids': 'bad'}
        job = preview(self.editor, 'bad.json', json.dumps([row]).encode())
        self.assertTrue(job.report['errors'])

    def test_automatic_link_checker_never_confers_medical_status(self):
        from django.core.management import call_command
        Source.objects.filter(pk=self.source.pk).update(verification_status='unchecked')
        with patch('knowledge.management.commands.check_knowledge_sources.check_link', return_value='ok'):
            call_command('check_knowledge_sources', limit=1, stdout=io.StringIO())
        self.source.refresh_from_db()
        self.assertEqual(self.source.link_status, 'ok')
        self.assertEqual(self.source.verification_status, 'unchecked')

    def test_link_checker_rejects_private_and_nonallowlisted_urls(self):
        from .linkcheck import safe_url
        for url in ['http://127.0.0.1/', 'https://127.0.0.1/', 'https://evil.example/', 'file:///etc/passwd', 'https://www.niams.nih.gov@127.0.0.1/', 'https://www.niams.nih.gov:8443/']:
            self.assertFalse(safe_url(url), url)

    def test_published_citations_remain_snapshotted_after_source_edit(self):
        self.publish()
        self.client.force_authenticate(self.editor)
        self.client.patch(BASE + 'manage/sources/TEST-ONLY/', {'title': 'Changed source metadata'}, format='json')
        self.client.force_authenticate(None)
        data = self.client.get(BASE + 'articles/TEST-01/').data
        self.assertEqual(data['sources'][0]['title'], 'Synthetic test source, not medical evidence')
        self.assertTrue(data['needs_review'])

    def test_evidence_must_be_rechecked_if_metadata_changed(self):
        v = self.create(); vid = v['version_id']; eid = v['claims'][0]['evidence'][0]['id']
        self.client.post(BASE + f'manage/versions/{vid}/submit/', {}, format='json')
        self.client.force_authenticate(self.reviewer)
        self.client.post(BASE + f'manage/evidence/{eid}/verify/', {'note': 'Checked before metadata change'}, format='json')
        self.client.force_authenticate(self.editor)
        self.client.patch(BASE + 'manage/sources/TEST-ONLY/', {'year': 2020}, format='json')
        self.client.force_authenticate(self.reviewer)
        self.client.post(BASE + 'manage/sources/TEST-ONLY/verify/', {'status': 'verified', 'note': 'Corrected publication year'}, format='json')
        r = self.client.post(BASE + f'manage/versions/{vid}/approve/', {'note': 'Test', 'all_claims_checked': True, 'rights_checked': True}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_http_envelope_contains_pagination_and_cache_control(self):
        self.publish()
        self.client.force_authenticate(None)
        response = self.client.get(BASE + 'articles/?q=Cobb')
        self.assertEqual(response['Cache-Control'], 'no-store')
        body = response.json()
        self.assertIsInstance(body['data'], list)
        self.assertEqual(body['meta']['count'], 1)
        self.assertIn('suggestions', body['meta'])

    def test_invalid_admin_methods_do_not_raise_server_errors(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.patch(BASE + 'manage/sources/', {}, format='json').status_code, 405)
        self.assertEqual(self.client.post(BASE + 'manage/sources/TEST-ONLY/', {}, format='json').status_code, 405)
        self.assertEqual(self.client.post(BASE + 'manage/feedback/', {}, format='json').status_code, 405)

    def test_schema_includes_knowledge_catalog_and_import(self):
        self.client.force_authenticate(None)
        paths = self.client.get('/api/schema/').json()['paths']
        self.assertIn(BASE + 'catalog/', paths)
        self.assertIn('multipart/form-data', paths[BASE + 'manage/imports/']['post']['requestBody']['content'])

    def test_multipart_import_and_invalid_json_body(self):
        self.client.force_authenticate(self.editor)
        file = SimpleUploadedFile('articles.json', json.dumps([self.import_row()]).encode(), content_type='application/json')
        response = self.client.post(BASE + 'manage/imports/', {'file': file}, format='multipart')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()['data']['report']['count'], 1)
        self.assertEqual(self.client.post(BASE + 'manage/articles/', [], format='json').status_code, 400)


from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest import skipUnless
from django.db import close_old_connections, connection
from django.test import TransactionTestCase


@skipUnless(connection.vendor == 'postgresql', 'Row-lock behavior requires PostgreSQL')
@override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class KnowledgeConcurrencyTests(TransactionTestCase):
    def test_concurrent_new_versions_create_only_one_draft(self):
        from rest_framework.exceptions import ValidationError
        from .services import clone_version
        user = get_user_model().objects.create_user('kb-concurrency-editor', password='test')
        user.groups.add(Group.objects.get_or_create(name=EDITOR)[0])
        category = Category.objects.create(id='test-category', name='Test category')
        article = Article.objects.create(id='CONCURRENCY-TEST')
        # Synthetic approved state exists only to exercise clone locking, never for publication.
        version = ArticleVersion.objects.create(article=article, number=1, title='Test only', summary='Test', body_markdown='Test', audience='Test', editor=user, review_status='approved')
        version.categories.add(category)
        barrier = Barrier(2)

        def clone(_):
            close_old_connections()
            try:
                actor = get_user_model().objects.get(pk=user.pk)
                barrier.wait(timeout=10)
                try:
                    clone_version(actor, article.pk)
                    return 'created'
                except ValidationError:
                    return 'blocked'
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(clone, range(2)))
        self.assertEqual(sorted(results), ['blocked', 'created'])
        self.assertEqual(ArticleVersion.objects.filter(article=article).count(), 2)
