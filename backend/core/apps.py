from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core"

    def ready(self):
        # admin 隐私守卫必须在所有 app 的 admin.py 都被 autodiscover 加载之后再跑，
        # 否则排在 core 之后的 app（braces/profiles/medical）注册私域模型不会被拦。
        # django.contrib.admin 排在 INSTALLED_APPS 第一位，其 ready() 先完成
        # autodiscover，因此这里执行时后台注册表已经是最终状态。
        from core.admin import enforce_privacy_boundary

        enforce_privacy_boundary()
