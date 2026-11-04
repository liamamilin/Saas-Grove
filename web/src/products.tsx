import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Code2, Columns3, ExternalLink, Images, Search, X } from "lucide-react";
import { useResource, type Application, type ProductResults, type ProductType } from "./api";
import { DemoActions, ProductLogo, RepositoryFacts, ResourcePanel, ScreenshotGallery } from "./media";
import { SaveButton } from "./saved";
import { PersonalNoteEditor } from "./workspace";

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

export function ProductCard({ app, from, children, primaryType }: { app: Application; from: string; children?: ReactNode; primaryType?: string }) {
  const type = app.types?.find(t => t.slug === primaryType) || app.types?.[0];
  const open = app.tracks?.includes("open_source");
  return <article className="product-card"><div className="product-card-head"><ProductLogo app={app} /><div className="product-card-title"><h2><Link to={productUrl(app.id, from)}>{app.name}<ArrowUpRight size={17} /></Link></h2><Tracks app={app} /></div><SaveButton id={app.id} name={app.name} /></div>
    <p className="product-summary">{app.summary || "简介尚未记录"}</p>{app.catalog_note&&<p className="catalog-note">目录说明：{app.catalog_note.text} <a href={app.catalog_note.url} target="_blank" rel="noreferrer">依据</a></p>}
    <div className="product-tags">{type && <Link className="tag-type" to={`/types/${type.slug}`}>{type.name_zh || type.name}</Link>}{(app.types?.length || 0) > 1 && <span className="tag-more">+{app.types!.length - 1} 类型</span>}<span className="tag-plain">{app.license || (open ? "许可待核实" : "商业基本索引")}</span>{app.resources_curated && <span className="tag-media">{app.screenshot_count ? <><Images size={12} />{app.ui_screenshot_count ? "有界面截图" : "有官方界面图"}</> : "官方资源已整理"}</span>}</div>
    <div className="product-card-bottom"><span className="product-date"><Status app={app} /><span>{app.checked_at_basis === "recorded" ? "核对" : "来源"} {date(app.checked_at)}</span></span><Link to={productUrl(app.id, from)}>了解产品 <ArrowRight size={14} /></Link></div>
    {children}
  </article>;
}

