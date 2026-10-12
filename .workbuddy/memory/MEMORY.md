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

- 工程在 `D:\SPINE\miniprogram`，原生 TypeScript/WXML/WXSS，13 个页面，4 个 tab（今日/社区/专业服务/个人）。
- `project.config.json` 的 `appid` 为空，`urlCheck: false`（仅本地联调用，非发布配置）。
- 开发 API 地址在 `miniprogram/config/environment.ts`，当前 `developerTool` 指向 `http://127.0.0.1:8000`。
- 登录目前是账号密码（`services/session.ts`），`wx.login` 尚未接入。
- 开发者工具 CLI 入口：`D:\app\wechat_devtools\cli.bat`。
