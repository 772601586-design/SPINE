"""统一响应包（规格 v2.0 §14）。

成功：`{"data": ..., "meta": ...?}`
失败：`{"error": {"code", "message", "field_errors"?, "request_id"}}`

实现方式是**全局渲染器 + 全局异常处理**，各 viewset 保持返回普通 Python
对象，不必逐个改写成信封形状——这样契约只有一处真相。

渲染器同时兜住「视图直接 return Response(payload, status=4xx)」的情况：
这类响应不经过异常处理器，若只按成功路径包装就会变成 `{"data": {"detail": ...}}`，
把失败伪装成成功。这里按状态码统一转成错误信封。

基础设施端点（健康/就绪/OpenAPI/文档）刻意豁免：它们是探活与工具链契约，
外面再包一层会让监控和 schema 校验失效。
"""

from rest_framework.renderers import JSONRenderer

from core.errors import code_for_status

EXEMPT_PREFIXES = ("/api/v1/health/", "/api/v1/ready/", "/api/schema/", "/api/docs/")

# 已经是信封形状的响应不再二次包装。
_ENVELOPE_KEYSETS = ({"data"}, {"data", "meta"}, {"error"})


class EnvelopeJSONRenderer(JSONRenderer):
    def render(self, data, accepted_media_type=None, renderer_context=None):
        context = renderer_context or {}
        response = context.get("response")
        status_code = getattr(response, "status_code", None)

        # 204/304 不能带实体。
        if status_code in (204, 304):
            return b""

        request = context.get("request")
        path = getattr(request, "path", "") or ""
        if path.startswith(EXEMPT_PREFIXES):
            return super().render(data, accepted_media_type, renderer_context)

        payload = self._error_envelope(data, status_code, request) if (status_code or 0) >= 400 else self._envelope(data)
        return super().render(payload, accepted_media_type, renderer_context)

    @staticmethod
    def _envelope(data):
        if isinstance(data, dict):
            if set(data.keys()) in _ENVELOPE_KEYSETS:
                return data
            # DRF 分页结果 -> 数据放 data，分页信息放 meta。
            if {"results", "count"} <= set(data.keys()):
                meta = {key: value for key, value in data.items() if key != "results"}
                return {"data": data["results"], "meta": meta}
        return {"data": data}

    @staticmethod
    def _error_envelope(data, status_code, request):
        if isinstance(data, dict) and set(data.keys()) == {"error"}:
            return data
        message = "请求无法完成。"
        if isinstance(data, dict):
            for key in ("detail", "message"):
                value = data.get(key)
                if isinstance(value, str) and value:
                    message = value
                    break
            else:
                for value in data.values():
                    if isinstance(value, (list, tuple)) and value and isinstance(value[0], str):
                        message = value[0]
                        break
        elif isinstance(data, (list, tuple)) and data and isinstance(data[0], str):
            message = data[0]
        payload = {"code": code_for_status(status_code), "message": message}
        request_id = getattr(request, "request_id", None)
        if request_id:
            payload["request_id"] = request_id
        return {"error": payload}
