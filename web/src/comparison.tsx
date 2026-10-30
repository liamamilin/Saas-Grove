import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ArrowUpRight, ExternalLink, X } from "lucide-react";
import { useResource, type Application, type Comparison, type EvidenceCell } from "./api";
import { ComparePicker, productUrl } from "./products";
import { PersonalNoteEditor, SaveComparisonForm } from "./workspace";
const CRM="customer-relationship-management-crm";
const DIMENSIONS = [["purpose","主要用途"],["openness","开源情况"],["types","所属类型"],["crm","CRM 关键能力"],["features","核心能力原记录"],["deployment","部署方式"],["technology","技术栈"],["license","许可证"],["sources","来源与日期"],["runtime","部署实测"]];
const unknown=<span className="unknown-fact">资料未提供 / 未核实</span>;
const list=(v?:string[])=>v?.length?<ul className="fact-list">{v.map((s,i)=><li key={i}>{s}</li>)}</ul>:unknown;
const date=(v?:string)=>v?.slice(0,10)||"未记录日期";
function SourceLinks({app,kind}: {app:Application;kind?:string}) {
  const sources=kind==="license"?[app.license_evidence_url||app.license_review?.source_url].filter(Boolean):[...new Set((app.sources||[]).filter(s=>!kind||s.kind===kind).map(s=>s.url))];
  return <div className="fact-evidence">{sources.length?<details><summary>查看{kind==="license"?"许可":"已有"}来源</summary>{sources.map((url,i)=><a key={url} href={url} target="_blank" rel="noreferrer">依据 {i+1} · 来源<ExternalLink size={11}/></a>)}{kind!=="license"&&<small>来源清单未逐条绑定到本行断言；CRM 专项依据另列。</small>}</details>:<span className="quiet-note">来源未记录</span>}</div>;
}
function Evidence({cell}: {cell:EvidenceCell}) {
  return cell.status!=="recorded"?unknown:<><p>{cell.value}</p><details className="fact-evidence"><summary>查看本项依据</summary>{cell.sources.map(s=><div key={s.sha256}><a href={s.url} target="_blank" rel="noreferrer">官方来源 <ExternalLink size={11}/></a><blockquote>{s.quote}</blockquote><small>来源采集 {date(s.fetched_at)} · 未部署实测</small></div>)}</details></>;
}
type Cell={value:unknown;content:ReactNode};
type Row={key:string;dimension:string;label:string;cells:Cell[];foldable?:boolean};
function same(row:Row) { const values=row.cells.map(c=>c.value);return row.foldable!==false&&values.every(v=>v!==null)&&values.every(v=>JSON.stringify(v)===JSON.stringify(values[0])); }
export function ComparePage() {
  const [params,setParams]=useSearchParams();const location=useLocation();
  const selected=(params.get("ids")||"").split(",").filter(Boolean),leaf=params.get("leaf")||"";
  const inputBack=params.get("from");const back=inputBack?.startsWith("/")&&!inputBack.startsWith("//")?inputBack:leaf?`/types/${leaf}`:"/shortlist";
  const {data,error,retry}=useResource<Comparison>(`/api/compare?${new URLSearchParams({ids:selected.join(","),leaf})}`);
  useEffect(()=>{document.title="产品比较 · SaaS Grove";},[]);
  const dimensionKey=params.get("dims");
  const readDimensions=()=>dimensionKey===null?DIMENSIONS.map(([k])=>k):dimensionKey.split(",").filter(v=>DIMENSIONS.some(([k])=>k===v));
  const [dimensions,setDimensions]=useState(readDimensions);
  useEffect(()=>{setDimensions(readDimensions());},[dimensionKey]);
  const showSame=params.get("same")==="1";
  function view(key:string,value:string) {const next=new URLSearchParams(params);next.set(key,value);setParams(next,{replace:true});}
  function change(ids:string[]) {const next=new URLSearchParams(params);next.set("ids",ids.join(","));if(data)next.set("leaf",data.leaf.slug);setParams(next);}
  const from=location.pathname+location.search;
  const rows:Row[]=[];
  if(data) {
    const apps=data.products;
    const row=(key:string,label:string,fn:(a:Application)=>Cell,foldable=true)=>rows.push({key,dimension:key,label,cells:apps.map(fn),foldable});
    row("purpose","主要用途",a=>({value:a.summary||null,content:a.summary||unknown}));
    row("openness","开源情况",a=>({value:a.tracks?.length?[...a.tracks].sort():null,content:a.tracks?.map(t=>t==="open_source"?"开源项目":"商业产品").join(" / ")||unknown}));
    row("types","所属类型",a=>({value:a.types?.length?a.types.map(t=>t.slug).sort():null,content:<div className="type-links">{a.types?.map(t=><Link key={t.slug} to={`/types/${t.slug}`}>{t.name_zh||t.name}</Link>)}</div>}));
    for(const r of data.crm_rows||[])rows.push({key:`crm-${r.key}`,dimension:"crm",label:r.label,cells:r.cells.map(c=>({value:c.status==="recorded"?c.value:null,content:<Evidence cell={c}/>}))});
    row("features","已记录的核心能力",a=>({value:a.features?.length?[[...a.features].sort(),a.unsupported_features||[]]:null,content:<>{list(a.features)}{a.unsupported_features?.map(f=><p className="explicit-limit" key={f.name}>明确不支持：{f.name} <a href={f.source_url} target="_blank" rel="noreferrer">依据</a></p>)}<SourceLinks app={a}/></>}));
    row("deployment","部署方式",a=>({value:a.deployment?.length?[...a.deployment].sort():null,content:<>{list(a.deployment)}{!!a.deployment?.length&&<SourceLinks app={a} kind="readme"/>}</>}));
    row("technology","技术栈",a=>({value:a.technology_stack?.length?[...a.technology_stack].sort():null,content:<>{list(a.technology_stack)}{!!a.technology_stack?.length&&<SourceLinks app={a}/>}</>}));
    row("license","许可证与核验",a=>({value:a.license&&a.license_status==="reviewed"?[a.license,a.license_status,a.license_review?.rationale||""]:null,content:a.license?<><strong>{a.license}</strong><p>{a.license_status==="reviewed"?"已核对许可资料":"许可资料待核验"}</p>{a.license_review?.rationale&&<p>{a.license_review.rationale}</p>}<SourceLinks app={a} kind="license"/></>:unknown}));
    row("sources","来源与资料日期",a=>({value:a.sources?.length?a.sources.map(s=>s.url).sort():null,content:<><p>{a.verification_status==="official_sources_reviewed"?"官方资料已核对":"资料待核对"}</p><p>{a.checked_at_basis==="recorded"?"核对":"来源采集"} · {date(a.checked_at)}</p><SourceLinks app={a}/><Link to={productUrl(a.id,from)}>全部来源 <ArrowRight size={13}/></Link></>}),false);
    row("runtime","实际部署测试",a=>({value:a.runtime_tested??null,content:a.runtime_tested===true?"已记录部署测试":a.runtime_tested===false?"尚未进行部署测试":unknown}),false);
  }
  const focused=rows.filter(r=>dimensions.includes(r.dimension)), equal=focused.filter(same),visible=focused.filter(r=>showSame||!same(r));
  return <main id="main" className="page compare-page"><Link className="return-context" to={back}><ArrowLeft size={15}/>返回继续选择</Link><div className="discovery-heading"><div><p className="eyebrow">A CLEARER CHOICE</p><h1>把差异，看清楚。</h1><p>{data?.leaf.name_zh||"同类型产品"} · 只比较已有的可核实资料。</p></div><Link className="text-action" to={`/types/${data?.leaf.slug||leaf||CRM}`}>浏览同类产品 <ArrowUpRight size={15}/></Link></div>
    <div className="comparison-legend"><span><i className="legend-confirmed"/>已记录并核对的事实</span><span><i className="legend-unknown"/>资料未提供 / 未核实</span><span><i className="legend-negative"/>明确不支持：仅在有直接依据时标注</span><p>没有记录某项能力，不代表产品不支持。商业产品为基本索引，缺项不用于评价优劣。</p></div>
    {selected.length<2?leaf?<ComparePicker leaf={leaf} selected={selected} change={()=>{}} from={back} expanded/>:<div className="message-card"><h2>先选几个同类产品</h2><Link to={`/types/${CRM}#compare-picker`}>从 CRM 开始</Link></div>:error?<div className="message-card error" role="alert"><h2>暂时无法读取产品资料</h2><p>{error}</p><button className="button" onClick={retry}>重新加载</button><Link to={back}>返回调整选择</Link>{leaf&&<ComparePicker leaf={leaf} selected={[]} change={()=>{}} from={back} expanded/>}</div>:!data?<div className="loading-box" role="status">正在读取产品资料…</div>:<>
    <section className="comparison-focus" aria-label="比较关注维度"><div><h2>这次关注什么？</h2><p>勾选关注维度。相同仅指记录值一致，不代表产品等价；缺失资料始终保留为未知。</p></div><div className="dimension-options">{DIMENSIONS.filter(([key])=>key!=="crm"||!!data.crm_rows?.length).map(([key,label])=><label key={key}><input type="checkbox" checked={dimensions.includes(key)} onChange={e=>{const next=e.target.checked?[...dimensions,key]:dimensions.filter(d=>d!==key);setDimensions(next);view("dims",next.join(","));}}/>{label}</label>)}</div><button className="text-action" aria-pressed={showSame} onClick={()=>view("same",showSame?"0":"1")}>{showSame?"收起":"展开"}相同记录（{equal.length} 项）</button></section>
    <p className="quiet-note comparison-hint">小屏幕可在表格内左右滑动，查看所有产品。标签“记录有差异”只说明记录内容不同，不是能力评分。</p>
    <div className="compare-scroll" role="region" aria-label="产品比较表，可横向滚动" tabIndex={0}><table className="comparison-table"><thead><tr><th scope="col">比较维度</th>{data.products.map(app=><th scope="col" key={app.id}><span className="badge">{app.tracks?.includes("open_source")?"开源项目":"商业产品"}</span><Link className="compare-product-name" to={productUrl(app.id,from)}>{app.name}<ArrowUpRight size={16}/></Link><div className="compare-column-actions"><select aria-label={`替换 ${app.name}`} value={app.id} onChange={e=>change(selected.map(id=>id===app.id?e.target.value:id))}>{data.candidates.filter(a=>a.id===app.id||!selected.includes(a.id)).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select><button aria-label={`移除 ${app.name}`} title="移除" onClick={()=>change(selected.filter(id=>id!==app.id))}><X size={16}/></button></div></th>)}</tr></thead><tbody>{visible.map(r=>{const known=r.cells.filter(c=>c.value!==null);const differs=new Set(known.map(c=>JSON.stringify(c.value))).size>1;return <tr key={r.key} data-dimension={r.key} className={differs?"different-records":""}><th scope="row">{r.label}{differs&&<small className="difference-label">记录有差异</small>}{r.cells.some(c=>c.value===null)&&<small className="unknown-label">含未核实资料</small>}</th>{r.cells.map((c,i)=><td key={data.products[i].id}>{c.content}</td>)}</tr>;})}{!visible.length&&<tr><td colSpan={data.products.length+1}>当前没有展开的维度，请勾选关注维度或展开相同记录。</td></tr>}</tbody></table></div>
    <section className="comparison-personal"><p className="eyebrow">YOUR OWN VIEW</p><h2>个人判断，单独留下。</h2><p className="quiet-note">以下内容只属于你的选型记录，不修改上方官方资料。取消收藏不会删除备注。</p><div className="personal-note-grid">{data.products.map(app=><div key={app.id}><h3>{app.name}</h3><PersonalNoteEditor id={app.id} name={app.name}/></div>)}</div></section>
    <SaveComparisonForm value={{leaf:data.leaf.slug,ids:data.products.map(p=>p.id),dimensions,show_same:showSame}} savedId={params.get("saved")||""} onSaved={id=>view("saved",id)}/>
    <ComparePicker leaf={data.leaf.slug} selected={selected} change={()=>{}} from={back}/></>}
  </main>;
}
