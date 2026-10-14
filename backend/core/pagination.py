"""列表分页（规格 v2.0 §14：默认 20、上限 100）。

选 limit/offset 而不是游标：个人侧的记录列表（身体测量、心情、游泳）体量小、
需要"跳到第几页/共多少条"的确定性，且响应里的 `count` 能直接落进统一信封的
`meta`。社区信息流需要游标语义时另建分页类，不在这里混用两套规则。
"""

from rest_framework.pagination import LimitOffsetPagination


class StandardPagination(LimitOffsetPagination):
    default_limit = 20
    max_limit = 100
    limit_query_param = "limit"
    offset_query_param = "offset"
