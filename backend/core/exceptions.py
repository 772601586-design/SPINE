"""统一异常处理（规格 v2.0 §14）。

把 DRF 的各种异常收敛成 `{"error": {"code", "message", "field_errors"?, "request_id"}}`，
保证客户端只需要处理一种失败形状。

原则：
- 5xx 不回显异常内容与堆栈，只给 INTERNAL_ERROR + request_id 供对账。
- 校验失败给出 field_errors，方便表单逐字段标红。
- 未捕获异常返回 None，交给 Django 默认处理（DEBUG 下仍是调试页）。
"""

import logging

from rest_framework import exceptions
from rest_framework.views import exception_handler as drf_exception_handler

from core.errors import ErrorCode, SpineError, code_for_status

logger = logging.getLogger(__name__)


def _is_leaf(value):
    if isinstance(value, dict):
        return False
    if isinstance(value, (list, tuple)):
        return all(not isinstance(item, (dict, list, tuple)) for item in value)
    return True


def _messages(value):
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return [str(value)]


def _field_errors(detail, prefix=""):
    """把 DRF 的嵌套 detail 压成 {字段路径: [消息]}。"""
    if isinstance(detail, dict):
        out = {}
        for key, value in detail.items():
            path = f"{prefix}{key}"
            if _is_leaf(value):
                out[path] = _messages(value)
            else:
                out.update(_field_errors(value, prefix=f"{path}."))
        return out
    if isinstance(detail, (list, tuple)):
        out = {}
        for index, value in enumerate(detail):
            path = f"{prefix}{index}"
            if _is_leaf(value):
                out[path] = _messages(value)
            else:
                out.update(_field_errors(value, prefix=f"{path}."))
        return out
    return {prefix.rstrip("."): [str(detail)]}


def _request_id(context):
    request = context.get("request")
    for candidate in (request, getattr(request, "_request", None)):
        value = getattr(candidate, "request_id", None)
        if value:
            return value
    return None


def spine_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        # 未捕获异常：交给 Django，DEBUG 下保持调试页可用。
        return None

    field_errors = None
    if isinstance(exc, SpineError):
        code = exc.spine_code
        message = str(exc.detail)
        field_errors = exc.field_errors
    elif isinstance(exc, exceptions.ValidationError):
        code = ErrorCode.VALIDATION_ERROR
        message = "请求参数有误。"
        if isinstance(exc.detail, dict):
            field_errors = _field_errors(exc.detail)
        else:
            field_errors = {"non_field_errors": _messages(exc.detail)}
    elif response.status_code >= 500:
        code = ErrorCode.INTERNAL_ERROR
        message = "服务暂时不可用，请稍后重试。"
        logger.exception("unhandled API error: %s", type(exc).__name__)
    else:
        code = code_for_status(response.status_code)
        # Django 的 Http404 等异常没有 `.detail`，需要兜底文案。
        detail = getattr(exc, "detail", None)
        message = _flat_message(detail) if detail is not None else _fallback_message(response.status_code)

    payload = {"code": code, "message": message}
    if field_errors:
        payload["field_errors"] = field_errors
    request_id = _request_id(context)
    if request_id:
        payload["request_id"] = request_id

    response.data = {"error": payload}
    response["X-Request-ID"] = request_id or ""
    return response


def _flat_message(detail):
    if isinstance(detail, (dict, list, tuple)):
        flattened = _field_errors(detail)
        if flattened:
            return next(iter(flattened.values()))[0]
        return "请求无法完成。"
    return str(detail)


_FALLBACK_MESSAGES = {
    401: "需要登录后继续。",
    403: "没有权限执行该操作。",
    404: "请求的资源不存在。",
    429: "请求过于频繁，请稍后重试。",
}


def _fallback_message(status_code):
    return _FALLBACK_MESSAGES.get(status_code, "请求无法完成。")
