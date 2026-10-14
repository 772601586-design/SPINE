from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import OperationalError
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient, APITestCase

from core.auth_views import _username_for_openid
from core.models import WechatAccount
from core.wechat import WechatError


def payload(response):
    """成功响应信封里的 data（规格 v2.0 §14）。"""
    body = response.json()
    assert "data" in body, f"成功响应缺少 data 信封: {body}"
    return body["data"]


def failure(response):
    """失败响应信封里的 error。"""
    body = response.json()
    assert "error" in body, f"失败响应缺少 error 信封: {body}"
    return body["error"]


class InfrastructureTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def test_health_requires_no_database(self):
        response = self.client.get(reverse("health"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["service"], "spine-backend")
        self.assertEqual(response.json()["api_version"], "v1")

    @patch("core.views.connection")
    def test_readiness_returns_503_without_disclosing_database_error(self, database):
        database.cursor.side_effect = OperationalError("sensitive connection details")
        response = self.client.get(reverse("ready"))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "unavailable", "database": "unavailable"})

    @patch("core.views.connection")
    def test_readiness_checks_database(self, database):
        cursor = database.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (1,)
        response = self.client.get(reverse("ready"))
        cursor.execute.assert_called_once_with("SELECT 1")
        self.assertEqual(response.status_code, 200)

    def test_openapi_describes_both_endpoints(self):
        response = self.client.get(reverse("schema"))
        self.assertEqual(response.status_code, 200)
        schema = response.json()
        self.assertTrue(schema["openapi"].startswith("3."))
        self.assertIn("/api/v1/health/", schema["paths"])
        self.assertIn("503", schema["paths"]["/api/v1/ready/"]["get"]["responses"])

    def test_allowed_browser_origin(self):
        response = self.client.get(reverse("health"), HTTP_ORIGIN="http://localhost:5173")
        self.assertEqual(response["Access-Control-Allow-Origin"], "http://localhost:5173")


