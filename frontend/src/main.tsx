import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes, Link } from 'react-router-dom';
import { ConnectionStatus } from './ConnectionStatus';
import './styles.css';

type Entry = { title: string; description: string; marker: string };
const professional: Entry[] = [
  { title: '服务对象', description: '未来在这里管理已建立服务关系的用户。', marker: '01' },
  { title: '康复计划', description: '计划制定、执行反馈与调整记录将在下一阶段接入。', marker: '02' },
  { title: '消息与反馈', description: '未来在这里查看对话与用户反馈。', marker: '03' },
];
const review: Entry[] = [
  { title: '专业资质审核', description: '专业身份、资格与机构资料的审核入口。', marker: '01' },
  { title: '动作与课程审核', description: '动作规范与运动养护课程的审核入口。', marker: '02' },
  { title: '社区内容审核', description: '社区内容与举报处理的审核入口。', marker: '03' },
];

function Workspace({ kind }: { kind: 'professional' | 'review' }) {
  const isProfessional = kind === 'professional';
  return <>
    <header className="page-heading">
      <p className="eyebrow">{isProfessional ? 'PROFESSIONAL WORKSPACE' : 'PLATFORM REVIEW'}</p>
      <h1>{isProfessional ? '专业工作台' : '审核后台'}</h1>
      <p>{isProfessional ? '连接专业服务，让每一步照护都有清晰的记录。' : '围绕身份、课程与社区内容，建立清晰的审核流程。'}</p>
    </header>
    <ConnectionStatus />
    <div className="section-heading"><h2>工作入口</h2><span>基础预览</span></div>
    <div className="cards">
      {(isProfessional ? professional : review).map((entry) => <article className="card" key={entry.title}>
        <span className="card-marker">{entry.marker}</span>
        <h3>{entry.title}</h3><p>{entry.description}</p><span className="pending">待接入业务</span>
      </article>)}
    </div>
    <aside className="notice"><strong>当前仅提供页面入口</strong><p>登录、权限与业务数据尚未接入。本页不展示真实用户资料，也不执行审核操作。</p></aside>
  </>;
}

function App() {
  return <BrowserRouter>
    <div className="layout">
      <aside className="sidebar">
        <Link className="brand" to="/professional"><span className="brand-icon">S</span>SPINE</Link>
        <p className="workspace-label">专业与平台工作空间</p>
        <nav aria-label="工作空间导航">
          <NavLink to="/professional">专业工作台<span>→</span></NavLink>
          <NavLink to="/review">审核后台<span>→</span></NavLink>
        </nav>
        <div className="sidebar-footer">基础工程 · v0.1<br />尚未登录</div>
      </aside>
      <div className="main-area">
        <div className="topbar"><span>康复与运动养护</span><span className="preview-label">开发预览</span></div>
        <main>
          <Routes>
            <Route path="/" element={<Navigate to="/professional" replace />} />
            <Route path="/professional" element={<Workspace kind="professional" />} />
            <Route path="/review" element={<Workspace kind="review" />} />
            <Route path="*" element={<section className="page-heading"><h1>页面不存在</h1><Link to="/professional">返回专业工作台</Link></section>} />
          </Routes>
        </main>
      </div>
    </div>
  </BrowserRouter>;
}

createRoot(document.getElementById('root')!).render(<App />);