export function SearchPage() {
  const [filtersOpen,setFiltersOpen]=useState(false);
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
  const activeFilters=[
    ["track",params.get("track")&&params.get("track")!=="all"?(params.get("track")==="open_source"?"开源项目":"商业产品"):""],
    ["license",params.get("license")||""],
    ["deployment",({self_hosted:"自托管",docker:"Docker",managed_cloud:"云部署 / 托管服务"} as Record<string,string>)[params.get("deployment")||""]||""],
    ["curated",params.get("curated")==="1"?"已整理官方资源":""],
    ["leaf",params.get("leaf")?data?.applications.flatMap(a=>a.types||[]).find(t=>t.slug===params.get("leaf"))?.name_zh||"指定类型":""]
  ].filter(([,label])=>label);
  function pageUrl(page: number) { const next = new URLSearchParams(params); next.set("page", String(page)); return `/search?${next}`; }
  return <main id="main" className="page discovery-page">
    <div className="discovery-heading"><div><p className="eyebrow">FIND YOUR NEXT SOFTWARE</p><h1>发现值得了解的软件<span className="hero-period">。</span></h1><p>从真实产品出发，了解用途、核对来源，再做选择。</p></div><Link className="text-action" to="/browse">按分类浏览 <ArrowUpRight size={15} /></Link></div>
    <ProductSearchForm initial={q} />
    <div className="mobile-filter-bar"><button className="button" aria-expanded={filtersOpen} aria-controls="product-filter-controls" onClick={()=>setFiltersOpen(!filtersOpen)}>{filtersOpen?"收起筛选":"筛选与排序"}{activeFilters.length?` · ${activeFilters.length} 项`:""}</button><span>筛选保存在当前链接</span></div>
    {!!activeFilters.length&&<div className="active-product-filters" aria-label="已选筛选">{activeFilters.map(([key,label])=><button key={key} onClick={()=>filter(key,"")} aria-label={`移除筛选 ${label}`}>{label}<X size={12}/></button>)}</div>}
    <div id="product-filter-controls" className={`product-filters ${filtersOpen?"is-open":""}`} aria-label="筛选产品">
      <label>产品分区<select aria-label="产品分区" value={params.get("track") || "all"} onChange={e => filter("track", e.target.value)}><option value="all">全部 · 开源优先</option><option value="open_source">开源项目</option><option value="commercial">商业产品</option></select></label>
      <label>许可证<select aria-label="许可证" value={params.get("license") || ""} onChange={e => filter("license", e.target.value)}><option value="">全部许可证</option>{data?.facets.licenses.map(f => <option key={f.value} value={f.value}>{f.value} ({f.count})</option>)}{params.get("license") && !data?.facets.licenses.some(f => f.value === params.get("license")) && <option value={params.get("license")!}>{params.get("license")}</option>}</select></label>
      <label>已记录的部署方式<select aria-label="已记录的部署方式" value={params.get("deployment") || ""} onChange={e => filter("deployment", e.target.value)}><option value="">全部部署方式</option>{data?.facets.deployments.map(f => <option key={f.value} value={f.value}>{f.label} ({f.count})</option>)}{params.get("deployment") && !data?.facets.deployments.some(f => f.value === params.get("deployment")) && <option value={params.get("deployment")!}>{({ self_hosted: "自托管", docker: "Docker", managed_cloud: "云部署 / 托管服务" } as Record<string, string>)[params.get("deployment")!] || params.get("deployment")}</option>}</select></label>
      <label>官方资源<select aria-label="官方资源" value={params.get("curated") || ""} onChange={e => filter("curated", e.target.value)}><option value="">全部产品</option><option value="1">已整理资源与截图{data ? ` (${data.facets.curated})` : ""}</option></select></label>
      <label>排序<select aria-label="排序" value={params.get("sort") || "relevance"} onChange={e => filter("sort", e.target.value)}><option value="relevance">相关性 · 开源优先</option><option value="name">产品名称 A–Z</option><option value="checked">最近资料日期</option></select></label>
      <button className="text-action clear-filters" onClick={() => setParams({})}>重置筛选</button>
    </div>
    <div className="results-caption"><p role="status">{data ? <><strong>{data.total.toLocaleString("zh-CN")}</strong> 个产品{q && <>与“{q}”相关</>}</> : "读取搜索结果…"}</p><span>筛选仅依据已记录资料，缺项不代表不支持</span></div>
    {!!data?.suggested_types?.length && <nav className="type-suggestions" aria-label="相关应用类型"><span>按类型查看</span>{data.suggested_types.map(t => <Link key={t.slug} to={`/types/${t.slug}`}>{t.name_zh || t.name}<small>{t.counts.open_source} 开源 · {t.counts.commercial} 商业</small></Link>)}</nav>}
    {error ? <ErrorState error={error} retry={retry} /> : !data ? <Loading /> : data.total ? <><div className="product-grid">{data.applications.map(app => <ProductCard key={app.id} app={app} from={location.pathname + location.search} primaryType={params.get("leaf")||undefined} />)}</div><nav className="pagination" aria-label="产品搜索分页">{data.page > 1 ? <Link className="button" to={pageUrl(data.page - 1)}><ArrowLeft size={15} />上一页</Link> : <span className="button disabled" aria-disabled="true">上一页</span>}<span>第 {data.page} / {data.pages} 页</span>{data.page < data.pages ? <Link className="button" to={pageUrl(data.page + 1)}>下一页<ArrowRight size={15} /></Link> : <span className="button disabled" aria-disabled="true">下一页</span>}</nav></> : <div className="message-card"><Search size={30} /><h2>没有找到匹配的产品</h2><p>尝试产品英文名、更短的用途关键词，或减少筛选条件。</p><button className="button" onClick={() => setParams({})}>查看全部产品</button><Link to={`/browse?${new URLSearchParams({ q })}`}>也可以搜索应用类型</Link></div>}
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
  const homepage = app.resource_profile?.resources.find(r => r.type === "homepage")?.url || app.homepage;
  return <main id="main" className="page product-page">
    <Link className="return-context" to={back}><ArrowLeft size={15} />{back.startsWith("/shortlist") ? "返回候选清单" : back.startsWith("/types/") ? "返回应用类型" : back.startsWith("/compare") ? "返回产品比较" : "返回产品搜索"}</Link>
    <header className="product-header"><div><div className="product-identity"><ProductLogo app={app} size="large" /><div><p className="eyebrow">SOFTWARE, WITH SOURCES</p><Tracks app={app} /><h1>{app.name}</h1></div></div><p className="product-lede">{app.summary || "简介尚未记录"}</p>
      {comparisonType && <p className="product-place">所属类型 <Link to={`/types/${comparisonType.slug}`}>{comparisonType.name_zh || comparisonType.name}<ArrowUpRight size={13} /></Link>{(app.types?.length || 0) > 1 && <a href="#types">另有 {app.types!.length - 1} 个类型</a>}</p>}
      <div className="product-actions"><SaveButton id={app.id} name={app.name} />{homepage && <a className="button primary-button" href={homepage} target="_blank" rel="noreferrer">访问官网 <ArrowUpRight size={16} /></a>}{open && app.repository_url && <a className="button" href={app.repository_url} target="_blank" rel="noreferrer"><Code2 size={16} />代码仓库 <ArrowUpRight size={14} /></a>}<DemoActions app={app} />{comparisonType && <Link className="text-action" to={`/types/${comparisonType.slug}?${new URLSearchParams({ compare: app.id, from })}#compare-picker`}><Columns3 size={16} />与同类产品比较</Link>}</div></div>
      <aside className="product-proof"><p className="eyebrow">RESEARCH NOTE</p><EvidenceNote app={app} /><p className="product-date">{app.checked_at_basis === "recorded" ? "最近资料核对" : "最近来源采集"} · {date(app.checked_at)}</p><RepositoryFacts app={app} /></aside></header>
    <ScreenshotGallery app={app} />
    <div className="product-reading"><div className="product-main-reading">
      <ResourcePanel app={app} />
      {open && <section className="reading-section"><p className="eyebrow">WHAT IT DOES</p><h2>核心能力</h2><Facts values={app.features} />{!!app.unsupported_features?.length && <div className="explicit-limit"><h3>有明确证据的不支持</h3>{app.unsupported_features.map(f => <p key={f.name}>{f.name} <a href={f.source_url} target="_blank" rel="noreferrer">依据 <ExternalLink size={12} /></a></p>)}</div>}<p className="quiet-note">仅列出已记录的能力与边界，未列出不代表不支持。</p></section>}
      <section className="reading-section" id="types"><p className="eyebrow">WHERE IT FITS</p><h2>所属应用类型</h2><Types app={app} />{!open && <p className="quiet-note">商业产品保留基本索引，深入能力、技术与部署信息尚未核对。</p>}</section>
      <section className="reading-section"><p className="eyebrow">FOLLOW THE EVIDENCE</p><h2>资料来源</h2><Sources app={app} /></section>
    </div>{open && <aside className="product-side-reading"><section className="reading-section"><p className="eyebrow">UNDER THE HOOD</p><h2>技术与部署</h2><h3>技术栈</h3><Facts values={app.technology_stack} /><h3>部署方式</h3><Facts values={app.deployment} /></section><section className="reading-section"><p className="eyebrow">LICENSE</p><h2>{app.license || "许可证待核实"}</h2><span className={`badge ${app.license_status === "reviewed" ? "open-badge" : "conditional"}`}>{app.license_status === "reviewed" ? "已核对许可资料" : "许可资料待核验"}</span>{app.license_review?.rationale && <p className="license-rationale">{app.license_review.rationale}</p>}{(app.license_evidence_url || app.license_review?.source_url) && <a className="text-action" href={app.license_evidence_url || app.license_review?.source_url} target="_blank" rel="noreferrer">查看许可依据 <ArrowUpRight size={14} /></a>}</section></aside>}</div>
    {comparisonType && <SimilarProducts app={app} initial={app.types?.find(t => t.slug === contextLeaf) || [...(app.types || [])].sort((a, b) => (b.product_count || 0) - (a.product_count || 0))[0] || comparisonType} from={from} />}
    {app.catalog_note&&<aside className="catalog-note">目录说明：{app.catalog_note.text} <a href={app.catalog_note.url} target="_blank" rel="noreferrer">官方依据</a></aside>}
    <section className="product-personal"><PersonalNoteEditor id={app.id} name={app.name} /></section>
    {comparisonType && <section className="next-step"><div><p className="eyebrow">KEEP EXPLORING</p><h2>把选择放在一起看。</h2><p>从同一类型中选择 2–4 个产品，比较已有资料。</p></div><Link className="button" to={`/types/${comparisonType.slug}?${new URLSearchParams({ compare: app.id, from })}#compare-picker`}>选择比较对象 <ArrowRight size={16} /></Link></section>}
  </main>;
}

