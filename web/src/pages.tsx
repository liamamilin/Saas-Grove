import { useEffect } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Boxes, Check, ChevronRight, CircleHelp, Code2, Search, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useResource, type Application, type ApplicationList, type Domain, type Leaf, type LeafDetail, type Taxonomy, type Track } from "./api";
import { ComparePicker, ProductSearchForm, productUrl } from "./products";

const number = (n: number) => n.toLocaleString("zh-CN");
const text = (value: string) => value.replace(/\*\*|`|^#+\s/gm, "").trim();
function Loading() { return <div className="loading-box" role="status"><span className="loading-dot" />正在读取目录…</div>; }
function ErrorState({ error, retry }: { error: string; retry: () => void }) {
  return <div className="message-card error" role="alert"><h2>资料暂时没有加载成功</h2><p>{error}</p><button className="button" onClick={retry}>重新加载</button><Link to="/browse">返回目录</Link></div>;
}

export function Browse() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "", scope = params.get("scope") || "included", domainId = params.get("domain") || "";
  const { data, error, retry } = useResource<Taxonomy>(`/api/taxonomy?${new URLSearchParams({ q, scope })}`);
  const domains = data?.domains.filter(d => !domainId || d.id === domainId) || [];
  const matching = domains.reduce((n, d) => n + d.leaf_count, 0);
  const domain = domainId ? domains[0] : undefined;
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: key === "q" });
  }
  useEffect(() => { document.title = `${domain?.name_zh ? domain.name_zh + " · " : ""}SaaS Grove · 从类型发现应用`; }, [domain?.name_zh]);
  return <main id="main" className="page">
    <section className="hero">
      <div><p className="eyebrow"><span /> A DIRECTORY FOR BUILDERS</p><h1>发现合适的 SaaS，<br />从了解，到选择<span className="hero-period">。</span></h1>
        <p className="hero-copy">探索真实产品，了解已有能力，把同类选择放在一起看。<br className="desktop-break" />开源项目深入整理，商业产品保留基本索引。</p></div>
      <div className="hero-index" aria-hidden="true"><span className="index-label">THE INDEX / 01</span><div><span>分类</span><i>↘</i><span>叶子类型</span><i>↘</i><span className="index-end">真实应用</span></div><p>清晰的分类，直接的连接。</p></div>
    </section>
    <ProductSearchForm home /><p className="home-search-hint">从一个名字或用途开始。<Link to="/search?q=CRM系统">发现 CRM 产品 <ArrowRight size={13} /></Link></p>
    <section className="stats" aria-label="目录统计">
      <div><strong>{data ? number(data.counts.included) : "—"}</strong><span>主目录应用类型</span></div>
      <div><strong>{data ? number(data.counts.conditional) : "—"}</strong><span>待确认类型</span></div>
      <div><strong>{data ? number(data.application_counts.open_source) : "—"}</strong><span>开源项目</span></div>
      <div><strong>{data ? number(data.application_counts.commercial) : "—"}</strong><span>商业产品索引</span></div>
    </section>
    <div className="catalog-layout">
      <aside className="sidebar" aria-label="分类导航"><div className="sidebar-title">浏览分类<span>INDEX</span></div>
        <Link className={`domain-link ${!domainId ? "selected" : ""}`} to={`/browse?${new URLSearchParams({ ...(q ? { q } : {}), ...(scope !== "included" ? { scope } : {}) })}`}><Boxes size={16} /><span>全部分类</span></Link>
        {data?.domains.map(d => <Link key={d.id} className={`domain-link ${domainId === d.id ? "selected" : ""}`} to={`/browse?${new URLSearchParams({ domain: d.id, ...(q ? { q } : {}), ...(scope !== "included" ? { scope } : {}) })}`}><span className="domain-number">{d.id}</span><span>{d.name_zh}</span><small>{d.leaf_count}</small></Link>)}
        <div className="sidebar-note"><BookOpen size={18} /><p>目录先行，资料逐步补充。没有项目的类型，也可以先了解定义。</p></div>
      </aside>
      <section className="catalog-main" aria-label="应用类型目录">
        <div className="catalog-toolbar"><div className="search-field"><Search size={19} aria-hidden="true" /><input aria-label="搜索应用类型" placeholder="搜索类型、功能领域或别名，如 CRM、表单…" value={q} maxLength={160} onChange={e => filter("q", e.target.value)} />{q && <button aria-label="清除搜索" onClick={() => filter("q", "")}><X size={17} /></button>}</div>
          <label className="scope-select"><span className="sr-only">类型范围</span><select aria-label="类型范围" value={scope} onChange={e => filter("scope", e.target.value)}><option value="included">SaaS 主目录</option><option value="conditional">待确认类型</option><option value="all">主目录与待确认</option></select></label></div>
        <div className="catalog-heading"><div><p className="eyebrow">EXPLORE THE CATALOG</p><h2>{q ? `“${q}”的搜索结果` : domain?.name_zh || (domainId ? "当前分类" : "选择一个领域，开始探索")}</h2></div><span>{data ? `${number(matching)} 个匹配类型` : ""}</span></div>
        {scope !== "included" && <p className="scope-note"><CircleHelp size={18} /><span>待确认类型暂不属于 SaaS 主目录。找到实际在线应用或服务端部署依据后，再决定是否纳入。</span></p>}
        {error ? <ErrorState error={error} retry={retry} /> : !data ? <Loading /> : matching === 0 ? <div className="message-card"><Search size={28} /><h3>没有找到匹配的类型</h3><p>试试更短的关键词、英文名称，或调整分类和范围。</p><button className="button" onClick={() => setParams({})}>重置筛选</button></div> : q || domainId ? <LeafGroups domains={domains} /> : <div className="domain-grid">{domains.map(d => <DomainCard key={d.id} domain={d} scope={scope} />)}</div>}
        <details className="scope-explanation"><summary><CircleHelp size={15} />这份目录的范围如何划分？</summary><p>主目录面向可持续管理用户资料、团队协作或业务流程的在线应用，也收录可部署为应用服务的开源项目。消费社交、内容和交易场所、纯客户端、底层组件及设备控制不因联网就纳入。待确认类型单列，需核实具体项目的软件服务形态。</p>{data && <p>源目录 {number(data.source_leaf_count)} 个类型已按用途与交付边界审阅，其中 {data.counts.conditional} 个待确认、{data.counts.excluded} 个明确排除。</p>}</details>
      </section>
    </div>
  </main>;
}

function DomainCard({ domain, scope }: { domain: Domain; scope: string }) {
  return <Link className="domain-card" to={`/browse?${new URLSearchParams({ domain: domain.id, ...(scope !== "included" ? { scope } : {}) })}`}><div className="domain-card-top"><span>{domain.id}</span><ArrowUpRight size={19} /></div><h3>{domain.name_zh}</h3><p>{domain.groups.slice(0, 3).map(g => g.name_zh).join(" · ")}</p><div className="domain-card-bottom"><span>{domain.groups.length} 个子分类</span><strong>{domain.leaf_count} 个类型 <ArrowRight size={14} /></strong></div></Link>;
}
function LeafGroups({ domains }: { domains: Domain[] }) {
  return <div className="leaf-groups">{domains.map(d => <div key={d.id}>{domains.length > 1 && <h3 className="result-domain">{d.id} / {d.name_zh}</h3>}{d.groups.map(g => <section className="leaf-group" key={g.id}><div className="group-heading"><h3>{g.name_zh}</h3><span>{g.leaves.length} 个类型</span></div><div className="leaf-grid">{g.leaves.map(l => <LeafCard key={l.slug} leaf={l} />)}</div></section>)}</div>)}</div>;
}
function LeafCard({ leaf }: { leaf: Leaf }) {
  return <Link className="leaf-card" to={`/types/${leaf.slug}`}><div><h4>{leaf.name_zh || leaf.name}</h4><p>{leaf.name}</p></div><div className="leaf-meta">{leaf.scope === "conditional" ? <span className="badge conditional">待确认</span> : <span>{leaf.counts.open_source} 开源 · {leaf.counts.commercial} 商业</span>}<ChevronRight size={16} /></div></Link>;
}

export function LeafPage() {
  const { slug = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const track = params.get("track") === "commercial" ? "commercial" : "open_source";
  const q = params.get("q") || "";
  const location = useLocation();
  const selected = (params.get("compare") || "").split(",").filter(Boolean);
  const { data: leaf, error, retry } = useResource<LeafDetail>(`/api/leaves/${encodeURIComponent(slug)}`);
  const listing = useResource<ApplicationList>(`/api/applications?${new URLSearchParams({ leaf: slug, track, q })}`);
  useEffect(() => { document.title = `${leaf?.name_zh || "应用类型"} · SaaS Grove`; }, [leaf?.name_zh]);
  useEffect(() => { if (leaf && location.hash === "#compare-picker") document.getElementById("compare-picker")?.scrollIntoView({ block: "start" }); }, [leaf, location.hash]);
  function changeTrack(value: Track) { const next = new URLSearchParams(params); if (value === "commercial") next.set("track", value); else next.delete("track"); setParams(next); }
  if (error) return <main id="main" className="page leaf-page"><ErrorState error={error} retry={retry} /></main>;
  if (!leaf) return <main id="main" className="page"><Loading /></main>;
  const core = leaf.dc_zh || leaf.dc;
  return <main id="main" className="page leaf-page">
    <nav className="breadcrumbs" aria-label="当前位置"><Link to="/browse">分类目录</Link>{leaf.breadcrumbs.map(b => <span key={b.id}><ChevronRight size={13} /><Link to={`/browse?${new URLSearchParams({ domain: leaf.domain_id, ...(leaf.scope === "conditional" ? { scope: "conditional" } : {}) })}`}>{b.name_zh || b.name}</Link></span>)}<ChevronRight size={13} /><span aria-current="page">{leaf.name_zh}</span></nav>
    <section className="leaf-hero"><div className="leaf-kicker"><span className="eyebrow">APPLICATION TYPE</span>{leaf.scope === "conditional" && <span className="badge conditional">待确认</span>}</div><h1>{leaf.name_zh || leaf.name}</h1><p className="english-name">{leaf.name}</p><p className="leaf-intro">{text(leaf.overview_zh || leaf.overview).split("\n\n")[0]}</p>{leaf.aliases_zh.length > 0 && <div className="aliases"><span>也称</span>{leaf.aliases_zh.map(alias => <span className="badge" key={alias}>{alias}</span>)}</div>}</section>
    <div className="scope-note"><CircleHelp size={18} /><p><strong>{leaf.scope === "conditional" ? "待确认类型 · " : "SaaS 收录边界 · "}</strong>{leaf.scope_reason}</p></div>
    <details className="definition-panel"><summary><span><BookOpen size={18} />了解原始类型定义与边界</span><ChevronRight size={17} /></summary><div className="definition-content"><div><h2>Atlas 参考定义</h2><Markdown value={leaf.overview_zh || leaf.overview} /><h2>定义性核心</h2>{/[└├]──/.test(core) && !core.includes("```") ? <pre>{core}</pre> : <Markdown value={core} />}</div><div><h2>行为与边界</h2><Markdown value={leaf.rules_zh || leaf.rules} /><p className="source-note">类型资料参考 {leaf.source.project} · {leaf.source.import_date} 整理</p></div></div></details>
    <section className="application-section" aria-label="本类型应用"><div className="applications-header"><div><p className="eyebrow">APPLICATIONS IN THIS TYPE</p><h2>这个类型有哪些应用</h2></div><Link to={`/browse?${new URLSearchParams({ domain: leaf.domain_id, ...(leaf.scope === "conditional" ? { scope: "conditional" } : {}) })}`} className="back-link"><ArrowLeft size={15} />继续浏览分类</Link></div>
      <div className="list-controls"><div className="track-tabs" role="tablist" aria-label="应用分区" onKeyDown={e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); const next = e.key === "Home" ? "open_source" : e.key === "End" ? "commercial" : track === "open_source" ? "commercial" : "open_source"; changeTrack(next); document.getElementById(`tab-${next}`)?.focus(); } }}><button role="tab" tabIndex={track === "open_source" ? 0 : -1} aria-selected={track === "open_source"} aria-controls="applications-panel" id="tab-open_source" onClick={() => changeTrack("open_source")}><Code2 size={17} />开源项目<span>{leaf.counts.open_source}</span></button><button role="tab" tabIndex={track === "commercial" ? 0 : -1} aria-selected={track === "commercial"} aria-controls="applications-panel" id="tab-commercial" onClick={() => changeTrack("commercial")}><Boxes size={17} />商业产品<span>{leaf.counts.commercial}</span></button></div>
        <div className="search-field list-search"><Search size={17} /><input aria-label="搜索此类型中的应用" placeholder="搜索此类型中的应用" value={q} maxLength={160} onChange={e => { const next = new URLSearchParams(params); if (e.target.value) next.set("q", e.target.value); else next.delete("q"); setParams(next, { replace: true }); }} />{q && <button aria-label="清除应用搜索" onClick={() => { const next = new URLSearchParams(params); next.delete("q"); setParams(next); }}><X size={16} /></button>}</div></div>
      <p className="track-description">{track === "open_source" ? "优先整理核心功能、部署方式与许可证，保留官方资料来源。" : "记录官网与主要用途，帮助你了解这个领域有哪些商业选择。"}</p>
      <ComparePicker leaf={slug} selected={selected} expanded={selected.length > 0} from={location.pathname + location.search} change={ids => { const next = new URLSearchParams(params); if (ids.length) next.set("compare", ids.join(",")); else next.delete("compare"); setParams(next, { replace: true }); }} />
      <div id="applications-panel" role="tabpanel" aria-labelledby={`tab-${track}`}>
        {listing.error ? <ErrorState error={listing.error} retry={listing.retry} /> : !listing.data ? <Loading /> : listing.data.applications.length > 0 ? <div className="application-grid">{listing.data.applications.map(app => <ApplicationCard key={app.id} app={app} track={track} />)}</div> : <div className="applications-empty"><div className="empty-symbol">{track === "open_source" ? <Code2 size={29} /> : <Boxes size={29} />}</div><span className="eyebrow">{q ? "NO MATCHES" : "ROOM FOR DISCOVERY"}</span><h3>{q ? "没有符合搜索条件的应用" : track === "open_source" ? "这里还没有收录开源项目" : "这里还没有记录商业产品"}</h3><p>{q ? "换个关键词试试，或清除搜索查看全部条目。" : "类型目录已经准备好。找到并整理的真实应用，会在这里逐步补充。"}</p><div className="empty-check"><Check size={14} /><span>资料缺项会明确标注，来源始终可追溯</span></div></div>}
      </div>
    </section>
  </main>;
}
function Markdown({ value }: { value: string }) {
  return <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>, img: () => null }}>{value}</ReactMarkdown></div>;
}
function ApplicationCard({ app, track }: { app: Application; track: Track }) {
  const location = useLocation();
  const source = app.source_url || app.sources?.find(s => s.kind === "readme" || s.kind === "homepage")?.url;
  const checkedAt = app.checked_at || app.sources?.reduce((latest, s) => Date.parse(s.fetched_at) > Date.parse(latest || "1970-01-01") ? s.fetched_at : latest, "");
  return <article className="application-card"><div className="application-card-title"><h3><Link to={productUrl(app.id, location.pathname + location.search)}>{app.name}</Link></h3><span className="badge">{track === "open_source" ? "开源项目" : "商业产品"}</span></div><p>{app.summary || "介绍待补充"}</p>{track === "open_source" && app.features?.length ? <ul>{app.features.map(f => <li key={f}>{f}</li>)}</ul> : null}
    {track === "open_source" && (app.deployment?.length || app.technology_stack?.length) ? <dl className="application-facts">{app.deployment?.length ? <div><dt>部署</dt><dd>{app.deployment.join(" · ")}</dd></div> : null}{app.technology_stack?.length ? <div><dt>技术</dt><dd>{app.technology_stack.join(" · ")}</dd></div> : null}</dl> : null}
    <div className="application-card-links"><Link to={productUrl(app.id, location.pathname + location.search)}>产品详情 <ArrowRight size={14} /></Link>{app.homepage && <a href={app.homepage} target="_blank" rel="noreferrer">官网 <ArrowUpRight size={14} /></a>}{track === "open_source" && app.repository_url && <a href={app.repository_url} target="_blank" rel="noreferrer">代码仓库 <ArrowUpRight size={14} /></a>}{source && <a href={source} target="_blank" rel="noreferrer">资料来源 <ArrowUpRight size={14} /></a>}</div>
    {track === "open_source" && <p className="source-note">许可证：{app.license || "待核验"}{app.runtime_tested === false && <><br />{app.verification_status === "official_sources_reviewed" ? "已核对官方资料，尚未进行部署测试" : "资料待核对，尚未进行部署测试"}</>}</p>}
    {checkedAt && <p className="source-note">{app.checked_at ? "资料核对" : "来源采集"}：{checkedAt.slice(0, 10)}</p>}</article>;
}
export function NotFound() { return <main id="main" className="page"><div className="message-card"><p className="eyebrow">404</p><h1>没有找到这个页面</h1><Link to="/browse" className="button">返回分类目录 <ArrowRight size={16} /></Link></div></main>; }