class WechatLoginTests(APITestCase):
    """微信登录：只把 wx.login 的 code 交给服务端，AppSecret 与 openid 都不下发。"""

    def setUp(self):
        # 登录接口带 AnonRateThrottle，清缓存避免用例之间互相计入限流。
        cache.clear()
        self.url = reverse("wechat-login")

    def login(self, code="valid-code", openid="openid-alpha", unionid="union-alpha"):
        with patch("core.auth_views.exchange_code", return_value=(openid, unionid)) as exchange:
            response = self.client.post(self.url, {"code": code}, format="json")
        return response, exchange

    def test_first_login_creates_account_and_returns_token(self):
        response, exchange = self.login()
        # code 原样传给换码逻辑，客户端不参与 openid 解析。
        exchange.assert_called_once_with("valid-code")
        self.assertEqual(response.status_code, 200)
        body = payload(response)
        self.assertTrue(body["is_new"])
        self.assertTrue(body["token"])
        self.assertEqual(body["user"]["username"], _username_for_openid("openid-alpha"))
        self.assertEqual(WechatAccount.objects.count(), 1)

    def test_repeat_login_reuses_same_account_and_token(self):
        first, _ = self.login()
        second, _ = self.login()
        self.assertFalse(payload(second)["is_new"])
        self.assertEqual(payload(first)["user"]["id"], payload(second)["user"]["id"])
        self.assertEqual(payload(first)["token"], payload(second)["token"])
        self.assertEqual(WechatAccount.objects.count(), 1)

    def test_response_never_contains_openid(self):
        response, _ = self.login(openid="openid-should-stay-server-side")
        self.assertNotIn("openid-should-stay-server-side", response.content.decode("utf-8"))

    def test_new_account_has_no_usable_password(self):
        self.login()
        self.assertFalse(get_user_model().objects.get().has_usable_password())

    def test_wechat_rejection_creates_nothing(self):
        with patch(
            "core.auth_views.exchange_code",
            side_effect=WechatError("微信登录失败，请重试。", error_code=40029),
        ):
            response = self.client.post(self.url, {"code": "expired"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(WechatAccount.objects.count(), 0)
        # 微信的 errmsg 不回显给客户端。
        error = failure(response)
        self.assertNotIn("40029", error["message"])
        self.assertEqual(error["code"], "VALIDATION_ERROR")

    @override_settings(WECHAT_APPID="", WECHAT_APPSECRET="")
    def test_missing_server_credentials_reports_503(self):
        # 不 patch 换码逻辑，真实走到凭证检查。
        response = self.client.post(self.url, {"code": "any"}, format="json")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(WechatAccount.objects.count(), 0)
        # 未配置必须与真正的服务端故障可区分，否则客户端无法给出正确指引。
        self.assertEqual(failure(response)["code"], "SERVICE_UNAVAILABLE")

    def test_code_is_required(self):
        response = self.client.post(self.url, {}, format="json")
        self.assertEqual(response.status_code, 400)
        error = failure(response)
        self.assertEqual(error["code"], "VALIDATION_ERROR")
        self.assertIn("code", error["field_errors"])

    def test_different_openids_get_separate_accounts(self):
        first, _ = self.login(openid="openid-a")
        second, _ = self.login(openid="openid-b")
        self.assertNotEqual(payload(first)["user"]["id"], payload(second)["user"]["id"])
        self.assertEqual(WechatAccount.objects.count(), 2)

    def test_issued_token_authenticates_other_endpoints(self):
        body = payload(self.login()[0])
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {body['token']}")
        response = self.client.get(reverse("me"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload(response)["id"], body["user"]["id"])

    def test_last_login_is_recorded(self):
        self.login()
        self.assertIsNotNone(WechatAccount.objects.get().last_login_at)


class WechatCredentialTests(SimpleTestCase):
    """换码前的凭证检查，不依赖数据库。"""

    @override_settings(WECHAT_APPID="", WECHAT_APPSECRET="")
    def test_missing_credentials_raise_before_any_request(self):
        from core.wechat import WechatNotConfigured, exchange_code

        with self.assertRaises(WechatNotConfigured):
            exchange_code("any-code")


class ResponseEnvelopeTests(APITestCase):
    """统一响应包契约（规格 v2.0 §14）。

    这是客户端与后端之间最容易悄悄漂移的一层，所以单独断言形状而不是只断言业务值。
    """

    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user(username="envelope-a", password="pw-for-tests")
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.create(user=self.user).key}")

    def test_success_response_is_wrapped_in_data(self):
        body = self.client.get(reverse("me")).json()
        self.assertEqual(set(body.keys()), {"data"})
        self.assertEqual(body["data"]["username"], "envelope-a")

    def test_request_id_is_returned_and_matches_error_body(self):
        response = self.client.get("/api/v1/braces/999999/")
        self.assertEqual(response.status_code, 404)
        request_id = response["X-Request-ID"]
        self.assertTrue(request_id)
        self.assertEqual(failure(response)["request_id"], request_id)

    def test_client_supplied_request_id_is_echoed(self):
        response = self.client.get(reverse("me"), HTTP_X_REQUEST_ID="trace-abc-123")
        self.assertEqual(response["X-Request-ID"], "trace-abc-123")

    def test_unauthenticated_error_uses_declared_code(self):
        anonymous = APIClient()
        response = anonymous.get(reverse("me"))
        self.assertEqual(response.status_code, 401)
        self.assertEqual(failure(response)["code"], "AUTH_REQUIRED")

    def test_missing_resource_uses_declared_code(self):
        response = self.client.get("/api/v1/braces/999999/")
        self.assertEqual(failure(response)["code"], "NOT_FOUND")

    def test_logout_returns_no_body(self):
        response = self.client.post(reverse("logout"))
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.content, b"")

    def test_infrastructure_endpoints_are_not_enveloped(self):
        # 探活端点被监控与部署脚本直接消费，包一层会让它们全部失效。
        anonymous = APIClient()
        health = anonymous.get(reverse("health")).json()
        self.assertIn("status", health)
        self.assertNotIn("data", health)
