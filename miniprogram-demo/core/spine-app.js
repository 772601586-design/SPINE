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

class SpineApp extends DCLogic {
  constructor(props) {
    super(props);
    const home = (props.startAt ?? '首次使用') === '直接进首页';
    this.state = {
      screen: home ? 'today' : 'welcome', back: 'today', stageReturn: 'basics',
      gender: 'f', stage: 'brace', menarche: 'yes', matReport: true, matRx: true, matNone: false,
      done: [1, 2, 3, 4], standDone: false, swim: 1,
      pine: 36, trainRewarded: false, justRewarded: false, quizRewarded: false, drawRewarded: false, uploadRewarded: false, makeupUsed: false,
      followId: 5, followSingle: false, playing: true,
      cardId: 3, cardTab: 'learn', cardEdit: false,
      pain: 3, remindOn: false, braceOn: true, patted: false,
      commTab: 'talk', quizPick: '',
      drafts: [
        { id: 'd1', name: '肋木吹气', time: '10 月 9 日 15:31', cands: [3, 4, 0], pick: 0 },
        { id: 'd2', name: '', time: '10 月 9 日 15:36', cands: [8, 9, 0], pick: 0 },
        { id: 'd3', name: '侧桥', time: '10 月 9 日 15:44', cands: [7, 6, 0], pick: 0 }
      ],
      videos: [1, 3, 4, 6, 11],
      rxV2: false, rxEdit: false, rxName: 'keep',
      recState: 'ready', recCount: 0, recName: '',
      uploadEdit: false, uploadSaved: false,
      toast: ''
    };
  }

