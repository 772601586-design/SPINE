"""统一错误码与业务异常（规格 v2.0 §14）。

错误码是**对外契约**：客户端按 code 分支，不再解析自然语言文案。
新增错误码时同步更新本清单与 `docs` 说明；不要复用语义不同的旧码。
"""

from rest_framework import status as http_status
from rest_framework.exceptions import APIException


class ErrorCode:
    # 通用
    AUTH_REQUIRED = "AUTH_REQUIRED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    THROTTLED = "THROTTLED"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    # 计划与课次（规格 §6、§7）
    PLAN_PAUSED = "PLAN_PAUSED"
    OUTSIDE_WINDOW = "OUTSIDE_WINDOW"
    ACTIVE_ATTEMPT_EXISTS = "ACTIVE_ATTEMPT_EXISTS"
    DAILY_LIMIT_REACHED = "DAILY_LIMIT_REACHED"
    REVISION_CONFLICT = "REVISION_CONFLICT"
    IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT"
    # 支具与记录（规格 §9）
    INTERVAL_OVERLAP = "INTERVAL_OVERLAP"
    RECORD_NEEDS_REVIEW = "RECORD_NEEDS_REVIEW"
    # 附件（规格 §15）
    UNSUPPORTED_FILE_TYPE = "UNSUPPORTED_FILE_TYPE"
    UPLOAD_TOO_LARGE = "UPLOAD_TOO_LARGE"
    PROFILE_INCOMPLETE = "PROFILE_INCOMPLETE"
    # 规格 §14 清单之外：依赖已声明但未配置（如微信凭证缺失）。
    # 单独设码是为了让它和真正的服务端故障在日志与客户端分支上可区分。
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"


# HTTP 状态 -> 错误码。渲染器与异常处理器共用，避免两处映射漂移。
STATUS_TO_CODE = {
    400: ErrorCode.VALIDATION_ERROR,
    401: ErrorCode.AUTH_REQUIRED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    405: ErrorCode.VALIDATION_ERROR,
    409: ErrorCode.VALIDATION_ERROR,
    415: ErrorCode.UNSUPPORTED_FILE_TYPE,
    429: ErrorCode.THROTTLED,
}


def code_for_status(status_code):
    if status_code in STATUS_TO_CODE:
        return STATUS_TO_CODE[status_code]
    if status_code >= 500:
        return ErrorCode.INTERNAL_ERROR
    return ErrorCode.VALIDATION_ERROR


class SpineError(APIException):
    """业务异常：对外只暴露 code + 可读 message，不泄露内部细节。

    用法：
        raise SpineError("该课次已不在执行窗口内。", ErrorCode.OUTSIDE_WINDOW, 409)
    """

    default_code = ErrorCode.VALIDATION_ERROR
    status_code = http_status.HTTP_400_BAD_REQUEST

    def __init__(self, message, code=None, status_code=None, field_errors=None):
        super().__init__(message)
        self.spine_code = code or self.default_code
        if status_code is not None:
            self.status_code = status_code
        self.field_errors = field_errors or None