function SimilarProducts({ app, initial, from }: { app: Application; initial: ProductType; from: string }) {
  // Sibling details return to the same place this product came from, so `from` never nests.
  const back = context(new URLSearchParams(from.split("?")[1] || "").get("from"));
  const [slug, setSlug] = useState(initial.slug);
  useEffect(() => { setSlug(initial.slug); }, [app.id, initial.slug]);
  const type = app.types?.find(t => t.slug === slug) || initial;
  const { data, error, retry } = useResource<ProductResults>(`/api/products?${new URLSearchParams({ leaf: type.slug, exclude: app.id, page_size: "6" })}`);
  return <section className="similar-products" aria-label="同类型其他产品"><div className="similar-heading"><div><p className="eyebrow">ALSO IN THIS TYPE</p><h2>同类型的其他选择</h2></div><Link className="text-action" to={`/types/${type.slug}`}>查看“{type.name_zh || type.name}”全部产品 <ArrowRight size={14} /></Link></div>
    {(app.types?.length || 0) > 1 && <div className="similar-types" role="group" aria-label="选择应用类型">{app.types!.slice(0, 6).map(t => <button key={t.slug} type="button" aria-pressed={t.slug === type.slug} onClick={() => setSlug(t.slug)}>{t.name_zh || t.name}{t.product_count !== undefined && <span>{Math.max(0, t.product_count - 1)}</span>}</button>)}</div>}
    {error ? <ErrorState error={error} retry={retry} /> : !data ? <Loading /> : data.applications.length ? <div className="similar-grid">{data.applications.map(other => <article className="similar-card" key={other.id}><ProductLogo app={other} size="small" /><div><h3><Link to={productUrl(other.id, back)}>{other.name}</Link></h3><Tracks app={other} /><p>{other.summary || "简介尚未记录"}</p></div><SaveButton id={other.id} name={other.name} /></article>)}</div> : <p className="quiet-note">这个类型暂时没有其他已收录产品。</p>}
    {!!data?.applications.length && <p className="similar-foot">{data.total > data.applications.length ? `共 ${data.total} 个同类产品，开源优先显示前 ${data.applications.length} 个。` : `共 ${data.total} 个同类产品。`}<Link to={`/types/${type.slug}?${new URLSearchParams({ compare: app.id, from })}#compare-picker`}>和它们一起比较 <Columns3 size={13} /></Link></p>}
  </section>;
}

export function CuratedShowcase() {
  const { data } = useResource<ProductResults>(`/api/products?${new URLSearchParams({ curated: "1", page_size: "12", sort: "name" })}`);
  if (!data?.applications.length) return null;
  return <section className="curated-showcase" aria-label="已整理界面与资源的产品"><div className="showcase-heading"><div><p className="eyebrow">SEE REAL PRODUCTS</p><h2>先看看真实界面</h2></div><Link className="text-action" to="/search?curated=1">全部 {data.total} 个已整理产品 <ArrowRight size={14} /></Link></div>
    <div className="showcase-row">{data.applications.map(app => <Link className="showcase-item" key={app.id} to={productUrl(app.id, "/")}><ProductLogo app={app} /><span><strong>{app.name}</strong><small>{app.types?.[0]?.name_zh || app.types?.[0]?.name || "应用"}{app.screenshot_count ? ` · ${app.screenshot_count} 张界面图` : ""}</small></span></Link>)}</div>
  </section>;
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
