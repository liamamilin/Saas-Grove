import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Browse, LeafPage, NotFound } from "./pages";
import { ComparePage, ProductPage, SearchPage } from "./products";
import "./styles.css";
function App() {
  const location = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  return <>
    <a className="skip-link" href="#main">跳到主要内容</a>
    <header className="site-header"><div className="header-inner">
      <Link to="/" className="brand" aria-label="SaaS Grove 首页"><span className="brand-mark">G</span><span>SaaS Grove<small>发现开源 SaaS · 了解商业选择</small></span></Link>
      <nav aria-label="主导航"><NavLink to="/search">产品搜索</NavLink><NavLink to="/browse" className={({ isActive }) => isActive || location.pathname === "/" ? "active" : ""}>分类目录</NavLink><a className="about-nav" href="#about">关于目录 <ArrowUpRight size={14} /></a></nav>
      <span className="header-note"><span className="status-dot" />开源优先 · 持续整理</span>
    </div></header>
    <Routes><Route path="/" element={<Browse />} /><Route path="/browse" element={<Browse />} /><Route path="/search" element={<SearchPage />} /><Route path="/products/:id" element={<ProductPage />} /><Route path="/compare" element={<ComparePage />} /><Route path="/types/:slug" element={<LeafPage />} /><Route path="*" element={<NotFound />} /></Routes>
    <footer id="about"><div><strong>每一种应用，都有值得了解的选择。</strong><p>按分类和叶子类型整理真实应用。开源项目优先，商业产品保留基本索引。</p><p className="footer-fine">类型定义参考 Atlas，收录范围按 SaaS 用途与服务形态筛选。具体项目的功能、部署和许可证以其官方资料为准。</p></div><Link to="/browse">浏览完整目录 <ArrowUpRight size={16} /></Link></footer>
  </>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>);
