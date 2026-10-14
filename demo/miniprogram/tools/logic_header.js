/**
 * Spine 业务逻辑（由 tools/build.py 从交互原型导出，和网页原型完全一致）
 *
 * - state：全部业务状态，字段说明见 README「状态字段」
 * - renderVals()：把 state 换算成页面要显示的值；里面的函数（打卡、跳转等）
 *   由 core/bridge.js 转成 bindtap 事件
 * - go(screen) / setState({ screen })：表示要去哪一页，由 core/store.js 翻译成小程序导航
 *
 * 业务规则（详见 design/设计记录/决策记录.md）：
 *   1. 卡组一天一列：柔韧 → 3D 矫正 → 核心（隔天）→ 颈椎 → 拉伸放松（⚠ 待医生确认）
 *   2. 隔天规则只在后台：今天做了的隔天动作明天不出现、后天回来；没做就顺延
 *   3. 跟练节奏随处方组结构：计时 / 计数 / 呼吸；不做镜子模式
 *   4. 先录后配：现场录动作存草稿 → 处方单到了拍照导入 → 录像配到处方动作
 *   5. 识别结果可手动改（右上角 ⋯）；不做手写识别
 *   6. 复查提醒可选、默认关闭
 *   7. 松果只用来补卡：训练 +3、支具达标 +2、认知小测 +2、复查上传 +5、补卡 −10
 */
const { Scheduler, HISTORY } = require('./scheduler');

class DCLogic {
  constructor(props) {
    this.props = props || {};
    this.state = {};
  }

  setState(patch) {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = Object.assign({}, this.state, p);
    if (this.__host) this.__host.schedule();
  }
}

