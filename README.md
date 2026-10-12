# SPINE

微信原生小程序个人端、React 专业工作台与审核后台、Django REST Framework 共用后端。
PostgreSQL 为唯一业务数据库。个人端已进入小程序首轮迁移；Flutter 保留作迁移参考并暂停新增功能。

| 目录 | 用途 |
|---|---|
| `miniprogram` | 原生 TypeScript/WXML/WXSS 个人端；今日、社区、专业服务、个人四入口 |
| `flutterapp` | 迁移前 Flutter 参考工程，暂不扩展 |
| `frontend` | `/professional` 专业工作台、`/review` 审核后台 |
| `backend` | Token 认证、支具与感受 API、PostgreSQL、健康接口、OpenAPI |
| `ai_path` | 技术决策、启动步骤、验证记录、下一阶段任务 |

首次启动请按 [启动步骤](./ai_path/启动步骤.md) 操作。
当前小程序导入、启动、环境切换与逐步验收见 [微信小程序启动与验收](./ai_path/微信小程序启动与验收.md)。
小程序真实接口和后端验证结果见 [验证记录](./ai_path/验证记录.md)；迁移前 Flutter 业务记录保留在 [个人支具闭环](./ai_path/个人支具闭环.md)。

保留根目录 [产品需求](./SPINE_PRD_v1.md)，后端使用磁盘原名 `backend`。
