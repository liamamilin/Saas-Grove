import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Code2, Columns3, ExternalLink, Search, X } from "lucide-react";
import { useResource, type Application, type Comparison, type ProductResults } from "./api";
import { SaveButton } from "./saved";

const CRM = "customer-relationship-management-crm";
const date = (value?: string) => value ? value.slice(0, 10) : "日期未记录";
const sourceNames: Record<string, string> = { homepage: "官网", documentation: "官方文档", readme: "项目介绍 / README", license: "许可证原文", repository_metadata: "仓库资料" };
export const productUrl = (id: string, from: string) => `/products/${encodeURIComponent(id)}?${new URLSearchParams({ from })}`;
function context(value: string | null, fallback = "/search") { return value?.startsWith("/") && !value.startsWith("//") ? value : fallback; }
function Unknown() { return <span className="unknown-fact">资料未提供 / 未核实</span>; }
function Status({ app }: { app: Application }) {
  return <span className="verification-label">{app.verification_status === "official_sources_reviewed" ? <><Check size={13} />官方资料已核对</> : "资料待核对"}</span>;
}
function Tracks({ app }: { app: Application }) {
  return <span className="product-badges">{app.tracks?.map(t => <span className={`badge ${t === "open_source" ? "open-badge" : "commercial-badge"}`} key={t}>{t === "open_source" ? "开源项目" : "商业产品"}</span>)}</span>;
}
function Facts({ values }: { values?: string[] }) { return values?.length ? <ul className="fact-list">{values.map((v, i) => <li key={i}>{v}</li>)}</ul> : <Unknown />; }
function Loading() { return <div className="loading-box" role="status"><span className="loading-dot" />正在读取产品资料…</div>; }
function ErrorState({ error, retry, back = "/search" }: { error: string; retry: () => void; back?: string }) {
  return <div className="message-card error" role="alert"><h2>暂时无法读取产品资料</h2><p>{error}</p><button className="button" onClick={retry}>重新加载</button><Link to={back}>返回继续探索</Link></div>;
}

