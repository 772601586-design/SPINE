# 小树（SPINE）

小树是产品展示名称，SPINE 是工程代号。个人用户端使用原生微信小程序，配套 Django REST Framework/PostgreSQL 后端；现有 React 专业工作台与审核后台按原职责保留。`flutterapp` 保留作迁移参考。

当前根项目默认运行 **`miniprogram-demo/`**，按用户指定的 `spine1/demo/miniprogram` 原样复现：18 页、5 个原生底部标签，无需启动后端。微信开发者工具重新打开 `D:/SPINE` 后编译即可。详见 [原始小程序 demo 复现](./ai_path/原始小程序demo复现.md)。

| 目录 | 用途 |
|---|---|
| `miniprogram-demo` | 当前默认启动的原始 demo 副本；运行文件与 `spine1/demo/miniprogram` 逐字节对齐 |
| `miniprogram` | 原生 TypeScript/WXML/WXSS 个人端；按 spine1 demo 改造为今日、训练、成长、社群、我的五入口 |
| `miniprogram/prototype` | 完整 18 页 demo 体验分包；登录页或「我的」进入，示例数据与真实记录分开 |
| `flutterapp` | 迁移前 Flutter 参考工程，暂不扩展 |
| `frontend` | `/professional` 专业工作台、`/review` 审核后台 |
| `backend` | Token 认证、支具与感受 API、PostgreSQL、健康接口、OpenAPI |
| `ai_path` | 技术决策、启动步骤、验证记录、下一阶段任务 |

当前生效的产品基线为根目录 [小树产品开发规格](./小树产品开发规格.md)，逐项状态见 [需求完成矩阵](./ai_path/需求完成矩阵.md)。启动与逐步验收见 [微信小程序启动与验收](./ai_path/微信小程序启动与验收.md)，实际验证见 [验证记录](./ai_path/验证记录.md)。`SPINE_PRD_v1.md` 和旧 Flutter 说明仅作历史参考，不覆盖当前规格。