  cards() {
    const v2 = this.state.rxV2;
    return {
      1: { name: '猫—骆驼', mod: '柔韧', amt: '2 分钟', sets: 1, mode: 'timer' },
      2: { name: '右弓箭步 · 拉伸左髂腰肌', mod: '柔韧', amt: '30 秒', sets: 2, mode: 'timer' },
      3: { name: '强化运动 · 肋木', mod: '3D 矫正', amt: '5 分钟', sets: 1, mode: 'breath' },
      4: { name: '肌肉圆柱', mod: '3D 矫正', amt: '5 分钟', sets: 1, mode: 'breath' },
      5: { name: '卷腹仰卧自行车', mod: '核心', amt: '50 次', sets: 2, mode: 'count' },
      6: { name: '平板支撑', mod: '核心', amt: '3 分钟', sets: 1, mode: 'timer' },
      7: { name: '右侧桥', mod: '核心', amt: '3 分钟', sets: 1, mode: 'timer' },
      8: { name: '臀桥', mod: '核心', amt: v2 ? '120 个' : '100 个', sets: 2, mode: 'count' },
      9: { name: 'Y-W-T', mod: '核心', amt: '各 30 个', sets: 3, mode: 'count' },
      10: { name: '颈椎矫正操', mod: '颈椎', amt: '约 5 分钟', sets: 1, mode: 'timer' },
      11: { name: '跪位 / 坐位前伸', mod: '拉伸放松', amt: '各 2 分钟', sets: 1, mode: 'timer' },
      12: { name: '悬吊配合呼吸', mod: '拉伸放松', amt: '3 分钟', sets: 1, mode: 'breath' }
    };
  }
  param(c) { return c.amt + (c.sets > 1 ? ' × ' + c.sets + ' 组' : ''); }
  modeShort(m) { return m === 'count' ? '计数' : (m === 'breath' ? '呼吸' : '计时'); }
  modeLabel(m) {
    if (m === 'count') return '计数播报 · 每 10 次报数，组间休息 30 秒';
    if (m === 'breath') return '呼吸播报 · 吸气 4 拍，吹气 6 拍，配合计时';
    return '计时播报 · 每 30 秒提醒一次，最后 10 秒倒数';
  }
  tips(id) {
    const t = {
      3: ['1. 左臀下垫沙包，降低右髋（右腿下压）', '2. 左手握肋木横杆平腰，右手握肋木平头顶', '3. 收紧左前肋及右后背，使劲吹气'],
      4: ['1. 侧身站在肋木旁，骨盆保持中立', '2. 吸气时向凹侧后方扩张', '3. 呼气时保持矫正姿势，不塌腰'],
      7: ['1. 右侧卧，前臂撑地，身体成一条直线', '2. 骨盆不要往后坐', '3. 自然呼吸，不憋气']
    };
    return t[id] || ['1. 跟着现场录的示范做', '2. 拿不准时先暂停，看一眼关键姿势', '3. 有疼痛就停下，复查时问康复师'];
  }
  deckIds() {
    const s = this.state.stage;
    if (s === 'check') return [];
    if (s === 'new') return [1, 3, 4];
    if (s === 'adult') return [1, 2, 11, 12];
    // 支具期 / 维持期：按处方和隔天规则排出今天的卡组（见 scheduler.js）
    return Scheduler.buildDeck(this.cards(), HISTORY.lastDone, 0);
  }
  left(done) { return this.deckIds().filter((x) => done.indexOf(x) === -1); }
  go(screen, extra) { this.setState(Object.assign({ screen: screen, toast: '' }, extra || {})); }
  open(screen) { this.go(screen, { back: this.state.screen }); }
  finish(done) {
    const st = { done: done, screen: 'done', toast: '', followSingle: false, justRewarded: false };
    if (!this.state.trainRewarded) { st.pine = this.state.pine + 3; st.trainRewarded = true; st.justRewarded = true; }
    this.setState(st);
  }
  check(id) {
    const done = this.state.done.concat([id]);
    if (this.left(done).length === 0) { this.finish(done); return; }
    this.setState({ done: done, toast: '已打卡：' + this.cards()[id].name });
  }
  startFollow() {
    const l = this.left(this.state.done);
    if (l.length === 0) { this.finish(this.state.done); return; }
    this.go('follow', { followId: l[0], followSingle: false, playing: true, back: this.state.screen === 'follow' ? this.state.back : this.state.screen });
  }
  followNext() {
    const id = this.state.followId;
    const done = this.state.done.indexOf(id) === -1 ? this.state.done.concat([id]) : this.state.done;
    const l = this.left(done);
    if (this.state.followSingle) {
      if (l.length === 0 && this.deckIds().indexOf(id) !== -1) { this.finish(done); return; }
      this.setState({ done: done, screen: 'card', followSingle: false, toast: '已打卡：' + this.cards()[id].name });
      return;
    }
    if (l.length === 0) { this.finish(done); return; }
    this.setState({ done: done, followId: l[0], playing: true });
  }
  addDraft(more) {
    const n = this.state.drafts.length + 1;
    const d = { id: 'n' + n, name: this.state.recName, time: '今天 ' + (14 + n) + ':0' + n, cands: [2, 10, 12, 0], pick: 0 };
    const drafts = this.state.drafts.concat([d]);
    const cnt = this.state.recCount + 1;
    if (more) { this.setState({ drafts: drafts, recCount: cnt, recState: 'ready', recName: '' }); return; }
    this.go('train', { drafts: drafts, recCount: 0, recState: 'ready', recName: '', toast: '已保存 ' + cnt + ' 段，处方单到了再一起整理' });
  }
  finishMatch() {
    const picked = this.state.drafts.map((d) => d.cands[d.pick]).filter((x) => x !== 0);
    const rest = this.state.drafts.filter((d) => d.cands[d.pick] === 0);
    const videos = this.state.videos.concat(picked.filter((x) => this.state.videos.indexOf(x) === -1));
    this.go('train', { videos: videos, drafts: rest, toast: '已把 ' + picked.length + ' 段视频配到卡片上' });
  }