export function ProductSearchForm({ initial = "", home = false }: { initial?: string; home?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [value, setValue] = useState(initial);
  useEffect(() => { setValue(initial); }, [initial]);
  return <form className={`product-search-form ${home ? "home-search" : ""}`} role="search" onSubmit={e => { e.preventDefault(); const next = new URLSearchParams(location.pathname === "/search" ? location.search : ""); next.delete("page"); if (value.trim()) next.set("q", value.trim()); else next.delete("q"); navigate(`/search?${next}`); }}>
    <label className="search-field"><Search size={20} aria-hidden="true" /><span className="sr-only">搜索 SaaS 产品</span><input aria-label="搜索 SaaS 产品" value={value} maxLength={160} onChange={e => setValue(e.target.value)} placeholder="搜索产品、用途或类型，如 Twenty、CRM、项目管理" />{value && <button type="button" aria-label="清除产品关键词" onClick={() => setValue("")}><X size={16} /></button>}</label>
    <button className="button primary-button" type="submit">搜索产品 <ArrowRight size={16} /></button>
  </form>;
}

export function ProductCard({ app, from, children }: { app: Application; from: string; children?: ReactNode }) {
  return <article className="product-card"><div className="product-card-top"><span className="product-monogram" aria-hidden="true">{app.name.slice(0, 1).toUpperCase()}</span><div className="product-card-actions"><Tracks app={app} /><SaveButton id={app.id} name={app.name} /></div></div>
    <h2><Link to={productUrl(app.id, from)}>{app.name}<ArrowUpRight size={18} /></Link></h2>
    <p className="product-summary">{app.summary || "简介尚未记录"}</p>
    <div className="product-types">{app.types?.slice(0, 2).map(t => <Link key={t.slug} to={`/types/${t.slug}`}>{t.name_zh || t.name}</Link>)}{(app.types?.length || 0) > 2 && <span>+{app.types!.length - 2} 类型</span>}</div>
    <div className="product-card-bottom"><span>{app.license || (app.tracks?.includes("open_source") ? "许可待核实" : "商业基本索引")}</span><Link to={productUrl(app.id, from)}>了解产品 <ArrowRight size={14} /></Link></div>
    <p className="product-date"><Status app={app} /><span>{app.checked_at_basis === "recorded" ? "核对" : "来源"} {date(app.checked_at)}</span></p>
    {children}
  </article>;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const q = params.get("q") || "";
  const { data, error, retry } = useResource<ProductResults>(`/api/products?${new URLSearchParams({ ...Object.fromEntries(params), page_size: "12" })}`);
  useEffect(() => { document.title = `${q ? q + " · " : ""}产品搜索 · SaaS Grove`; }, [q]);
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params); next.delete("page");
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }
  function pageUrl(page: number) { const next = new URLSearchParams(params); next.set("page", String(page)); return `/search?${next}`; }
  return <main id="main" className="page discovery-page">
    <div className="discovery-heading"><div><p className="eyebrow">FIND YOUR NEXT SOFTWARE</p><h1>发现值得了解的软件<span className="hero-period">。</span></h1><p>从真实产品出发，了解用途、核对来源，再做选择。</p></div><Link className="text-action" to="/browse">按分类浏览 <ArrowUpRight size={15} /></Link></div>
    <ProductSearchForm initial={q} />
    <div className="product-filters" aria-label="筛选产品">
      <label>产品分区<select aria-label="产品分区" value={params.get("track") || "all"} onChange={e => filter("track", e.target.value)}><option value="all">全部 · 开源优先</option><option value="open_source">开源项目</option><option value="commercial">商业产品</option></select></label>
      <label>许可证<select aria-label="许可证" value={params.get("license") || ""} onChange={e => filter("license", e.target.value)}><option value="">全部许可证</option>{data?.facets.licenses.map(f => <option key={f.value} value={f.value}>{f.value} ({f.count})</option>)}{params.get("license") && !data?.facets.licenses.some(f => f.value === params.get("license")) && <option value={params.get("license")!}>{params.get("license")}</option>}</select></label>
      <label>已记录的部署方式<select aria-label="已记录的部署方式" value={params.get("deployment") || ""} onChange={e => filter("deployment", e.target.value)}><option value="">全部部署方式</option>{data?.facets.deployments.map(f => <option key={f.value} value={f.value}>{f.label} ({f.count})</option>)}{params.get("deployment") && !data?.facets.deployments.some(f => f.value === params.get("deployment")) && <option value={params.get("deployment")!}>{({ self_hosted: "自托管", docker: "Docker", managed_cloud: "云部署 / 托管服务" } as Record<string, string>)[params.get("deployment")!] || params.get("deployment")}</option>}</select></label>
      <label>排序<select aria-label="排序" value={params.get("sort") || "relevance"} onChange={e => filter("sort", e.target.value)}><option value="relevance">相关性 · 开源优先</option><option value="name">产品名称 A–Z</option><option value="checked">最近资料日期</option></select></label>
      <button className="text-action clear-filters" onClick={() => setParams({})}>重置筛选</button>
    </div>
    <div className="results-caption"><p role="status">{data ? <><strong>{data.total.toLocaleString("zh-CN")}</strong> 个产品{q && <>与“{q}”相关</>}</> : "读取搜索结果…"}</p><span>筛选仅依据已记录资料，缺项不代表不支持</span></div>
    {error ? <ErrorState error={error} retry={retry} /> : !data ? <Loading /> : data.total ? <><div className="product-grid">{data.applications.map(app => <ProductCard key={app.id} app={app} from={location.pathname + location.search} />)}</div><nav className="pagination" aria-label="产品搜索分页">{data.page > 1 ? <Link className="button" to={pageUrl(data.page - 1)}><ArrowLeft size={15} />上一页</Link> : <span className="button disabled" aria-disabled="true">上一页</span>}<span>第 {data.page} / {data.pages} 页</span>{data.page < data.pages ? <Link className="button" to={pageUrl(data.page + 1)}>下一页<ArrowRight size={15} /></Link> : <span className="button disabled" aria-disabled="true">下一页</span>}</nav></> : <div className="message-card"><Search size={30} /><h2>没有找到匹配的产品</h2><p>尝试产品英文名、更短的用途关键词，或减少筛选条件。</p><button className="button" onClick={() => setParams({})}>查看全部产品</button><Link to={`/browse?${new URLSearchParams({ q })}`}>也可以搜索应用类型</Link></div>}
  </main>;
}

