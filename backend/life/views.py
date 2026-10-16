from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Exists, OuterRef, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from braces.models import WearSession
from medical.models import CurveMeasurement, Visit
from training.models import TrainingAttempt
from training.services import lock_owner
from .models import Article, DailyRecord, LearningRecord, Post, PostLike, PostReport, Preferences
from .serializers import ArticleSerializer, DailyRecordSerializer, PostSerializer, PreferencesSerializer
from .services import award, reward_summary, wear_record_dates


class PreferencesView(APIView):
    def get(self, request):
        row, _ = Preferences.objects.get_or_create(owner=request.user)
        return Response(PreferencesSerializer(row).data)

    def patch(self, request):
        row, _ = Preferences.objects.get_or_create(owner=request.user)
        serializer = PreferencesSerializer(row, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class RecordViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = DailyRecordSerializer

    def get_queryset(self):
        rows = DailyRecord.objects.filter(owner=self.request.user)
        kind = self.request.query_params.get("kind")
        return rows.filter(kind=kind) if kind else rows

    def list(self, request):
        return Response(self.get_serializer(self.get_queryset()[:100], many=True).data)

    def create(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        with transaction.atomic():
            lock_owner(request.user)
            existing = DailyRecord.objects.filter(owner=request.user, request_id=values["request_id"]).first()
            if not existing and values["kind"] == "makeup":
                if DailyRecord.objects.filter(owner=request.user, kind="makeup", date=values["date"]).exists():
                    raise ValidationError("该日期已经补记。")
                if reward_summary(request.user)["balance"] < 10:
                    raise ValidationError("补记需要 10 松果，当前余额不足。")
                award(request.user, f"makeup:{values['date']}", -10, "日历补记")
            row, created = DailyRecord.objects.get_or_create(owner=request.user, request_id=values["request_id"], defaults=values)
            if not created and any(getattr(row, key) != value for key, value in values.items()):
                raise ValidationError("同一请求编号不能用于不同内容。")
        return Response(self.get_serializer(row).data, status=201 if created else 200)


class ArticleViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ArticleSerializer
    queryset = Article.objects.filter(published=True, reviewer__gt="").order_by("id")

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        row, _ = LearningRecord.objects.get_or_create(owner=request.user, article=self.get_object())
        return Response({"read": True, "passed": row.passed})

    @action(detail=True, methods=["post"])
    def answer(self, request, pk=None):
        article = self.get_object()
        option = request.data.get("option")
        if not article.question or type(option) is not int or not 0 <= option < len(article.options):
            raise ValidationError("请选择有效答案。")
        passed = option == article.correct_option
        row, _ = LearningRecord.objects.get_or_create(owner=request.user, article=article)
        if passed and not row.passed:
            row.passed = True
            row.save(update_fields=["passed"])
        return Response({"correct": passed, "explanation": article.explanation})


class RewardView(APIView):
    def get(self, request):
        return Response(reward_summary(request.user))


class SummaryView(APIView):
    def get(self, request):
        now = timezone.localdate()
        pref, _ = Preferences.objects.get_or_create(owner=request.user)
        visits = Visit.objects.filter(user=request.user)
        first = visits.filter(date_precision="day").order_by("visit_date").first()
        curves = CurveMeasurement.objects.filter(visit__user=request.user).select_related("visit").order_by("visit__visit_date", "created_at")
        training = TrainingAttempt.objects.filter(owner=request.user, status="completed")
        monday = now - timedelta(days=now.weekday())
        swim = DailyRecord.objects.filter(owner=request.user, kind="swim", date__gte=monday, date__lte=now)
        wear_dates = wear_record_dates(request.user, include_open=True)
        review = None
        if pref.review_enabled and pref.review_date:
            review = {"date": pref.review_date, "days": (pref.review_date - now).days,
                      "checklist": ["整理历次报告与影像", "核对个人训练和佩戴记录", "记下希望与医生讨论的问题"]}
        data = {"date": now, "review": review, "swim_today": now.weekday() in pref.swim_weekdays,
                "swim_week_count": swim.count(), "training_count": training.count(), "brace_record_days": len(wear_dates),
                "record_days": (now - first.visit_date).days + 1 if first else None,
                "curves": [{"id": str(row.pk), "date": row.visit.visit_date, "month": row.visit.visit_month,
                    "region": row.region, "direction": row.direction, "angle": row.cobb_angle,
                    "end_vertebrae": row.end_vertebrae} for row in curves],
                "measurement_note": "仅并列同部位、同方向及相同端椎的记录。测量方式与体位差异会影响数值，请由医生解释变化。"}
        pain = DailyRecord.objects.filter(owner=request.user, kind="pain").first()
        text = ["我的复查准备摘要", f"生成日期：{now}", f"已完成训练：{data['training_count']} 次",
                f"有佩戴记录：{len(wear_dates)} 天", f"本周游泳：{swim.count()} 次"]
        for visit in visits[:20]:
            text.append(f"就诊 {visit.visit_date or visit.visit_month or '日期不详'}：{visit.institution} {visit.title}；记录：{visit.notes}")
        for row in data["curves"]:
            text.append(f"用户录入 Cobb：{row['date'] or row['month'] or '日期不详'} {row['region']} {row['direction']} {row['angle']}° 端椎 {row['end_vertebrae']}")
        if pain:
            text.append(f"最近身体记录 {pain.date}：{pain.pain}/10；{pain.notes}")
        text.append(data["measurement_note"])
        data["summary_text"] = "\n".join(text)
        return Response(data)


class PostViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = PostSerializer

    def get_queryset(self):
        rows = Post.objects.filter(Q(status="published") | Q(owner=self.request.user))
        if self.request.query_params.get("mine") == "1":
            rows = rows.filter(owner=self.request.user)
        group = self.request.query_params.get("group")
        if group:
            rows = rows.filter(group=group)
        return rows.annotate(like_count=Count("likes"), liked=Exists(PostLike.objects.filter(post_id=OuterRef("pk"), owner=self.request.user)))

    def list(self, request):
        return Response(self.get_serializer(self.get_queryset()[:100], many=True).data)

    def create(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        row, created = Post.objects.get_or_create(owner=request.user, request_id=values["request_id"], defaults=values)
        if not created and any(getattr(row, key) != value for key, value in values.items()):
            raise ValidationError("请求编号已经用于另一条分享。")
        return Response(self.get_serializer(self.get_queryset().get(pk=row.pk)).data, status=201 if created else 200)

    def destroy(self, request, pk=None):
        get_object_or_404(Post, pk=pk, owner=request.user).delete()
        return Response(status=204)

    @action(detail=True, methods=["post"])
    def like(self, request, pk=None):
        post = get_object_or_404(Post, pk=pk, status="published")
        liked = request.data.get("liked")
        if type(liked) is not bool:
            raise ValidationError("请提供点赞状态。")
        if liked:
            PostLike.objects.get_or_create(owner=request.user, post=post)
        else:
            PostLike.objects.filter(owner=request.user, post=post).delete()
        return Response({"liked": liked, "like_count": post.likes.count()})

    @action(detail=True, methods=["post"])
    def report(self, request, pk=None):
        post = get_object_or_404(Post, pk=pk, status="published")
        field = serializers.CharField(max_length=500, allow_blank=False)
        reason = field.run_validation(request.data.get("reason"))
        PostReport.objects.update_or_create(owner=request.user, post=post, defaults={"reason": reason, "resolved": False})
        return Response({"reported": True})
