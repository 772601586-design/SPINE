# SPINE 项目长期记忆

## 本机环境约束（Windows / LAPTOP-B4DPTCLV）

- **agent 无法启动 GUI 程序**。Electron 类应用（微信开发者工具）在沙箱内启动会因 GPU 子进程崩溃而退出（`0xC0000005` → `FATAL: GPU process isn't usable`），`--disable-gpu` 无效。需要图形界面的步骤必须交由用户在桌面手动完成。
- **子进程会继承 `ELECTRON_RUN_AS_NODE=1` 与 `NODE_OPTIONS=--require=...node-language-shim.cjs`**，导致 Electron 主程序退化为纯 Node 模式（无窗口）。从 agent 启动 Electron 需先 `env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS -u NODE_EXTRA_CA_CERTS`。
- 需管理员权限的安装包（NSIS `requireAdministrator`）无法从 agent 执行，报 `Permission denied`（exit 126）；`Start-Process -Verb RunAs` 与 `cmd start` 都无法触发 UAC。
- `PowerShell` 工具在本机不可用（`sandbox-center cmd decisionRecord missing actual resource subject`，stdout 常为空）；`reg.exe` 被程序黑名单拦截。系统查询优先用 Bash；读中文路径用 Python（bash 有编码问题）；`tasklist` 输出需 `iconv -f GBK -t UTF-8`。

## 磁盘与路径约定

- C 盘紧张（300G 已用 96%）。新工具默认装到 **D 盘**（D 盘剩 210G）。微信开发者工具装在 `D:\app\wechat_devtools`。
- 项目内工具与本地数据放 `D:\SPINE\.tools`（已有 `postgresql`、`postgresql-data`、`downloads`）。
- 项目脚本放 `D:\SPINE\scripts`。

## 微信小程序

- **当前规格：`ai_path/规格v2差异表.md`（源自用户 Downloads 的 v2.0 Prompt）取代 `SPINE_PRD_v1.md`。** v2.0 = 产品重定义：3 Tab（康复/社区/个人）、档案入个人、康复=动作与运动+支具佩戴、**删除今日首页与每日打卡**、不实现康复师/聊天/工作台。
- v2.0 API 契约（§14）：成功 `{data,meta?}`、失败 `{error:{code,message,field_errors?,request_id}}`。已由全局 `core.renderers.EnvelopeJSONRenderer` + `core.exceptions.spine_exception_handler` 实现，**各 viewset 不用改**。探活/就绪/OpenAPI/文档端点豁免。
- 使用 `raise SpineError(msg, ErrorCode.X, status)` 抛业务错误；错误码清单在 `backend/core/errors.py`。
- 工程在 `D:\SPINE\miniprogram`，原生 TypeScript/WXML/WXSS，17 个页面，3 个 tab（**康复/社区/个人**）。`pages/today` 与 `pages/service` 已按 §1.12/§19.6 删除。
- **入口分流**：`pages/login` 登录后按 `GET /api/v1/me/` 的 `has_profile` 决定进 `/pages/onboarding/profile`（建档）还是 `switchTab` 到 `/pages/rehab/index`。Tab 页一律用 `requireOnboarded()` 而不是 `requireSession()`，未建档会被送回建档页。
- `api.me()` 打的是 **`/api/v1/me/`**（`MeIdentityView`，含 `has_profile`），不是旧的 `/api/v1/auth/me/`（只返回 `{id,username}`）。
- AppID：`wxec55146112612082`（小程序「自脊SPINE」）。已写入 `project.config.json` 与 `miniprogram/project.config.json`。
- **项目根 `D:\SPINE` 也可以直接用开发者工具打开**：根 `project.config.json` 设了 `"miniprogramRoot": "miniprogram/"`。
- **域名校验必须关**：`project.private.config.json`（IDE 生成、优先级高于 project.config.json）里 `urlCheck` 必须为 `false`，否则 `http://127.0.0.1:8000` 被拦、表现为「网络暂时不可用」。
- TS 编译开关用官方写法 `"useCompilerPlugins": ["typescript"]`（不是 `compileTypeScript`）。
- 开发 API 地址在 `miniprogram/config/environment.ts`，当前 `developerTool` 指向 `http://127.0.0.1:8000`。
- **登录已是微信登录**：`wx.login` 取 code → `POST /api/v1/auth/wechat/` → 服务端换 openid 建号并签发 DRF Token。AppSecret 只在 `backend/.env`。
- 开发者工具 CLI 入口：`D:\app\wechat_devtools\cli.bat`。
- **CLI / 自动化前提**：IDE「设置 → 安全设置 → 服务端口」必须开启（`echo y |` 管道无法自动开启）。开启后 `cli.bat islogin/open/preview` 可用；但 **`cli auto` 从 agent 侧会挂起**（需新开 Electron 窗口，受沙箱 GPU 阻断），因此 `D:\SPINE\scripts\verify-wechat-login.js`（真实 `wx.login` 端到端 + 截图）只能在**用户桌面终端**运行。依赖 `miniprogram-automator` 装在 `C:\Users\58724\.workbuddy\binaries\node\workspace\node_modules`。
- 判断微信凭证是否有效：调 `jscode2session` 用假 code，返回 `40029` = 密钥正确，`40125` = 密钥错，`40013` = AppID 错。
- 开发期账号密码登录（`spine_a`/`spine_b` + `backend/.env` 的 `SPINE_DEV_PASSWORD`）仍保留，供后端测试与联调脚本使用，界面已不再暴露入口。

