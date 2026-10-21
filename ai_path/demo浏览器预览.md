# Demo 浏览器预览

在项目根目录运行：

```powershell
node scripts/serve-demo.cjs
```

浏览器打开 <http://127.0.0.1:4180/>。终端显示 `Demo preview ready` 后即可访问，按 `Ctrl+C` 停止服务。端口被占用时可运行 `node scripts/serve-demo.cjs --port 4181`。

预览读取 `miniprogram-demo/` 中现有小程序页面。修改页面的 `.wxml`、`.wxss`、`.js`、`.json` 或 `app.wxss` 后，约 1.5 秒检测到变化并自动刷新。浏览器预览外壳放在 `miniprogram-demo/preview/`，修改外壳也会更新预览版本。接口与静态资源均禁止缓存。先保存表单内容再修改代码，自动刷新会丢失尚未保存的表单输入。

当前合并首页从 `pages/train/index.wxml` 修改布局，从 `pages/train/index.js` 修改交互，从 `app.wxss` 修改共享样式。侧栏可快速进入其他页面；手机预览支持 375、390、430 像素宽度。窄窗口自动切为全屏手机界面。

浏览器中的记录使用单独的 localStorage 命名空间；导入的图片和视频保存在 IndexedDB，刷新后可继续查看。浏览器选择文件与微信原生录制的交互不同，微信摄像、音频和权限应继续在开发者工具或真机验收。预览目录已加入小程序打包忽略。

本地接口：

| 地址 | 内容 |
| --- | --- |
| `/` | `miniprogram-demo/preview/index.html` |
| `/preview/*` | 浏览器预览外壳文件 |
| `/assets/*` | Demo 小程序素材 |
| `/api/demo` | 配置、全局样式、全部注册页面及 `core/` 下 JavaScript 模块源码 |
| `/api/version` | 当前预览内容的 SHA-256 版本，用于自动刷新检测 |

服务只监听本机回环地址 `127.0.0.1`，无需安装额外依赖。

已在本机浏览器验收：四入口跳转、动作卡确认校验、固定星期计划、实际量部分完成、成长汇总、刷新持久化、图片导入与持久化、中文组合输入，以及跟练刷新时保留已有 DOM。移动端检查覆盖 375/390 宽度；桌面覆盖 1440×1000。截图和检查记录在 `output/demo-preview/`。现有 `node scripts/check-demo.cjs` 业务检查继续通过。
