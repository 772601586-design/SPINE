"""服务端微信小程序登录。

小程序只会把 `wx.login` 拿到的短期 `code` 发给后端。`code` 在这里用 AppSecret
换取 openid，AppSecret 与 session_key 全程留在服务端，不下发客户端。
"""

import json
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings

JSCODE2SESSION_URL = "https://api.weixin.qq.com/sns/jscode2session"
REQUEST_TIMEOUT_SECONDS = 8


class WechatNotConfigured(Exception):
    """服务端尚未配置 WECHAT_APPID / WECHAT_APPSECRET。"""


class WechatError(Exception):
    """微信拒绝了本次换码请求，或微信服务器不可达。"""

    def __init__(self, message, *, error_code=None):
        super().__init__(message)
        self.error_code = error_code


def _credentials():
    appid = (settings.WECHAT_APPID or "").strip()
    secret = (settings.WECHAT_APPSECRET or "").strip()
    if not appid or not secret:
        raise WechatNotConfigured("服务端尚未配置微信小程序凭证。")
    return appid, secret


def exchange_code(code):
    """用 wx.login 的 code 换取 (openid, unionid)。

    只返回登录必需的身份标识；session_key 有意丢弃，不返回也不保存。
    """
    appid, secret = _credentials()
    query = urllib.parse.urlencode({
        "appid": appid,
        "secret": secret,
        "js_code": code,
        "grant_type": "authorization_code",
    })
    try:
        with urllib.request.urlopen(
            f"{JSCODE2SESSION_URL}?{query}", timeout=REQUEST_TIMEOUT_SECONDS
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
        raise WechatError("无法连接微信服务器，请稍后重试。") from error

    if not isinstance(payload, dict):
        raise WechatError("微信返回了无法解析的结果。")

    openid = payload.get("openid")
    if not openid:
        # 微信在 HTTP 200 下用 errcode/errmsg 表示失败。errmsg 可能包含请求细节，
        # 不回显给客户端，只保留错误码供服务端排查。
        raise WechatError("微信登录失败，请重试。", error_code=payload.get("errcode"))

    return openid, payload.get("unionid") or ""
