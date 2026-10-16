from django.contrib import admin

from .models import Article, Post, PostReport


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ["title", "category", "topic", "reviewer", "published"]
    list_filter = ["category", "published"]

@admin.register(Post)
class PostAdmin(admin.ModelAdmin):
    list_display = ["id", "group", "status", "created_at"]
    list_filter = ["status", "group"]
    fields = ["group", "body", "status", "moderation_note", "created_at"]
    readonly_fields = ["group", "body", "created_at"]

    def has_add_permission(self, request):
        return False


@admin.register(PostReport)
class PostReportAdmin(admin.ModelAdmin):
    list_display = ["id", "post", "resolved"]
    fields = ["post", "reason", "resolved"]
    readonly_fields = ["post", "reason"]

    def has_add_permission(self, request):
        return False