## 小程序前端约定（写新页面前必读）

- **`this.data` 必须保持有类型**：`typings/wechat-mini.d.ts` 里 `Page` 声明为
  `declare function Page<T>(options: { data: T; [key: string]: unknown } & ThisType<MiniPageContext<T>>): void;`
  且 `tsconfig.json` 的 `noImplicitThis` 必须是 `true`。**缺任一项，页面自定义方法的 `this` 会退化成 `any`，`this.data` 与 `setData({...})` 的字段名全部失去检查**（历史上就是这样，很多误用查不出来）。
- 类型检查（本机没有 miniprogram 本地 `node_modules`）：
  `cd D:/SPINE/miniprogram && C:/Users/58724/.workbuddy/binaries/node/versions/22.22.2-6/node.exe C:/Users/58724/.workbuddy/binaries/node/workspace/node_modules/typescript/lib/tsc.js --noEmit`（typescript@5.6.3 在隔离工作区里）。
- 页面状态一律四态齐备：加载中 / 空 / 错误（可点击重试）/ 无权限。`onShow` 拉数据、`onPullDownRefresh` 传 `true`。
- **未落地的功能如实标注「尚未开放」**（`available:false` 入口 + `wx.showToast`），不做点进去一片空白的假入口，也不预置假数据。
- 私有附件上传统一走 `services/upload.ts` 的 `uploadPrivateFile(purpose, file)`：三步 = `POST /attachments/upload-intent/` → `wx.uploadFile` 到带签名的 `upload_url`（**不带 Token 头**）→ `POST /attachments/{id}/complete/`。类型靠扩展名推断，服务端落盘后按魔数复核。
- 展示附件用 `GET /attachments/{id}/access/` **每次重新换签名地址**（TTL 300s，列表里那份会过期）。图片 `wx.previewImage`，PDF 复制受保护链接。
- 日期与"今天"统一按 +08:00：`config/profile-options.ts` 的 `currentMonth()/todayDate()`，别用设备本地时区。
- 字典与后端 choices 对齐，集中在 `config/profile-options.ts`（诊断状态、管理方式）。

## 后端结构与约定

- 阶段一（结构/身份/档案）已全部完成：统一契约层、私有附件（三段上传+签名 URL+魔数复核）、身份档案、就诊时间线、3 Tab 改造、内容后台隐私边界、上传卫生（pending 配额 + `cleanup_attachments` 清理命令）。
- 阶段二已开始：`exercises` app（动作库：Region/Muscle/Goal 字典 + Exercise 版本化模型），`exercise-taxonomy`/`exercises` 接口 `AllowAny`（公开浏览），种子迁移 `exercises.0002_seed_taxonomy`（regions 8 / muscles 14 / goals 7）。
- admin 隐私守卫在 `CoreConfig.ready()` 执行（不能放 admin.py 导入期，autodiscover 顺序会绕过）；私域模型与 Token 一律不进后台。
- 后端测试全绿：`./.venv/Scripts/python.exe manage.py test core braces profiles medical exercises --noinput --keepdb`。
- 小程序类型检查：`node <managed>/node_modules/typescript/lib/tsc.js --noEmit`（在 miniprogram 目录，需 0 error）。

## 本机服务启动（agent 必读）

