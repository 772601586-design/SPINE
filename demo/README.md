# Spine · 设计 demo

交互原型 v3 的三种形态，都使用示例数据（示例人物「小禾」），没有接后端。设计资料和思维导图在 [`../design`](../design)。

团队正式开发的小程序在仓库根目录的 `miniprogram/`，和这里的 demo 互不影响。

| 位置 | 是什么 | 怎么看 |
|---|---|---|
| `miniprogram/` | 微信小程序 demo，18 个页面 | 微信开发者工具 →「导入项目」→ 选这个文件夹，AppID 用测试号 |
| `web/spine-prototype.html` | 单文件网页原型，带演示面板（换阶段、跳页面、看后台排卡） | 浏览器直接打开 |
| `canvas/` | Claude 设计画布导出的源文件（v1、v2 画板和 v3 交互原型） | 需要设计画布才能打开；小程序 demo 由其中的 `Prototype.dc.html` 生成 |

三者的业务逻辑是同一份：状态、打卡、隔天排卡、先录后配、松果与勋章。改规则时，小程序改 `miniprogram/core/`，网页原型改 `web/spine-prototype.html` 里的同名代码。
