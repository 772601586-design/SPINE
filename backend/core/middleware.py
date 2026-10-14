"""request_id 中间件（规格 v2.0 §14）。

每个请求分配可追踪的 request_id，写入 `request.request_id` 并回写响应头
`X-Request-ID`。失败响应体里的 `error.request_id` 取同一个值，便于把用户报错
和服务器日志对上，而不用把内部堆栈暴露给客户端。
"""

import uuid

HEADER = "X-Request-ID"
META_KEY = "HTTP_X_REQUEST_ID"


class RequestIDMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        inbound = (request.META.get(META_KEY) or "").strip()
        # 只接受有限长度的可打印字符，避免把任意输入回写进日志或响应头。
        if inbound and len(inbound) <= 64 and inbound.isprintable():
            request.request_id = inbound
        else:
            request.request_id = uuid.uuid4().hex
        response = self.get_response(request)
        response[HEADER] = request.request_id
        return response
