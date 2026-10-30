import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowRight, Bookmark, Columns3, X } from "lucide-react";
import type { Application, ProductType } from "./api";
import { ProductCard } from "./products";
import { useSaved } from "./saved";
import { PersonalNoteEditor, SavedComparisons } from "./workspace";

type Lookup = { applications: Application[]; missing_ids: string[] };
function useSavedCatalog(ids: string[]) {
  const key = JSON.stringify(ids);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; data?: Lookup; error?: string }>({ key: "" });
  useEffect(() => {
    const controller = new AbortController();
    const values: string[] = JSON.parse(key);
    if (!values.length) { setState({ key, data: { applications: [], missing_ids: [] } }); return; }
    setState({ key });
    const chunks = Array.from({ length: Math.ceil(values.length / 40) }, (_, i) => values.slice(i * 40, (i + 1) * 40));
    Promise.all(chunks.map(async chunk => {
      const response = await fetch(`/api/products/lookup?${new URLSearchParams({ ids: chunk.join(",") })}`, { signal: controller.signal });
      let value: Lookup & { error?: string };
      try { value = await response.json(); }
      catch { throw new Error("暂时无法读取收藏产品，请稍后重试。"); }
      if (!response.ok) throw new Error(value.error || "暂时无法读取收藏产品");
      return value as Lookup;
    })).then(results => {
      if (!controller.signal.aborted) setState({ key, data: { applications: results.flatMap(r => r.applications), missing_ids: results.flatMap(r => r.missing_ids) } });
    }).catch((error: Error) => { if (!controller.signal.aborted) setState({ key, error: error instanceof TypeError ? "暂时无法连接本地服务，请确认服务已启动后重试。" : error.message }); });
    return () => controller.abort();
  }, [key, revision]);
  return { data: state.key === key ? state.data : undefined, error: state.key === key ? state.error : undefined, retry: () => setRevision(value => value + 1) };
}

