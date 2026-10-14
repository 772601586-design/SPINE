"""后台隐私边界的守卫测试（规格 v2.0 §2.1）。

这些断言不是为了"测 Django"，而是把一条产品规则钉住：**后台是内容运营工具，
不是用户数据查看器**。以后有人为了排查问题顺手把 `Visit` 或 `Attachment` 注册进
后台，这里会先红，逼着那次提交把隐私影响讲清楚。
"""

from django.contrib import admin
from django.core.exceptions import ImproperlyConfigured
from django.test import TestCase
from django.urls import reverse
from rest_framework.authtoken.models import Token

from braces.models import WearSession
from core.admin import CONTENT_OPERATION_MODELS, PRIVATE_MODELS, enforce_privacy_boundary


class AdminPrivacyBoundaryTests(TestCase):
    def test_private_models_are_not_registered(self):
        leaked = [model.__name__ for model in PRIVATE_MODELS if admin.site.is_registered(model)]
        self.assertEqual(leaked, [], f"用户私域模型不得出现在后台：{leaked}")

    def test_auth_tokens_are_not_browsable(self):
        # 令牌等于登录凭证，能在后台看到就等于能冒充任意用户。
        self.assertFalse(admin.site.is_registered(Token))

    def test_content_operation_models_are_registered(self):
        # 反向约束：写进白名单的模型必须真的注册了，避免白名单变成摆设。
        missing = [model.__name__ for model in CONTENT_OPERATION_MODELS if not admin.site.is_registered(model)]
        self.assertEqual(missing, [], f"白名单模型未注册：{missing}")

    def test_admin_requires_sign_in(self):
        response = self.client.get("/admin/")
        self.assertEqual(response.status_code, 302)
        self.assertIn("/admin/login/", response["Location"])
        self.assertEqual(reverse("admin:index"), "/admin/")

    def test_admin_registry_has_no_user_content_apps(self):
        # 任何"看起来像用户数据"的模型都不该出现在后台首页。
        registered_apps = {
            model._meta.app_label for model in admin.site._registry
        }
        self.assertEqual(registered_apps & {"braces", "profiles", "medical"}, set())

    def test_guard_passes_on_clean_registry(self):
        # 当前注册表是干净的，守卫必须放行——否则所有 manage.py 命令都起不来。
        enforce_privacy_boundary()

    def test_guard_catches_private_model_registered_after_import(self):
        # 守卫在 CoreConfig.ready() 执行，晚于各 app 的 admin.py 导入。
        # 这里模拟"事后有人注册了私域模型"，守卫必须在那时仍然能拦住。
        admin.site.register(WearSession)
        try:
            with self.assertRaises(ImproperlyConfigured):
                enforce_privacy_boundary()
        finally:
            admin.site.unregister(WearSession)
