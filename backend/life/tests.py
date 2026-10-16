import uuid
from unittest.mock import patch
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Attachment
from .models import Article, DailyRecord, Post, PostReport, Reward
from .ocr import OCRUnavailable, prescription_candidates


class LifeAPITests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user(username="life-owner")
        self.other = get_user_model().objects.create_user(username="life-other")
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def post_record(self, **values):
        payload = {"request_id": str(uuid.uuid4()), "kind": "swim", "date": str(timezone.localdate()), "minutes": 30}
        payload.update(values)
        return self.client.post("/api/v1/life/records/", payload, format="json"), payload

    def test_records_persist_and_retry_without_duplicate(self):
        response, payload = self.post_record()
        self.assertEqual(response.status_code, 201, response.data)
        retry = self.client.post("/api/v1/life/records/", payload, format="json")
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual(DailyRecord.objects.count(), 1)
        payload["minutes"] = 40
        self.assertEqual(self.client.post("/api/v1/life/records/", payload, format="json").status_code, 400)

    def test_private_records_not_visible_to_another_account(self):
        response, _ = self.post_record()
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/v1/life/records/").data, [])
        self.assertEqual(self.client.get(f"/api/v1/life/records/{response.data['id']}/").status_code, 404)

    def test_validation_dates_pain_duration_and_attachment(self):
        for values in [{"date": str(timezone.localdate() + timedelta(days=1))}, {"minutes": 0},
                       {"kind": "pain", "pain": 11}, {"kind": "pain", "pain": None}, {"kind": "drawing"}]:
            response, _ = self.post_record(**values)
            self.assertEqual(response.status_code, 400, response.data)
        attachment = Attachment.objects.create(owner=self.other, purpose="private_record", status="ready",
            storage_key="life-test-other", mime_type="image/png", size_bytes=100)
        response, _ = self.post_record(kind="drawing", attachment=str(attachment.pk))
        self.assertEqual(response.status_code, 400)

    def test_reminder_requires_date_and_swim_days_are_validated(self):
        path = "/api/v1/life/preferences/"
        self.assertFalse(self.client.get(path).data["review_enabled"])
        for values in [{"review_enabled": True}, {"swim_weekdays": [7]}, {"swim_weekdays": [1, 1]},
                       {"swim_weekdays": [True]}, {"sedentary_minutes": 1}, {"brace_target_hours": 25}]:
            self.assertEqual(self.client.patch(path, values, format="json").status_code, 400)
        response = self.client.patch(path, {"review_enabled": True, "review_date": str(timezone.localdate()), "swim_weekdays": [0, 2, 4]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNotNone(self.client.get("/api/v1/life/summary/").data["review"])
        self.client.patch(path, {"review_enabled": False}, format="json")
        self.assertIsNone(self.client.get("/api/v1/life/summary/").data["review"])

    def article(self, **values):
        payload = dict(title="私人视频如何保存", body="本机视频只保存在本机。", category="learning", reviewer="内容审核",
                       published=True, question="是否默认公开？", options=["公开", "不公开"], correct_option=1, explanation="仅本人保存。")
        payload.update(values)
        return Article.objects.create(**payload)

    def test_only_reviewed_published_content_and_rewards_once(self):
        article = self.article()
        self.article(published=False)
        self.article(reviewer="")
        visible = self.client.get("/api/v1/life/articles/").data
        self.assertEqual(len(visible), 1)
        self.assertNotIn("correct_option", visible[0])
        self.assertEqual(self.client.post(f"/api/v1/life/articles/{article.pk}/answer/", {"option": 0}, format="json").data["correct"], False)
        self.assertEqual(self.client.get("/api/v1/life/rewards/").data["balance"], 0)
        for _ in range(2):
            self.client.post(f"/api/v1/life/articles/{article.pk}/answer/", {"option": 1}, format="json")
            self.assertEqual(self.client.get("/api/v1/life/rewards/").data["balance"], 2)
        self.assertEqual(Reward.objects.count(), 1)

    def test_posts_moderation_privacy_likes_reports_and_delete(self):
        payload = {"request_id": str(uuid.uuid4()), "group": "brace", "body": "今天记录了自己的生活", "status": "published"}
        response = self.client.post("/api/v1/life/posts/", payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        post = Post.objects.get()
        self.assertEqual(post.status, "pending")
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/v1/life/posts/").data, [])
        self.assertEqual(self.client.delete(f"/api/v1/life/posts/{post.pk}/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/v1/life/posts/{post.pk}/like/", {"liked": True}, format="json").status_code, 404)
        post.status = "published"
        post.save()
        public = self.client.get("/api/v1/life/posts/").data[0]
        self.assertNotIn("owner", public)
        for _ in range(2):
            self.assertEqual(self.client.post(f"/api/v1/life/posts/{post.pk}/like/", {"liked": True}, format="json").status_code, 200)
        self.assertEqual(post.likes.count(), 1)
        self.client.post(f"/api/v1/life/posts/{post.pk}/report/", {"reason": "包含私人信息"}, format="json")
        self.assertEqual(PostReport.objects.count(), 1)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.delete(f"/api/v1/life/posts/{post.pk}/").status_code, 204)

    def test_private_summary_and_rewards_require_authentication(self):
        self.client.force_authenticate(None)
        for name in ["summary", "preferences", "rewards", "records", "posts", "articles"]:
            self.assertEqual(self.client.get(f"/api/v1/life/{name}/").status_code, 401)

    def test_ocr_only_reads_own_ready_medical_images(self):
        attachment = Attachment.objects.create(owner=self.owner, purpose="medical", status="ready",
            storage_key="life-ocr-test", mime_type="image/png", size_bytes=100)
        path = "/api/v1/life/ocr/"
        with patch("life.ocr.recognize", return_value="侧 向 伸 展 3 组 每 组 1 2 次") as recognizer:
            response = self.client.post(path, {"attachment": str(attachment.pk)}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertTrue(response.data["requires_confirmation"])
            self.assertEqual(response.data["candidates"][0]["reps_per_set"], 12)
            self.client.force_authenticate(self.other)
            self.assertEqual(self.client.post(path, {"attachment": str(attachment.pk)}, format="json").status_code, 404)
            self.assertEqual(recognizer.call_count, 1)
        self.client.force_authenticate(self.owner)
        with patch("life.ocr.recognize", side_effect=OCRUnavailable()):
            self.assertEqual(self.client.post(path, {"attachment": str(attachment.pk)}, format="json").status_code, 503)
        self.assertEqual(self.client.post(path, {"attachment": "invalid"}, format="json").status_code, 400)
        self.assertEqual(prescription_candidates("仅供复查，未注明训练量"), [])

    def test_prescription_import_diff_retry_and_revision_guard(self):
        from training.models import PersonalActionCard
        path = "/api/v1/life/prescriptions/"
        payload = {"request_id": str(uuid.uuid4()), "rows": [{"name": "医生动作原文", "sets": 3, "reps_per_set": 12, "side": "not_applicable", "schedule_frequency": "daily"}]}
        first = self.client.post(path, payload, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        card = PersonalActionCard.objects.get(owner=self.owner)
        self.assertEqual(card.verification_status, "needs_check")
        self.assertIsNone(first.data["changes"][0]["before"])
        self.assertEqual(self.client.post(path, payload, format="json").status_code, 200)
        self.assertEqual(PersonalActionCard.objects.count(), 1)
        payload["rows"][0]["reps_per_set"] = 15
        self.assertEqual(self.client.post(path, payload, format="json").status_code, 400)
        payload["request_id"] = str(uuid.uuid4())
        payload["rows"][0].update(card_id=card.pk, expected_revision=card.revision)
        changed = self.client.post(path, payload, format="json")
        self.assertEqual(changed.status_code, 201, changed.data)
        self.assertEqual(changed.data["changes"][0]["before"]["reps_per_set"], 12)
        self.assertEqual(changed.data["changes"][0]["after"]["reps_per_set"], 15)
        payload["request_id"] = str(uuid.uuid4())
        self.assertEqual(self.client.post(path, payload, format="json").status_code, 400)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(path, payload, format="json").status_code, 404)

    def test_prescription_batch_rolls_back_on_invalid_later_card(self):
        from training.models import PersonalActionCard
        payload = {"request_id": str(uuid.uuid4()), "rows": [{"name": "第一行", "sets": 2}, {"name": "第二行", "card_id": 999999, "expected_revision": 1}]}
        self.assertEqual(self.client.post("/api/v1/life/prescriptions/", payload, format="json").status_code, 404)
        self.assertFalse(PersonalActionCard.objects.filter(owner=self.owner).exists())

    def test_makeup_debits_once_and_cannot_overdraw_or_repeat_date(self):
        date = str(timezone.localdate() - timedelta(days=1))
        payload = {"request_id": str(uuid.uuid4()), "kind": "makeup", "date": date}
        path = "/api/v1/life/records/"
        self.assertEqual(self.client.post(path, payload, format="json").status_code, 400)
        self.assertFalse(DailyRecord.objects.exists())
        Reward.objects.create(owner=self.owner, event="test-earned", label="已赚取", points=12)
        response = self.client.post(path, payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.client.post(path, payload, format="json").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/life/rewards/").data["balance"], 2)
        payload["request_id"] = str(uuid.uuid4())
        self.assertEqual(self.client.post(path, payload, format="json").status_code, 400)
        self.assertEqual(DailyRecord.objects.count(), 1)

    def test_weekly_drawing_reward_only_once_for_multiple_drawings(self):
        image = Attachment.objects.create(owner=self.owner, purpose="private_record", status="ready",
            storage_key="life-drawing-test", mime_type="image/png", size_bytes=100)
        for _ in range(2):
            response, _ = self.post_record(kind="drawing", attachment=str(image.pk))
            self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.client.get("/api/v1/life/rewards/").data["balance"], 1)
        self.assertEqual(self.client.get("/api/v1/life/rewards/").data["balance"], 1)

    def test_training_reward_requires_whole_today_deck(self):
        from training.models import PersonalActionCard, PlanVersion, SetExecution, TrainingAttempt, TrainingPlan
        plan = TrainingPlan.objects.create(owner=self.owner, current_version_no=1)
        version = PlanVersion.objects.create(plan=plan, version_no=1)
        cards = [PersonalActionCard.objects.create(owner=self.owner, plan=plan, name=f"动作 {index}", sets=1,
            reps_per_set=3, side="not_applicable", verification_status="ready", schedule_frequency="daily") for index in range(2)]
        for index, card in enumerate(cards):
            attempt = TrainingAttempt.objects.create(owner=self.owner, plan=plan, plan_version=version, card=card,
                card_revision=1, planned_dose=card.dose_snapshot(), status="completed", ended_at=timezone.now())
            SetExecution.objects.create(owner=self.owner, attempt=attempt, set_index=1, actual_reps=3)
            expected = 0 if index == 0 else 3
            self.assertEqual(self.client.get("/api/v1/life/rewards/").data["balance"], expected)
        self.assertEqual(self.client.get("/api/v1/life/rewards/").data["balance"], 3)
