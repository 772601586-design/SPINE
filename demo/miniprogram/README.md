# Spine 小程序设计 demo

> 这是**设计 demo**，用来在手机上体验交互原型 v3，用的是示例数据，没有接后端。团队正式开发的小程序在仓库根目录的 `miniprogram/`（TypeScript + Django 后端），两者互不影响。

脊柱侧弯保守治疗陪伴应用的小程序 demo，由交互原型 v3 转换而来。首版包含原型的全部 18 个页面，数据是示例数据（示例人物「小禾」），上线前按需要删减。

## 打开方式

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 选「导入项目」，目录选 `demo/miniprogram` 这个文件夹。
3. AppID 先用「测试号」，`project.config.json` 里是 `touristappid`；有了正式 AppID 再替换。
4. 编译后从「欢迎」页开始。已经建过档会直接进「今日」；在「我的」页底部可以重置示例数据。

## 页面

| 分组 | 页面 | 路径 |
|---|---|---|
| 首次使用 | 欢迎（年龄、性别）→ 选择治疗阶段 → 基本信息 → 准备好了 | `welcome` `stage` `basics` `ready` |
| 底部 tab | 今日 / 训练 / 成长 / 社群 / 我的 | `today` `train` `growth` `community` `me` |
| 每天 | 跟练、完成打卡、动作卡片 | `follow` `done` `card` |
| 处方 | 现场录动作 → 导入处方 → 配上录像 | `record` `import` `match` |
| 其他 | 我的支具、添加复查记录、松果与勋章 | `brace` `upload` `rewards` |

## 代码结构

```
miniprogram/
├── app.json / app.js / app.wxss   页面列表、底部 tab、全局样式
├── core/
│   ├── spine-app.js   业务逻辑（和网页原型同一份）：状态、动作卡片、打卡、奖励、页面跳转
│   ├── scheduler.js   排卡规则：模块顺序 + 隔天规则（纯函数）
│   ├── store.js       全局唯一的状态；把“去哪一页”翻译成小程序导航；状态存本机
│   ├── bridge.js      页面桥接：视图数据里的函数换成编号，WXML 里 bindtap="act" 触发
│   └── u.wxs          图标颜色转义
├── pages/<页面>/       每页 index.wxml / index.js / index.json（由 tools/build.py 生成）
├── assets/tab/        底部 tab 图标
└── tools/             不会打包进小程序
    ├── build.py       从设计画布的 Prototype.dc.html 重新生成 pages/ 和 core/spine-app.js
    ├── logic_header.js
    └── check.js       模拟运行：脚本流程 + 随机点击，检查绑定和跳转
```

导航规则（`core/store.js`）：
- 去底部 tab 页用 `wx.switchTab`。
- 目标页已在页面栈里，就 `navigateBack` 回去。
- 其他情况 `navigateTo`；页面栈满了改用 `redirectTo`。
- 原型里页面自带的「返回 / 退出」按钮去掉了，统一用小程序自带的返回。

## 修改与检查

- **改界面**：可以直接改 `pages/*/index.wxml`。也可以在设计画布里改原型后重新生成，但重新生成会覆盖 `pages/` 里的手动修改：
  ```
  python3 tools/build.py ../canvas/Prototype.dc.html .
  ```
- **改规则**：排卡改 `core/scheduler.js`；其他业务改 `core/spine-app.js`。重新生成也会覆盖这个文件，改动多了以后就不要再生成了。
- **检查**：`node tools/check.js .` 应输出 `PROBLEMS 0`。

## 上线前要处理

- [ ] 换成正式 AppID；补隐私协议，并完成用户隐私保护指引的配置（会用到相机、相册、本地存储）。
- [ ] 录像、拍照目前是示意，要接 `wx.chooseMedia` 和本地文件存储（视频只存本机）。
- [ ] 处方和复查报告识别目前用示例结果，要接 OCR 服务，并保留手动修改。
- [ ] 支具传感器、跟练的语音播报还是示意。
- [ ] 图标用的是 SVG data URI，需要在真机上确认显示正常（iOS 和安卓都看）。
- [ ] 社群涉及未成年人和用户发布内容，需要内容安全审核；小程序类目和资质要提前确认（医疗健康类目可能需要资质）。
- [ ] ⚠ 训练模块的分类与顺序（柔韧 → 3D 矫正 → 核心 → 颈椎 → 拉伸放松）待医生确认，改 `core/scheduler.js` 里的 `MODULE_ORDER` 和 `ALT_MODULES`。
