from django.urls import path
from . import views as v

urlpatterns = [
    path('catalog/', v.CatalogView.as_view()),
    path('articles/', v.ArticlesView.as_view()),
    path('articles/<slug:pk>/', v.ArticleDetailView.as_view()),
    path('articles/<slug:pk>/bookmark/', v.BookmarkView.as_view()),
    path('articles/<slug:pk>/feedback/', v.FeedbackView.as_view()),
    path('sources/<slug:pk>/', v.SourceDetailView.as_view()),
    path('manage/dashboard/', v.DashboardView.as_view()),
    path('manage/articles/', v.ManageArticlesView.as_view()),
    path('manage/articles/<slug:pk>/versions/', v.CloneView.as_view()),
    path('manage/versions/<int:pk>/', v.ManageVersionView.as_view()),
    path('manage/versions/<int:pk>/<str:action>/', v.TransitionView.as_view()),
    path('manage/preview/', v.PreviewView.as_view()),
    path('manage/imports/', v.ImportView.as_view()),
    path('manage/imports/<uuid:pk>/', v.ImportView.as_view()),
    path('manage/imports/<uuid:pk>/<str:action>/', v.ImportView.as_view()),
    path('manage/sources/<slug:pk>/verify/', v.SourceVerificationView.as_view()),
    path('manage/evidence/<int:pk>/verify/', v.EvidenceVerificationView.as_view()),
    path('manage/feedback/', v.ManageFeedbackView.as_view()),
    path('manage/feedback/<int:pk>/', v.ManageFeedbackView.as_view()),
    path('manage/community-links/', v.CommunityLinksView.as_view()),
    path('manage/audit/', v.AuditView.as_view()),
]
for resource in ['categories', 'topics', 'tags', 'sources']:
    urlpatterns += [path('manage/' + resource + '/', v.MetadataView.as_view(), {'resource': resource}),
                    path('manage/' + resource + '/<slug:pk>/', v.MetadataView.as_view(), {'resource': resource})]
