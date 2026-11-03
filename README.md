# 小树（SPINE）

Scolio 知识库已接入两端社群和现有 Django／React 工作台。运行、真实 v6 导入结果、审核权限及验收见 [知识库实施与验收](./ai_path/知识库实施与验收.md)。本次导入的 68 篇医学稿件全部保持草稿。

小树是产品展示名称，SPINE 是工程代号。个人用户端使用原生微信小程序，配套 Django REST Framework/PostgreSQL 后端；现有 React 专业工作台与审核后台按原职责保留。`flutterapp` 保留作迁移参考。

当前根项目默认运行 **`miniprogram-demo/`**，底部入口为「制定、训练、社群、我的」。已接通本机草稿、方案识别生成动作卡、视频名称对应、明确频次自动排程、实际训练记录与成长回顾。基本页面无需启动后端；文件自动识别需运行 `node scripts/serve-demo.cjs`。微信开发者工具重新打开 `D:/SPINE` 后编译即可。详见 [训练页面设计落地](./ai_path/训练页面设计落地.md) 和 [方案自动识别与日程](./ai_path/方案自动识别与日程.md)。

浏览器中查看和修改当前 demo：在根目录运行 `node scripts/serve-demo.cjs`，打开 [本地预览](http://127.0.0.1:4180/)。预览直接读取小程序页面源文件，保存修改后自动刷新；支持页面跳转、表单和本地训练记录。详见 [Demo 浏览器预览](./ai_path/demo浏览器预览.md)。

| 目录 | 用途 |
|---|---|
| `miniprogram-demo` | 当前默认小程序；按 `output/design` 实现合并训练首页及六步训练流程 |
| `miniprogram` | 原生 TypeScript/WXML/WXSS 个人端；按 spine1 demo 改造为今日、训练、成长、社群、我的五入口 |
| `miniprogram/prototype` | 完整 18 页 demo 体验分包；登录页或「我的」进入，示例数据与真实记录分开 |
| `flutterapp` | 迁移前 Flutter 参考工程，暂不扩展 |
| `frontend` | `/professional` 专业工作台、`/review` 审核后台 |
| `backend` | Token 认证、支具与感受 API、PostgreSQL、健康接口、OpenAPI |
| `ai_path` | 技术决策、启动步骤、验证记录、下一阶段任务 |

当前生效的产品基线为根目录 [小树产品开发规格](./小树产品开发规格.md)，逐项状态见 [需求完成矩阵](./ai_path/需求完成矩阵.md)。启动与逐步验收见 [微信小程序启动与验收](./ai_path/微信小程序启动与验收.md)，实际验证见 [验证记录](./ai_path/验证记录.md)。`SPINE_PRD_v1.md` 和旧 Flutter 说明仅作历史参考，不覆盖当前规格。
