# demo · 交互原型源文件

这些文件来自 Claude 设计画布，按画布里的三页整理：

| 画布页 | 文件 | 说明 |
|---|---|---|
| 交互原型 v3 | `Prototype.dc.html` | 完整交互原型：从首次使用到每天打卡、先录后配处方、复查记录、社群学习、松果与勋章，全部可点击 |
| 完整产品 Demo（v2） | `Welcome` `Stage` `Basics` `Ready` `Home` `Follow` `CardDetail` `Done` `Plan` `Import` `Recording` `Brace` `Growth` `Upload` `Rewards` `Community` `Me` | 按模块拆开的静态画板 |
| 第一版 · 打卡探索（v1） | `Main` `Session` `Mirror` `Card` `Profile` | 最早的打卡与跟练探索（镜子模式后来被否决） |

`canvas.json` 是画布的索引：每个画板的位置、尺寸、所属页面。

## 怎么看

`.dc.html` 需要设计画布的运行时，**直接双击用浏览器打开会显示不全**。要体验交互，请打开 Claude 里的「Spine 跟练卡片 Demo」设计画布，切到「交互原型 v3」页。

## 和画布原件的差别

`Profile.dc.html` 里的人物姓氏和处方中心名称已改成「小禾」「某脊柱侧弯康复中心」，避免在仓库中出现可识别的真实患者信息。