export function ShortlistPage() {
  const { items, remove } = useSaved();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { data, error, retry } = useSavedCatalog(items.map(item => item.id));
  const selectionKey = params.get("compare") || "";
  const [draft, setDraft] = useState<string[]>(() => selectionKey.split(",").filter(Boolean));
  useEffect(() => { setDraft(selectionKey.split(",").filter(Boolean)); }, [selectionKey]);
  useEffect(() => { document.title = "我的候选清单 · SaaS Grove"; }, []);
  const type = params.get("type") || "", track = params.get("track") || "all";
  const apps = data?.applications || [];
  const byId = new Map(apps.map(app => [app.id, app]));
  const savedIds = new Set(items.map(item => item.id));
  const selected = [...new Set(draft)].filter(id => savedIds.has(id) && byId.has(id)).slice(0, 4);
  const typeRefs = new Map<string, ProductType>();
  const typeCounts = new Map<string, number>();
  for (const app of apps) for (const t of app.types || []) { typeRefs.set(t.slug, t); typeCounts.set(t.slug, (typeCounts.get(t.slug) || 0) + 1); }
  const groups = [...typeRefs.values()].sort((a, b) => (a.name_zh || a.name).localeCompare(b.name_zh || b.name, "zh-CN"));
  const common = selected.length ? (byId.get(selected[0])?.types || []).filter(t => selected.every(id => byId.get(id)?.types?.some(other => other.slug === t.slug))) : [];
  const comparisonType = common.find(t => t.slug === params.get("comparison_type")) || common.find(t => t.slug === type) || common[0];
  const visible = apps.filter(app => (!type || app.types?.some(t => t.slug === type)) && (track === "all" || app.tracks?.some(t => t === track)));
  const savedAt = new Map(items.map(item => [item.id, item.saved_at]));
  function select(ids: string[]) {
    setDraft(ids);
    const next = new URLSearchParams(params); if (ids.length) next.set("compare", ids.join(",")); else next.delete("compare"); next.delete("comparison_type");
    setParams(next, { replace: true });
  }
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key === "type") { next.delete("compare"); next.delete("comparison_type"); setDraft([]); }
    setParams(next);
  }
  const returnParams = new URLSearchParams(params);
  if (selected.length) returnParams.set("compare", selected.join(",")); else returnParams.delete("compare");
  const compareUrl = comparisonType ? `/compare?${new URLSearchParams({ leaf: comparisonType.slug, ids: selected.join(","), from: `/shortlist?${returnParams}` })}` : "";
  return <main id="main" className="page discovery-page shortlist-page">
    <div className="discovery-heading"><div><p className="eyebrow">YOUR NEXT POSSIBILITIES</p><h1>我的候选清单<span className="hero-period">。</span></h1><p>把值得了解的产品先留下，再一起比较。收藏仅保存在当前浏览器。</p></div><Link className="text-action" to="/search">继续发现产品 <ArrowRight size={15} /></Link></div>
    <SavedComparisons />
    {!items.length ? <div className="message-card shortlist-empty"><Bookmark size={32} /><h2>把第一个选择留在这里</h2><p>在搜索结果或产品详情页点击“收藏”，就能在这里找到它。</p><Link className="button primary-button" to="/search">去发现产品 <ArrowRight size={16} /></Link></div> : error ? <div className="message-card error" role="alert"><h2>收藏产品暂时没有加载成功</h2><p>{error}</p><p>本地收藏记录仍然保留。</p><button className="button" onClick={retry}>重新加载收藏</button></div> : !data ? <div className="loading-box" role="status"><span className="loading-dot" />正在读取收藏产品…</div> : <>
      <div className="shortlist-filters"><p><strong>{items.length}</strong> 个收藏 · 当前显示 {visible.length} 个</p><label>应用类型<select aria-label="清单应用类型" value={type} onChange={e => filter("type", e.target.value)}><option value="">全部类型</option>{groups.map(t => <option key={t.slug} value={t.slug}>{t.name_zh || t.name} ({typeCounts.get(t.slug)})</option>)}</select></label><label>产品分区<select aria-label="清单产品分区" value={track} onChange={e => filter("track", e.target.value)}><option value="all">开源与商业</option><option value="open_source">开源项目</option><option value="commercial">商业产品</option></select></label></div>
      <section className="shortlist-comparison" aria-label="清单比较选择"><div className="shortlist-comparison-top"><h2><Columns3 size={19} />选择同类产品比较</h2><span>{selected.length} / 4 已选</span></div>
        {selected.length ? <div className="shortlist-selection">{selected.map(id => <button key={id} type="button" aria-label={`移除比较选择 ${byId.get(id)!.name}`} onClick={() => select(selected.filter(value => value !== id))}>{byId.get(id)!.name}<X size={13} /></button>)}<button className="text-action" onClick={() => select([])}>清除比较选择</button></div> : null}
        <div className="shortlist-comparison-actions"><p>{!selected.length ? "先选一个产品，再选择与它有共同应用类型的产品。" : !comparisonType ? "所选产品暂无共同的可比较类型，请调整选择。" : selected.length < 2 ? "再选择至少 1 个同类产品，即可开始比较。" : `按“${comparisonType.name_zh || comparisonType.name}”比较，只使用已有可核实资料。`}</p>{common.length > 1 && <label className="shortlist-common-type">本次比较类型<select aria-label="本次比较类型" value={comparisonType?.slug || ""} onChange={e => filter("comparison_type", e.target.value)}>{common.map(t => <option key={t.slug} value={t.slug}>{t.name_zh || t.name}</option>)}</select></label>}{selected.length >= 2 && comparisonType ? <Link className="button primary-button" to={compareUrl}>开始比较 <ArrowRight size={15} /></Link> : <button className="button" disabled>开始比较</button>}</div>
      </section>
      {!!data.missing_ids.length && <div className="missing-saved"><h2>有 {data.missing_ids.length} 个收藏暂时无法找到</h2><p>记录仍保留在本地，可能是目录尚未载入或产品已调整。</p>{data.missing_ids.map(id => <div key={id}><code>{id}</code><button className="text-action" aria-label={`移除失效收藏 ${id}`} onClick={() => remove(id)}>移除这条收藏 <X size={13} /></button></div>)}</div>}
      {visible.length ? <div className="product-grid shortlist-grid">{visible.map(app => {
        const checked = selected.includes(app.id);
        const savedTime = new Date(savedAt.get(app.id) || "");
        const validTime = Number.isFinite(savedTime.getTime());
        const compatible = !selected.length || app.types?.some(t => common.some(c => c.slug === t.slug));
        const reason = checked ? "" : !app.types?.length ? "尚无可比较类型" : !checked && selected.length >= 4 ? "最多选择 4 个产品" : !checked && !compatible ? "与已选产品没有共同类型" : "";
        return <div className={`shortlist-entry ${checked ? "selected" : ""}`} key={app.id}><ProductCard app={app} from={location.pathname + location.search}>
          <div className="shortlist-card-choice"><label><input type="checkbox" aria-label={`选择比较 ${app.name}`} checked={checked} disabled={!!reason} onChange={e => select(e.target.checked ? [...selected, app.id] : selected.filter(id => id !== app.id))} /><span>加入本次比较</span></label>{reason && <small>{reason}</small>}<time dateTime={validTime ? savedAt.get(app.id) : undefined}>收藏于 {validTime ? savedTime.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }) : "时间未记录"}</time></div>
          <PersonalNoteEditor id={app.id} name={app.name} />
        </ProductCard></div>;
      })}</div> : <div className="message-card"><h2>当前筛选下没有可显示的产品</h2><button className="button" onClick={() => { setDraft([]); setParams({}); }}>查看全部收藏</button></div>}
    </>}
  </main>;
}