function Types({ app }: { app: Application }) { return <div className="type-links">{app.types?.map(t => <Link key={t.slug} to={`/types/${t.slug}`}>{t.name_zh || t.name}{t.scope === "conditional" && <span className="badge conditional">待确认类型</span>}<ArrowUpRight size={14} /></Link>)}</div>; }
function Sources({ app }: { app: Application }) {
  const unique = [...(app.sources || []).reduce((all, source) => { const old = all.get(source.url); if (!old || Date.parse(source.fetched_at) > Date.parse(old.fetched_at)) all.set(source.url, source); return all; }, new Map<string, NonNullable<Application["sources"]>[number]>()).values()];
  return unique.length ? <ol className="product-sources">{unique.map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer"><span>{sourceNames[s.kind] || "资料来源"}</span><span className="source-url">{s.url}</span><ExternalLink size={14} /></a><time dateTime={s.fetched_at}>{date(s.fetched_at)} 采集</time></li>)}</ol> : app.source_url ? <a className="text-action" href={app.source_url} target="_blank" rel="noreferrer">资料来源 <ExternalLink size={14} /></a> : <Unknown />;
}
function EvidenceNote({ app }: { app: Application }) { return <div className="evidence-note"><Status app={app} /><span>{app.runtime_tested === true ? "已记录实际部署测试" : app.runtime_tested === false ? "尚未进行实际部署测试" : "部署测试状态未记录"}</span><p>资料核对描述的是官方文档中的信息，不等同于功能实测。{app.checked_at_basis === "source_fetched" && "资料日期取最近一次来源采集时间，未单独记录复核日期。"}</p></div>; }

export function ProductPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const back = context(params.get("from"));
  const { data: app, error, retry } = useResource<Application>(`/api/products/${encodeURIComponent(id)}`);
  useEffect(() => { document.title = `${app?.name || "产品详情"} · SaaS Grove`; }, [app?.name]);
  if (error) return <main id="main" className="page discovery-page"><ErrorState error={error} retry={retry} back={back} /></main>;
  if (!app) return <main id="main" className="page discovery-page"><Loading /></main>;
  const open = app.tracks?.includes("open_source");
  const from = location.pathname + location.search;
  const contextLeaf = back.match(/^\/types\/([^?/#]+)/)?.[1] || (back.startsWith("/shortlist") ? new URL(back, window.location.origin).searchParams.get("type") : undefined);
  const comparisonType = app.types?.find(t => t.slug === contextLeaf) || app.types?.[0];
  return <main id="main" className="page product-page">
    <Link className="return-context" to={back}><ArrowLeft size={15} />{back.startsWith("/shortlist") ? "返回候选清单" : back.startsWith("/types/") ? "返回应用类型" : back.startsWith("/compare") ? "返回产品比较" : "返回产品搜索"}</Link>
    <header className="product-header"><div><p className="eyebrow">SOFTWARE, WITH SOURCES</p><Tracks app={app} /><h1>{app.name}</h1><p className="product-lede">{app.summary || "简介尚未记录"}</p><div className="product-actions"><SaveButton id={app.id} name={app.name} />{app.homepage && <a className="button primary-button" href={app.homepage} target="_blank" rel="noreferrer">访问官网 <ArrowUpRight size={16} /></a>}{open && app.repository_url && <a className="button" href={app.repository_url} target="_blank" rel="noreferrer"><Code2 size={16} />代码仓库 <ArrowUpRight size={14} /></a>}{comparisonType && <Link className="text-action" to={`/types/${comparisonType.slug}?${new URLSearchParams({ compare: app.id })}#compare-picker`}><Columns3 size={16} />与同类产品比较</Link>}</div></div><aside className="product-proof"><p className="eyebrow">RESEARCH NOTE</p><EvidenceNote app={app} /><p className="product-date">{app.checked_at_basis === "recorded" ? "最近资料核对" : "最近来源采集"} · {date(app.checked_at)}</p></aside></header>
    <div className="product-reading"><div className="product-main-reading">
      {open && <section className="reading-section"><p className="eyebrow">WHAT IT DOES</p><h2>核心能力</h2><Facts values={app.features} />{!!app.unsupported_features?.length && <div className="explicit-limit"><h3>有明确证据的不支持</h3>{app.unsupported_features.map(f => <p key={f.name}>{f.name} <a href={f.source_url} target="_blank" rel="noreferrer">依据 <ExternalLink size={12} /></a></p>)}</div>}<p className="quiet-note">仅列出已记录的能力与边界，未列出不代表不支持。</p></section>}
      <section className="reading-section"><p className="eyebrow">WHERE IT FITS</p><h2>所属应用类型</h2><Types app={app} />{!open && <p className="quiet-note">商业产品保留基本索引，深入能力、技术与部署信息尚未核对。</p>}</section>
      <section className="reading-section"><p className="eyebrow">FOLLOW THE EVIDENCE</p><h2>资料来源</h2><Sources app={app} /></section>
    </div>{open && <aside className="product-side-reading"><section className="reading-section"><p className="eyebrow">UNDER THE HOOD</p><h2>技术与部署</h2><h3>技术栈</h3><Facts values={app.technology_stack} /><h3>部署方式</h3><Facts values={app.deployment} /></section><section className="reading-section"><p className="eyebrow">LICENSE</p><h2>{app.license || "许可证待核实"}</h2><span className={`badge ${app.license_status === "reviewed" ? "open-badge" : "conditional"}`}>{app.license_status === "reviewed" ? "已核对许可资料" : "许可资料待核验"}</span>{app.license_review?.rationale && <p className="license-rationale">{app.license_review.rationale}</p>}{(app.license_evidence_url || app.license_review?.source_url) && <a className="text-action" href={app.license_evidence_url || app.license_review?.source_url} target="_blank" rel="noreferrer">查看许可依据 <ArrowUpRight size={14} /></a>}</section></aside>}</div>
    {comparisonType && <section className="next-step"><div><p className="eyebrow">KEEP EXPLORING</p><h2>把选择放在一起看。</h2><p>从同一类型中选择 2–4 个产品，比较已有资料。</p></div><Link className="button" to={`/types/${comparisonType.slug}?${new URLSearchParams({ compare: app.id, from })}#compare-picker`}>选择比较对象 <ArrowRight size={16} /></Link></section>}
  </main>;
}

export function ComparePicker({ leaf, selected, change, from, expanded = false }: { leaf: string; selected: string[]; change: (ids: string[]) => void; from: string; expanded?: boolean }) {
  const { data, error, retry } = useResource<ProductResults>(`/api/products?${new URLSearchParams({ leaf, page_size: "60" })}`);
  const selectionKey = selected.join(",");
  const [draft, setDraft] = useState(selected);
  useEffect(() => { setDraft(selectionKey ? selectionKey.split(",") : []); }, [selectionKey]);
  const returnUrl = new URL(from, window.location.origin);
  if (returnUrl.pathname === `/types/${leaf}`) returnUrl.searchParams.set("compare", draft.join(","));
  const compareUrl = `/compare?${new URLSearchParams({ leaf, ids: draft.join(","), from: returnUrl.pathname + returnUrl.search + returnUrl.hash })}`;
  return <details className="compare-picker" id="compare-picker" open={expanded || undefined}>
    <summary><span><Columns3 size={18} />选择同类产品进行比较</span><span>{draft.length} / 4 已选</span></summary>
    <div className="compare-picker-body"><p>开源与商业可一起选择。缺少资料的字段会标为未核实。</p>{error ? <ErrorState error={error} retry={retry} /> : !data ? <Loading /> : <div className="compare-options">{data.applications.map(app => <label key={app.id} className={draft.includes(app.id) ? "selected" : ""}><input type="checkbox" checked={draft.includes(app.id)} disabled={!draft.includes(app.id) && draft.length >= 4} onChange={e => { const next = e.target.checked ? [...draft, app.id] : draft.filter(id => id !== app.id); setDraft(next); change(next); }} /><span>{app.name}<small>{app.tracks?.includes("open_source") ? "开源" : "商业"}</small></span></label>)}</div>}
      <div className="compare-picker-footer"><span>{draft.length < 2 ? "至少选择 2 个产品" : `已选择 ${draft.length} 个产品`}</span>{draft.length >= 2 ? <Link className="button primary-button" to={compareUrl}>开始比较 <ArrowRight size={15} /></Link> : <button className="button" disabled>开始比较</button>}</div>
    </div>
  </details>;
}

export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const selected = (params.get("ids") || "").split(",").filter(Boolean);
  const leaf = params.get("leaf") || "";
  const back = context(params.get("from"), leaf ? `/types/${leaf}` : "/search");
  const { data, error, retry } = useResource<Comparison>(`/api/compare?${new URLSearchParams({ ids: selected.join(","), leaf })}`);
  useEffect(() => { document.title = "产品比较 · SaaS Grove"; }, []);
  function change(ids: string[]) { const next = new URLSearchParams(params); next.set("ids", ids.join(",")); if (!leaf && data?.leaf) next.set("leaf", data.leaf.slug); setParams(next); }
  const from = location.pathname + location.search;
  return <main id="main" className="page compare-page"><Link className="return-context" to={back}><ArrowLeft size={15} />返回继续选择</Link>
    <div className="discovery-heading"><div><p className="eyebrow">A CLEARER CHOICE</p><h1>把差异，看清楚。</h1><p>{data?.leaf.name_zh || "同类型产品"} · 只比较已有的可核实资料。</p></div><Link className="text-action" to={`/types/${data?.leaf.slug || leaf || CRM}`}>浏览同类产品 <ArrowUpRight size={15} /></Link></div>
    <div className="comparison-legend"><span><i className="legend-confirmed" />已记录并核对的事实</span><span><i className="legend-unknown" />资料未提供 / 未核实</span><span><i className="legend-negative" />明确不支持：仅在有直接依据时标注</span><p>没有记录某项能力，不代表产品不支持。商业产品为基本索引，缺项不用于评价优劣。</p></div>
    {selected.length < 2 ? leaf ? <ComparePicker leaf={leaf} selected={selected} change={() => {}} from={back} expanded /> : <div className="message-card"><h2>先选几个同类产品</h2><p>选择 2–4 个产品，开始一次有依据的比较。</p><Link className="button" to={`/types/${CRM}#compare-picker`}>从 CRM 开始 <ArrowRight size={15} /></Link></div> : error ? <><ErrorState error={error} retry={retry} back={back} />{leaf && <ComparePicker leaf={leaf} selected={[]} change={() => {}} from={back} expanded />}<Link className="text-action" to="/browse">从分类目录重新选择 <ArrowRight size={15} /></Link></> : !data ? <Loading /> : <>
      <p className="quiet-note comparison-hint">小屏幕可在表格内左右滑动，查看所有产品。</p>
      <div className="compare-scroll" role="region" aria-label="产品比较表，可横向滚动" tabIndex={0}><table className="comparison-table"><thead><tr><th scope="col">比较维度</th>{data.products.map(app => <th scope="col" key={app.id}><Tracks app={app} /><Link className="compare-product-name" to={productUrl(app.id, from)}>{app.name}<ArrowUpRight size={16} /></Link><div className="compare-column-actions"><select aria-label={`替换 ${app.name}`} value={app.id} onChange={e => change(selected.map(id => id === app.id ? e.target.value : id))}>{data.candidates.filter(a => a.id === app.id || !selected.includes(a.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><button aria-label={`移除 ${app.name}`} title="移除" onClick={() => change(selected.filter(id => id !== app.id))}><X size={16} /></button></div></th>)}</tr></thead><tbody>
        <tr><th scope="row">主要用途</th>{data.products.map(a => <td key={a.id}>{a.summary || <Unknown />}</td>)}</tr>
        <tr><th scope="row">所属类型</th>{data.products.map(a => <td key={a.id}><Types app={a} /></td>)}</tr>
        <tr><th scope="row">已记录的核心能力</th>{data.products.map(a => <td key={a.id}><Facts values={a.features} />{a.unsupported_features?.map(f => <p className="explicit-limit" key={f.name}>明确不支持：{f.name} <a href={f.source_url} target="_blank" rel="noreferrer">依据 <ExternalLink size={12} /></a></p>)}</td>)}</tr>
        <tr><th scope="row">部署方式</th>{data.products.map(a => <td key={a.id}><Facts values={a.deployment} /></td>)}</tr>
        <tr><th scope="row">技术栈</th>{data.products.map(a => <td key={a.id}><Facts values={a.technology_stack} /></td>)}</tr>
        <tr><th scope="row">许可证与核验</th>{data.products.map(a => <td key={a.id}>{a.license ? <><strong>{a.license}</strong><p className="quiet-note">{a.license_status === "reviewed" ? "已核对许可资料" : "许可资料待核验"}</p>{a.license_review?.rationale && <p>{a.license_review.rationale}</p>}</> : <Unknown />}</td>)}</tr>
        <tr><th scope="row">来源与资料日期</th>{data.products.map(a => <td key={a.id}><Status app={a} /><p>{a.checked_at_basis === "recorded" ? "核对" : "来源采集"} · {date(a.checked_at)}</p><div className="compare-official-links">{a.homepage && <a href={a.homepage} target="_blank" rel="noreferrer">官网 <ArrowUpRight size={13} /></a>}{a.repository_url && <a href={a.repository_url} target="_blank" rel="noreferrer">仓库 <ArrowUpRight size={13} /></a>}<Link to={productUrl(a.id, from)}>全部来源 <ArrowRight size={13} /></Link></div></td>)}</tr>
        <tr><th scope="row">实际部署测试</th>{data.products.map(a => <td key={a.id}>{a.runtime_tested === true ? "已记录部署测试" : a.runtime_tested === false ? "尚未进行部署测试" : <Unknown />}</td>)}</tr>
      </tbody></table></div>
      <ComparePicker leaf={data.leaf.slug} selected={selected} change={() => {}} from={back} />
    </>}
  </main>;
}