  renderVals() {
    const S = this.state;
    const C = this.cards();
    const sel = (on) => ({ aria: on ? 'true' : 'false', border: on ? '2px solid #1F6F66' : '1px solid #C9D4D0', bg: on ? '#DDEDE9' : 'transparent', fg: on ? '#1F4F49' : '#3E4B47', fw: on ? '700' : '400' });
    const tab = (on) => ({ aria: on ? 'true' : 'false', bg: on ? '#FFFFFF' : 'transparent', fg: on ? '#1F2A27' : '#3E4B47', fw: on ? '700' : '400' });
    const scr = S.screen;
    const names = ['welcome', 'stage', 'basics', 'ready', 'today', 'follow', 'done', 'train', 'record', 'import', 'match', 'card', 'growth', 'upload', 'community', 'me', 'brace', 'rewards'];
    const s = {};
    names.forEach((n) => { s[n] = scr === n; });
    const tabs = ['today', 'train', 'growth', 'community', 'me'];
    const navc = {}; const navw = {};
    tabs.forEach((t) => { navc[t] = scr === t ? '#1F6F66' : '#5B6663'; navw[t] = scr === t ? '700' : '400'; });

    const nav = {
      today: () => this.go('today'),
      train: () => this.go('train'),
      growth: () => this.go('growth'),
      community: () => this.go('community'),
      me: () => this.go('me'),
      talk: () => this.go('community', { commTab: 'talk' }),
      learn: () => this.go('community', { commTab: 'learn' }),
      ready: () => this.go('ready'),
      stageFromStart: () => this.go('stage', { stageReturn: 'basics' }),
      stageFromMe: () => this.go('stage', { stageReturn: 'me' }),
      record: () => this.go('record', { recState: 'ready', recCount: 0, recName: '' }),
      import: () => this.go('import', { rxEdit: false }),
      match: () => this.go('match'),
      upload: () => this.open('upload'),
      brace: () => this.open('brace'),
      rewards: () => this.open('rewards')
    };

    const stageDefs = [
      { id: 'check', title: '刚发现侧弯，还在检查', sub: '帮你准备检查，先了解侧弯', label: '还在检查阶段' },
      { id: 'new', title: '刚开始戴支具（前两周）', sub: '适应期计划，陪你一点点习惯支具', label: '刚开始戴支具' },
      { id: 'brace', title: '支具 + 运动训练', sub: '记录佩戴时长，按处方安排每天的训练', label: '支具 + 运动期' },
      { id: 'off', title: '已脱支具，以运动为主', sub: '维持期：坚持训练，守住矫正成果', label: '脱支具维持期' },
      { id: 'adult', title: '成年后自我管理', sub: '侧弯专属训练，记录疼痛和体态变化', label: '成年自我管理' }
    ];
    const stages = stageDefs.map((d) => {
      const on = S.stage === d.id;
      return { title: d.title, sub: d.sub, aria: on ? 'true' : 'false', border: on ? '2px solid #1F6F66' : '2px solid transparent', dot: on ? '6px solid #1F6F66' : '2px solid #8A9A95',
        pick: () => this.setState({ stage: d.id, done: (d.id === 'brace' || d.id === 'off') ? [1, 2, 3, 4] : [], trainRewarded: false }) };
    });
    const stageLabel = stageDefs.filter((d) => d.id === S.stage)[0].label;
    const st = {
      check: S.stage === 'check', isNew: S.stage === 'new', notNew: S.stage !== 'new',
      braceRings: S.stage === 'new' || S.stage === 'brace', off: S.stage === 'off', adult: S.stage === 'adult'
    };

    const genders = [{ id: 'f', label: '女' }, { id: 'm', label: '男' }, { id: 'c', label: '自定义' }].map((g) => Object.assign({ label: g.label, pick: () => this.setState({ gender: g.id }) }, sel(S.gender === g.id)));
    const menOpts = [{ id: 'no', label: '还没有' }, { id: 'yes', label: '已经来了' }, { id: 'na', label: '不想填' }].map((o) => Object.assign({ label: o.label, pick: () => this.setState({ menarche: o.id }) }, sel(S.menarche === o.id)));
    const matDefs = [
      { key: 'matReport', title: '诊断 / 影像报告', sub: '打印的报告拍照就行' },
      { key: 'matRx', title: '运动处方单', sub: '自动整理成训练卡片，现场录的视频也能配上' },
      { key: 'matNone', title: '还没有，先用起来', sub: '我们会告诉你检查时该带什么、问什么' }
    ];
    const mats = matDefs.map((m) => {
      const on = S[m.key];
      return { title: m.title, sub: m.sub, aria: on ? 'true' : 'false', mark: on ? '已选' : '', border: on ? '2px solid #1F6F66' : '1px solid #C9D4D0', bg: on ? '#F5FAF8' : 'transparent',
        toggle: () => { const o = {}; o[m.key] = !on; this.setState(o); } };
    });
    const showMenarche = S.gender !== 'm';

    const ids = this.deckIds();
    const deck = ids.map((id, i) => {
      const c = C[id]; const d = S.done.indexOf(id) !== -1;
      return { n: String(i + 1), name: c.name, mod: c.mod === '核心' ? '核心 · 隔天' : c.mod, param: this.param(c), done: d, todo: !d,
        check: () => this.check(id), open: () => this.go('card', { cardId: id, cardTab: 'learn', cardEdit: false, back: 'today' }) };
    });
    const doneCount = deck.filter((c) => c.done).length;
    const leftCount = ids.length - doneCount;
    const ringDash = (ids.length ? 163.4 * doneCount / ids.length : 0).toFixed(1) + ' 163.4';
    const coreDone = [5, 6, 7, 8, 9].every((x) => S.done.indexOf(x) !== -1);

    const fid = S.followId; const fc = C[fid] || C[1];
    const fpos = ids.indexOf(fid);
    const nextIds = this.left(S.done.indexOf(fid) === -1 ? S.done.concat([fid]) : S.done);
    const fCard = { name: fc.name, mod: fc.mod, param: this.param(fc), modeShort: this.modeShort(fc.mode), tip: this.tips(fid)[0].replace(/^\d\.\s*/, '') };
    let fBig = '1:48'; let fSmall = '剩余'; let fPhase = S.playing ? '保持' : '已暂停';
    if (fc.mode === 'count') { fBig = '18 次'; fSmall = '第 1 / ' + fc.sets + ' 组'; fPhase = S.playing ? '跟着数' : '已暂停'; }
    if (fc.mode === 'breath') { fBig = fid === 3 ? '吹气' : '吸气'; fSmall = '第 3 / 5 次呼吸'; fPhase = S.playing ? '3:12 剩余' : '已暂停'; }
    const segs = ids.map((id) => ({ bg: id === fid ? '#7FD1C2' : (S.done.indexOf(id) !== -1 ? '#3F7F76' : '#1E534D') }));

    const order = ['柔韧', '3D 矫正', '核心', '颈椎', '拉伸放松'];
    const modules = order.map((mname) => {
      const acts = Object.keys(C).map(Number).filter((id) => C[id].mod === mname).map((id) => {
        const hv = S.videos.indexOf(id) !== -1;
        return { name: C[id].name, param: this.param(C[id]), vText: hv ? '有示范' : '待录制', vColor: hv ? '#1F6F66' : '#8A5A2B',
          open: () => this.go('card', { cardId: id, cardTab: 'learn', cardEdit: false, back: 'train' }) };
      });
      const alt = mname === '核心';
      return { name: mname === '核心' ? '核心 / 肩胛带稳定' : mname, freq: alt ? '隔天' : '每天', tagBg: alt ? '#F6DCC8' : '#DDEDE9', tagFg: alt ? '#6B3416' : '#1F4F49', actions: acts };
    });
    const cell = (k) => ({ w: k === '-' ? '10px' : '18px', h: k === '-' ? '2px' : '18px', bg: k === 'D' ? '#1F6F66' : (k === '-' ? '#C9D4D0' : 'transparent'), border: k === 'P' ? '2px solid #1F6F66' : '0' });
    const modDone = (m) => Object.keys(C).map(Number).filter((id) => C[id].mod === m).every((id) => S.done.indexOf(id) !== -1);
    const daily = (m) => ['D', 'D', modDone(m) ? 'D' : 'P', 'P', 'P', 'P', 'P'];
    const corePat = coreDone ? ['D', '-', 'D', '-', 'P', '-', 'P'] : ['D', '-', 'P', 'P', '-', 'P', '-'];
    const weekRows = [
      { name: '柔韧', cells: daily('柔韧').map(cell) },
      { name: '3D 矫正', cells: daily('3D 矫正').map(cell) },
      { name: '核心', cells: corePat.map(cell) },
      { name: '颈椎', cells: daily('颈椎').map(cell) },
      { name: '拉伸放松', cells: daily('拉伸放松').map(cell) },
      { name: '蛙泳', cells: ['D', '-', '-', '-', 'P', '-', 'P'].map(cell) }
    ];

    const draftRows = S.drafts.map((d, i) => {
      const t = d.cands[d.pick];
      return { label: d.name ? '“' + d.name + '”' : '未命名', time: d.time, target: t === 0 ? '暂不配对，先放着' : C[t].name,
        reason: d.pick === 0 ? (d.name ? '名字相近' : '按录制顺序推测') : '手动选择',
        cycle: () => { const ds = S.drafts.slice(); ds[i] = Object.assign({}, d, { pick: (d.pick + 1) % d.cands.length }); this.setState({ drafts: ds }); } };
    });
    const rxRows = Object.keys(C).map(Number).map((id) => ({ name: C[id].name, mod: C[id].mod, param: this.param(Object.assign({}, C[id], id === 8 ? { amt: '120 个' } : {})), modeShort: this.modeShort(C[id].mode) }));
    const rxNameOpts = [{ id: 'keep', label: '保留康复师的叫法' }, { id: 'search', label: '我来选标准动作' }].map((o) => Object.assign({ label: o.label, pick: () => this.setState({ rxName: o.id }) }, sel(S.rxName === o.id)));

    const cid = S.cardId; const cc = C[cid] || C[1];
    const hasVideo = S.videos.indexOf(cid) !== -1;
    const card = {
      name: cc.name, mod: cc.mod, freq: cc.mod === '核心' ? '隔天' : '每天', param: this.param(cc),
      hasVideo: hasVideo, noVideo: !hasVideo, vLabel: hasVideo ? '现场录制的示范' : '待录制示范',
      vBg: hasVideo ? '#1F6F66' : '#F6DCC8', vFg: hasVideo ? '#FFFFFF' : '#6B3416',
      modeLabel: this.modeLabel(cc.mode), voice: hasVideo ? '使用中' : '暂无',
      tips: this.tips(cid).map((x) => ({ text: x })),
      params: [
        { label: '每组', value: cc.amt },
        { label: '组数', value: cc.sets + ' 组' },
        { label: '播报方式', value: this.modeShort(cc.mode) + '播报' },
        { label: '频率', value: cc.mod === '核心' ? '隔天' : '每天' }
      ]
    };
    const cardTabs = [{ id: 'learn', label: '学' }, { id: 'practice', label: '练' }, { id: 'check', label: '查' }].map((t) => Object.assign({ label: t.label, pick: () => this.setState({ cardTab: t.id }) }, tab(S.cardTab === t.id)));
    const ct = { learn: S.cardTab === 'learn', practice: S.cardTab === 'practice', check: S.cardTab === 'check' };
    const editBtn = (on) => ({ text: on ? '完成' : '⋯', label: on ? '完成编辑' : '编辑', bg: on ? '#1F6F66' : '#EDF0EE', fg: on ? '#FFFFFF' : '#3E4B47' });
    const cE = editBtn(S.cardEdit); const rE = editBtn(S.rxEdit); const uE = editBtn(S.uploadEdit);

    const pains = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ n: String(n), aria: S.pain === n ? 'true' : 'false', bg: S.pain === n ? '#1F6F66' : '#EDF0EE', fg: S.pain === n ? '#FFFFFF' : '#3E4B47', fw: S.pain === n ? '700' : '400', pick: () => this.setState({ pain: n }) }));

    const upFields = [
      ['复查日期', '2026 年 10 月 14 日', 'r'], ['胸弯 Cobb 角', '27°', 'r'], ['腰弯 Cobb 角', '20°', 'r'],
      ['骨骼成熟度', 'Risser 1', 'r'], ['医生建议', '继续佩戴支具，每天 20 小时以上，3 个月后复查', 'm'],
      ['身高', '156 cm', 'm'], ['医院 / 科室', '［医院名称］· 康复科', 'm']
    ].map((f) => ({ label: f[0], value: f[1], src: f[2] === 'r' ? '来自报告' : '手动填写', tagBg: f[2] === 'r' ? '#DDEDE9' : '#EDF0EE', tagFg: f[2] === 'r' ? '#1F4F49' : '#3E4B47' }));
    const visits = (S.uploadSaved ? [{ title: '复查记录', date: '2026.10.14', data: '胸弯 27° · 腰弯 20° · 身高 156 cm · Risser 1', src: '刚刚添加 · 已核对' }] : []).concat([
      { title: '复查 · 配支具', date: '2026.09.20', data: '胸弯 27° · 腰弯 20° · 身高 155 cm · Risser 1', src: '从报告识别 · 已核对' },
      { title: '首次诊断', date: '2026.05.12', data: 'Rigo B1 · 胸弯 28° · 腰弯 21° · 身高 152 cm', src: '从报告识别 · 已核对' }
    ]);

    const commTabs = [{ id: 'talk', label: '交流' }, { id: 'learn', label: '学习' }].map((t) => Object.assign({ label: t.label, pick: () => this.setState({ commTab: t.id }) }, tab(S.commTab === t.id)));
    const cm = { talk: S.commTab === 'talk', learn: S.commTab === 'learn' };
    const guides = [
      { tag: '刚开始', title: '前两周怎么熬', sub: '一点点加时间，难受是正常的', count: '46' },
      { tag: '皮肤', title: '压红了怎么办', sub: '贴身穿纯棉衣，每次脱下看一看', count: '31' },
      { tag: '吃饭', title: '支具压着肚子', sub: '少食多餐，饭前先放松几分钟', count: '18' },
      { tag: '经期', title: '经期更不舒服时', sub: '可以和矫形师商量怎么调整', count: '12' },
      { tag: '学校', title: '体育课和同学', sub: '怎么安排脱支具，怎么跟同学说', count: '39' },
      { tag: '运动', title: '脱支具的时间去游泳', sub: '放松肌肉，也是处方的一部分', count: '15' }
    ];
    const quizOpts = ['三弯型', '四弯型', '单弯型'].map((o) => Object.assign({ label: o, pick: () => {
      const st2 = { quizPick: o };
      if (o === '四弯型' && !S.quizRewarded) { st2.quizRewarded = true; st2.pine = S.pine + 2; st2.toast = '答对了 · +2 松果'; }
      this.setState(st2);
    } }, sel(S.quizPick === o)));
    const articles = [
      { title: '什么是 Cobb 角？为什么差 5° 以内不用紧张', sub: '审核：康复治疗师 · 2 分钟读完' },
      { title: '为什么支具每天要戴够时长？', sub: '审核：康复治疗师 · 3 分钟读完' },
      { title: '第一次复查，要问医生哪些问题', sub: '审核：康复治疗师 · 附可打印清单' },
      { title: '怎么分辨“矫正馆”的夸大宣传', sub: '审核：康复治疗师' }
    ];

    const trainCount = 18 + (S.trainRewarded ? 1 : 0);
    const tk = (name, detail, pts, state) => ({ name: name, detail: detail, pts: '+' + pts, n: pts, state: state === 'done' ? '已获得' : (state === 'later' ? '复查后' : '待完成'),
      border: state === 'todo' ? '1.5px dashed #C4602A' : '0', bg: state === 'done' ? '#1F6F66' : (state === 'later' ? '#EDF0EE' : 'transparent'),
      fg: state === 'done' ? '#FFFFFF' : (state === 'later' ? '#3E4B47' : '#6B3416'), isDone: state === 'done' });
    const tasks = [
      tk('完成当天训练', S.trainRewarded ? '今天的卡组已全部完成' : '还差 ' + leftCount + ' 个动作 · ' + doneCount + ' / ' + ids.length, 3, S.trainRewarded ? 'done' : 'todo'),
      tk('支具时长达标', '今天 14h40m / 20h', 2, 'todo'),
      tk('认知学习小测', S.quizRewarded ? '已答对“看懂我的分型”' : '社群 › 学习，1 分钟', 2, S.quizRewarded ? 'done' : 'todo'),
      tk('复查后上传记录', S.uploadRewarded ? '已添加 10 月 14 日的记录' : '下次复查后可得', 5, S.uploadRewarded ? 'done' : 'later')
    ];
    const gotToday = tasks.filter((t) => t.isDone).reduce((a, t) => a + t.n, 0);
    const md = (name, kind, badge) => ({ name: name, badge: badge, border: kind === 'wip' ? '3px dashed #C4602A' : '0', bg: kind === 'got' ? '#1F6F66' : (kind === 'wip' ? '#FFFFFF' : '#EDF0EE'), fg: kind === 'got' ? '#FFFFFF' : (kind === 'wip' ? '#6B3416' : '#8A9A95') });
    const medals = [
      md('熬过第一周', 'got', '✓'), md('学会 5 个动作', 'got', '✓'), md('第一次复查记录', 'got', '✓'),
      md('坚持 4 周', 'wip', '3/4'), md('支具达标 30 天', 'wip', '24/30'), md('训练满 30 次', 'wip', trainCount + '/30')
    ];

    const complete = S.uploadSaved ? 85 : 70;
    const dateLines = { check: '10 月 14 日 周三 · 检查阶段', new: '10 月 14 日 周三 · 适应期第 5 天', brace: '10 月 14 日 周三 · 支具 + 运动期', off: '10 月 14 日 周三 · 维持期', adult: '10 月 14 日 周三 · 自我管理' };

    return {
      s: s, st: st, nav: nav, navc: navc, navw: navw,
      showNav: tabs.indexOf(scr) !== -1,
      hasToast: !!S.toast, toast: S.toast,
      goBack: () => this.go(S.back || 'today'),
      genders: genders, isCustomGender: S.gender === 'c',
      stages: stages, stageLabel: stageLabel,
      stageStep: S.stageReturn === 'me' ? '切换阶段' : '2 / 4',
      stageBtn: S.stageReturn === 'me' ? '保存' : '下一步',
      stageBack: () => this.go(S.stageReturn === 'me' ? 'me' : 'welcome'),
      stageNext: () => (S.stageReturn === 'me' ? this.go('me', { toast: '已切换到：' + stageLabel }) : this.go('basics')),
      basicsTitle: showMenarche ? '再填 2 项就够了' : '再填 1 项就够了',
      showMenarche: showMenarche, menOpts: menOpts, mats: mats,
      readyReport: S.matReport ? '拍照上传 · 1 份' : '之后再传',
      readyRx: S.matRx ? '识别出 12 个动作' : '之后再导入',
      readyTitle: st.check ? '先了解，再检查' : (st.adult ? '从办公间隙开始' : '今天就可以开始'),
      readyText: st.check ? '确诊和分型以医院为准。首页会帮你准备检查时要带的东西和要问的问题。' : (st.adult ? '首页会记录腰背感受，并在你久坐时提醒你做几个侧弯专属动作。' : '首页已经按处方排好今天的卡组，逐个打卡或连续跟练都可以。'),
      dateLine: dateLines[S.stage], pine: S.pine,
      braceDash: S.braceOn ? '119.8 163.4' : '117.6 163.4', braceHours: st.isNew ? '5h10m' : '14h40m', braceGoal: st.isNew ? '今天目标 8h · 自动' : '目标 20h · 自动',
      deck: deck, deckLen: ids.length, hasDeck: ids.length > 0, doneCount: doneCount, leftCount: leftCount,
      hasLeft: leftCount > 0, allDone: ids.length > 0 && leftCount === 0, ringDash: ringDash,
      coreDayText: coreDone ? '核心已练，明天休息' : '今天是核心日',
      standDone: S.standDone, standTodo: !S.standDone,
      doStand: () => this.setState({ standDone: true, toast: '已打卡：撑杆站立' }),
      swim: S.swim, addSwim: () => this.setState({ swim: Math.min(3, S.swim + 1), toast: S.swim >= 3 ? '本周 3 次已经记满了' : '已记录一次蛙泳' }),
      showPrep: S.remindOn && (st.braceRings || st.off),
      makeSummary: () => this.setState({ toast: '复查前摘要已生成，复查时可以直接给医生看' }),
      pains: pains,
      startFollow: () => this.startFollow(),
      exitFollow: () => this.go(S.followSingle ? 'card' : (S.back === 'card' ? 'today' : (S.back || 'today'))),
      followTitle: S.followSingle ? '单个动作' : '今日 · ' + (fpos + 1) + ' / ' + ids.length,
      segs: segs, fCard: fCard, fBig: fBig, fSmall: fSmall, fPhase: fPhase,
      fPoseText: S.videos.indexOf(fid) !== -1 ? '关键姿势照片（来自现场录制）' : '还没有示范，跟着语音做',
      fNext: S.followSingle ? '练完这一个就回到卡片' : (nextIds.length ? '下一个：' + C[nextIds[0]].name : '这是最后一个动作'),
      fOpenCard: () => this.go('card', { cardId: fid, cardTab: 'learn', back: 'today' }),
      playing: S.playing, paused: !S.playing, playLabel: S.playing ? '暂停' : '继续',
      togglePlay: () => this.setState({ playing: !S.playing }),
      followNext: () => this.followNext(),
      justRewarded: S.justRewarded, trainCount: trainCount,
      rxLine: (S.rxV2 ? '第 2 版运动处方' : '2025 运动处方') + ' · Rigo B1 · 12 个动作',
      hasDrafts: S.drafts.length > 0, draftCount: S.drafts.length,
      weekRows: weekRows, modules: modules,
      recReady: S.recState === 'ready', recRec: S.recState === 'rec', recName: S.recState === 'name',
      recCount: S.recCount, recNameVal: S.recName,
      recStart: () => this.setState({ recState: 'rec' }),
      recStop: () => this.setState({ recState: 'name' }),
      setRecName: (e) => this.setState({ recName: e.target.value }),
      recMore: () => this.addDraft(true), recFinish: () => this.addDraft(false),
      rxRows: rxRows, rxNameOpts: rxNameOpts,
      rxView: !S.rxEdit, rxEditing: S.rxEdit, rxEditText: rE.text, rxEditLabel: rE.label, rxEditBg: rE.bg, rxEditFg: rE.fg,
      toggleRxEdit: () => this.setState({ rxEdit: !S.rxEdit }),
      importBtn: S.drafts.length ? '下一步：配上现场录的视频' : '确认导入，更新卡片',
      importNext: () => (S.drafts.length ? this.go('match', { rxV2: true }) : this.go('train', { rxV2: true, toast: '处方已更新：臀桥改为 120 个' })),
      draftRows: draftRows, finishMatch: () => this.finishMatch(),
      card: card, cardTabs: cardTabs, ct: ct,
      cardView: !S.cardEdit, cardEditing: S.cardEdit, cardEditText: cE.text, cardEditLabel: cE.label, cardEditBg: cE.bg, cardEditFg: cE.fg,
      toggleCardEdit: () => this.setState({ cardEdit: !S.cardEdit }),
      followThis: () => this.go('follow', { followId: cid, followSingle: true, playing: true }),
      nextVisitText: S.remindOn ? '10 月 20 日 周二 · 已开启提前一周提醒' : '可选填写 · 不填也不会打扰你',
      visits: visits,
      upFields: upFields, upView: !S.uploadEdit, upEditing: S.uploadEdit, upEditText: uE.text, upEditLabel: uE.label, upEditBg: uE.bg, upEditFg: uE.fg,
      toggleUpEdit: () => this.setState({ uploadEdit: !S.uploadEdit }),
      saveUpload: () => this.go('growth', { uploadSaved: true, uploadEdit: false, uploadRewarded: true, pine: S.uploadRewarded ? S.pine : S.pine + 5, toast: S.uploadRewarded ? '已保存到成长记录' : '已保存到成长记录 · +5 松果' }),
      commTabs: commTabs, cm: cm, guides: guides,
      pat: () => this.setState({ patted: true, toast: '已经拍了拍阿乐' }), patBg: S.patted ? '#8A9A95' : '#1F6F66', patText: S.patted ? '已拍拍' : '拍拍她',
      quizOpts: quizOpts, quizRight: S.quizPick === '四弯型', quizWrong: !!S.quizPick && S.quizPick !== '四弯型',
      doDraw: () => (S.drawRewarded ? this.setState({ toast: '本周已经完成啦' }) : this.setState({ drawRewarded: true, pine: S.pine + 1, toast: '已上传 · +1 松果，可以选择分享到小组' })),
      drawBg: S.drawRewarded ? '#8A9A95' : '#1F6F66', drawText: S.drawRewarded ? '本周已完成' : '拍照上传我的曲线图',
      articles: articles,
      complete: String(complete), completeW: complete + '%',
      completeText: S.uploadSaved ? '今天的复查记录已补上。再填上医院名称，就能生成完整的复查前摘要。' : '下次复查后补上影像报告，就能生成一份完整的复查前摘要。',
      remindOn: S.remindOn, remindAria: S.remindOn ? 'true' : 'false', swBg: S.remindOn ? '#1F6F66' : '#C9D4D0', swLeft: S.remindOn ? '24px' : '4px',
      toggleRemind: () => this.setState({ remindOn: !S.remindOn, toast: S.remindOn ? '已关闭复查提醒' : '已开启 · 复查前一周首页会出现准备清单' }),
      braceBtn: S.braceOn ? '现在脱下' : '重新戴上', braceStatus: S.braceOn ? '正在佩戴 · 自动记录中' : '已脱下 · 记得在需要时戴回去',
      toggleBrace: () => this.setState({ braceOn: !S.braceOn, toast: S.braceOn ? '已记录脱下，正好可以去练一组' : '已记录戴上' }),
      tasks: tasks, gotToday: String(gotToday), medals: medals,
      makeupLeft: S.makeupUsed ? '本周已用完' : '本周还剩 1 次', makeupBg: S.makeupUsed ? '#8A9A95' : '#6B3416', makeupText: S.makeupUsed ? '已补卡' : '10 颗补卡',
      doMakeup: () => (S.makeupUsed ? this.setState({ toast: '这周的补卡次数已经用过了' }) : this.setState({ makeupUsed: true, pine: S.pine - 10, toast: '已补卡：10 月 11 日 · -10 松果' }))
    };
  }
}

module.exports = SpineApp;