- **postgres 必须常驻启动**：`D:/SPINE/.tools/postgresql/pgsql/bin/postgres.exe -D D:/SPINE/.tools/postgresql-data` 挂 run_in_background。**不能用 `pg_ctl start`**——守护化后脱离父进程会被沙箱清理。启动后需 fsync 恢复（约 30-100 秒才接受连接）。
- **postgres 被非正常终止后 `DROP DATABASE` 会报 `could not signal for checkpoint: Operation not permitted`**，且 `--keepdb` 撞上残留无效测试库直接失败。修法：`taskkill //F //IM postgres.exe` → 常驻重启 → DROP 恢复正常。
- **改完后端代码必须重启 API 进程**（`--noreload` 不热加载）：前端会出现「服务暂时无法完成请求」或 404，而代码其实是对的。两次事故（profile/complete、exercise-taxonomy）都是这个原因。
- API：`cd D:/SPINE/backend && ./.venv/Scripts/python.exe manage.py run_api 127.0.0.1:8000 --noreload`（run_in_background）。

- Django app：`core`（基础设施 + 身份）、`braces`（支具，旧二态模型待 §9 改造）、`profiles`（档案/身体测量）、`medical`（就诊/影像附件/多弯）。后续按域再加 `rehab`/`sports`/`community`/`personal`。
- **UUID 主键用于新模型**（`Attachment`、`IdempotencyKey`、`Profile`、`BodyMeasurement`），`braces` 沿用自增整数不动。UUID 不是权限机制：**查询一律先按 owner 过滤再取 id**。
- **私有附件基座**在 `core/storage.py` + `core/attachment_views.py`：`upload-intent` → 带签名地址上传字节 → `complete` 三段式；`purpose` 是受控值（`medical/private_record/community/exercise/article/avatar`），决定 MIME 与体积上限。
  - 存储根 `backend/.private-storage`（已 gitignore），**不经任何公开静态路由**；读取靠 `django.core.signing` 短期签名（salt `spine.attachment.access`，TTL 默认 300s）。生产切 S3/OSS 改 `STORAGE_BACKEND` + 实现同名接口。
  - `content` 端点不用 Token 认证（`<image src>` 带不了头），凭据是 URL 签名，令牌绑定 attachment_id **与** owner。
  - `medical`/`private_record` 永不对外开放；`avatar/community/exercise/article` 允许其他登录用户读取。
  - 落盘后按魔数复核类型，不符即删文件并报 `UNSUPPORTED_FILE_TYPE`；`.dcm` 给专门提示。
- 幂等与并发：`core/idempotency.py` — `Idempotency-Key`（表里**不存响应体**，只存 object_id + 状态码）用于重试去重；`expected_revision` 用于防覆盖，冲突返回 `REVISION_CONFLICT`。
- 分页 `core/pagination.py` 的 `StandardPagination`（limit/offset，默认 20 上限 100）。**只给新 viewset 用**：`braces` 列表测试断言 `response.data[0]`，全局开启会打碎。
- 环境变量读取用 `required()/csv_env()/int_env()`：`.env.example` 是空占位，空字符串必须落回默认值（`Path("")` 会指向 CWD）。
- 跑测试：`./.venv/Scripts/python.exe manage.py test core braces profiles medical --noinput --keepdb`（当前 111 项）。

## 医疗资料（§4）

- `Visit` 日期精度三态（`day`/`month`/`unknown`）由库层 `CheckConstraint(visit_date_precision_exclusive)` 保证互斥；**绝不用 1 月 1 日冒充未知日期**。客户端可省略 `date_precision` 由字段推导，传入则必须自洽。
- `Visit.Meta.ordering` 必须保留 `F("visit_date").desc(nulls_last=True)`：PostgreSQL DESC 默认 NULLS FIRST，否则"日期不详"会排成"最近一次就诊"。
- `MedicalAttachment`：`attachment` 用 `OneToOneField` + 唯一约束 → 一张附件只能属于一次就诊；绑定校验 `purpose=="medical"` + `owner` 本人 + `status=="ready"`；`select_for_update` 锁就诊行保证 `VISIT_MAX_ATTACHMENTS` 不被并发绕过。
- 解绑只删绑定行，不删原件（原件仍是本人私有对象）。
- `CurveMeasurement` 允许全字段留空（region 有 `unknown`）；`source_attachment` 必须属于同一次就诊；`entry_source` 恒为 `manual`（**不做 OCR、不从影像推导角度**）。
- **DRF `@action` 同一 `url_path` 只能注册一个**：多方法必须合并进同一方法内按 `request.method` 分支，否则第二个方法永远 405。
