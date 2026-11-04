import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ExternalLink, Plus } from "lucide-react";
import { useResource, type Application, type Comparison, type EvidenceCell } from "./api";
import { useSaved } from "./saved";
import { type SavedComparison } from "./local-data";
import { CRM, CRM_CHECKS, createTrial, currentResult, evidenceUrl, latestResult, trialProgress, trialNames, trialLabel,
  type TrialCheck, type TrialDecision, type TrialMethod, type TrialPlan, type TrialResult, type TrialStatus } from "./trial-data";

const statusNames:Record<TrialStatus,string>={pending:"待验证",passed:"通过",failed:"未通过",na:"不适用"};
const methodNames={documentation:"资料核对",hands_on:"实际操作"};
const now=()=>new Date().toISOString();
const today=()=>new Date().toLocaleDateString("sv-SE");
const date=(v:string)=>new Date(v).toLocaleString("zh-CN");
const comparePath=(p:TrialPlan)=>`/compare?${new URLSearchParams({leaf:p.leaf,ids:p.ids.join(","),from:`/trials/${p.id}`})}`;
const emptyRecord=(product:string,c:TrialCheck):TrialResult=>({id:"",product_id:product,check_id:c.id,check_title:c.title,criterion:c.criterion,status:"pending",method:"",version:"",environment:"",tested_on:today(),notes:"",evidence_url:"",image_data:"",updated_at:""});

export function TrialStarter({comparison}:{comparison:SavedComparison}) {
  const [open,setOpen]=useState(false);
  if(comparison.leaf!==CRM)return null;
  return <div className="trial-starter"><button className="text-action" type="button" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?"收起试用计划设置":"从这次比较生成试用清单"}<ArrowRight size={14}/></button>{open&&<TrialCreateForm comparison={comparison}/>}</div>;
}
function TrialCreateForm({comparison}:{comparison:SavedComparison}) {
  const {saveTrial,saving}=useSaved();const navigate=useNavigate();
  const {data,error,retry}=useResource<Comparison>(`/api/compare?${new URLSearchParams({ids:comparison.ids.join(","),leaf:comparison.leaf})}`);
  const [name,setName]=useState(`${comparison.name.slice(0,110)} · 试用`),[goal,setGoal]=useState("");
  const [chosen,setChosen]=useState(CRM_CHECKS.map(c=>c.dimension)),[message,setMessage]=useState("");
  async function submit(e:FormEvent){e.preventDefault();if(!data||!name.trim()||!goal.trim()||!chosen.length)return;
    const plan=createTrial(comparison,name,goal,CRM_CHECKS.filter(c=>chosen.includes(c.dimension)).map(c=>({...c,required:true,active:true})),data.products.map(a=>({id:a.id,name:a.name})));
    if(await saveTrial(plan))navigate(`/trials/${plan.id}`);else setMessage("计划未保存，现有个人记录保持不变。");}
  return <form className="trial-create" onSubmit={submit}><h3>把比较变成待验证的清单</h3><p className="personal-label">生成后所有项目均为待验证，不自动填入“通过”。</p>
    {error?<p role="alert">{error} <button type="button" className="text-action" onClick={retry}>重新读取候选</button></p>:!data?<p role="status">正在核对已保存的候选…</p>:<p>本次候选：{data.products.map(p=>p.name).join(" / ")}</p>}
    <label>试用计划名称<input aria-label="试用计划名称" required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>这次要解决什么问题？<textarea aria-label="这次要解决什么问题？" required maxLength={5000} rows={2} value={goal} onChange={e=>setGoal(e.target.value)} placeholder="例如：为小团队管理客户与商机，核实 API、导出及扩展成本。"/></label>
    <fieldset className="trial-template"><legend>先验证这些事项，生成后可以修改要求</legend>{CRM_CHECKS.map(c=><label key={c.dimension}><input type="checkbox" checked={chosen.includes(c.dimension)} onChange={e=>setChosen(e.target.checked?[...chosen,c.dimension]:chosen.filter(k=>k!==c.dimension))}/>{c.title}</label>)}</fieldset>
    <button className="button primary-button" type="submit" disabled={saving||!data||!name.trim()||!goal.trim()||!chosen.length}>生成个人试用清单</button><p role="status">{saving?"正在保存…":message}</p>
  </form>;
}

export function TrialPlans() {
  const {trials,deleteTrial,saving}=useSaved();const [deleteError,setDeleteError]=useState("");
  return <section className="trial-plans"><div className="local-section-heading"><div><p className="eyebrow">TRY BEFORE YOU DECIDE</p><h2>试用与最终选择 <span>{trials.length}</span></h2></div></div>
    {!trials.length?<p className="quiet-note">先保存一次 CRM 比较，再生成试用清单。<Link to={`/compare?leaf=${CRM}&ids=github%3A572984571,github%3A24459441&from=%2Fshortlist`}>从 Twenty 与 EspoCRM 开始 <ArrowRight size={13}/></Link></p>:<div className="trial-plan-list">{trials.map(p=><article key={p.id}><div><Link to={`/trials/${p.id}`}>{p.name}<ArrowRight size={15}/></Link><p>{p.ids.length} 个候选 · {p.checks.filter(c=>c.active).length} 个检查项 · {p.decisions.length?"已留下个人选择":"尚未留下最终选择"}</p><p>{p.goal}</p><small>更新于 {date(p.updated_at)}</small></div><button className="text-action" disabled={saving} aria-label={`删除试用计划 ${p.name}`} onClick={async()=>{setDeleteError("");if(window.confirm(`删除“${p.name}”及其全部验证记录、截图和选择历史？建议先从本地备份导出，删除后无法撤销。`)){if(!await deleteTrial(p.id))setDeleteError("试用计划未删除，原计划及全部历史保持不变，请检查本地存储后重试。");}}}>删除计划</button></article>)}</div>}
    {deleteError&&<p role="alert">{deleteError}</p>}
  </section>;
}

function OfficialReference({app,cell,from}:{app:Application;cell?:EvidenceCell;from:string}) {
  return <aside className="trial-official"><strong>官方资料参考</strong><p className="quiet-note">以下来自目录资料，不是你的试用结果。</p>{cell&&cell.status!=="unknown"?<><p>{cell.status==="unsupported"&&"明确限制："}{cell.value}</p><details><summary>查看官方依据</summary>{cell.sources.map((s,i)=><div key={`${s.sha256}-${i}`}><a href={s.url} target="_blank" rel="noreferrer">官方来源 <ExternalLink size={11}/></a><blockquote>{s.quote}</blockquote><small>来源采集 {s.fetched_at.slice(0,10)||"日期未记录"}</small></div>)}</details></>:<p>这项能力的专项资料未提供 / 未核实，请自行验证。</p>}
    <Link to={`/products/${encodeURIComponent(app.id)}?${new URLSearchParams({from})}`}>查看产品资料与全部来源 <ArrowRight size={12}/></Link></aside>;
}
function ResultHistory({records,plan,names}:{records:TrialResult[];plan:TrialPlan;names:Map<string,string>}) {
  if(!records.length)return null;
  return <details className="trial-history"><summary>查看验证历史（{records.length} 条）</summary>{records.map(r=><div key={r.id}><p>候选：{trialLabel(plan,r.product_id,names)}</p><strong>{statusNames[r.status]}{r.method&&` · ${methodNames[r.method]}`}</strong><small>{date(r.updated_at)}</small><p>{r.check_title} · 当时要求：{r.criterion}</p><p>版本：{r.version||"未记录"} · 条件：{r.environment||"未记录"} · 验证日期：{r.tested_on||"未记录"}</p><p className="personal-text">{r.notes||"未补充说明"}</p>{r.evidence_url&&<a href={r.evidence_url} target="_blank" rel="noreferrer">当时记录的证据链接</a>}{r.image_data&&<details><summary>查看当时截图</summary><img className="trial-proof" src={r.image_data} alt="个人验证历史截图"/></details>}</div>)}</details>;
}
function ResultEditor({plan,check,app,cell,first}:{plan:TrialPlan;check:TrialCheck;app:Application;cell?:EvidenceCell;first:boolean}) {
  const {updateTrial,saving}=useSaved();const latest=latestResult(plan,app.id,check);const current=currentResult(plan,app.id,check);
  const [draft,setDraft]=useState<TrialResult>(()=>current||emptyRecord(app.id,check)),[message,setMessage]=useState(""),[error,setError]=useState("");
  useEffect(()=>{setDraft(current||emptyRecord(app.id,check));},[latest?.id,app.id,check.id,check.title,check.criterion]);
  useEffect(()=>{setMessage("");setError("");},[app.id,check.id,check.title,check.criterion]);
  const history=plan.results.filter(r=>r.product_id===app.id&&r.check_id===check.id);
  function field<K extends keyof TrialResult>(key:K,value:TrialResult[K]){setDraft(d=>({...d,[key]:value}));setMessage("");setError("");}
  const completed=draft.status==="passed"||draft.status==="failed";
  async function submit(e:FormEvent){e.preventDefault();setMessage("");setError("");
    if(!evidenceUrl(draft.evidence_url)){setError("证据链接须为 http 或 https 地址。");return;}
    if(completed&&(!draft.method||!draft.version.trim()||!draft.environment.trim()||!draft.tested_on||!(draft.notes.trim()||draft.evidence_url||draft.image_data))){setError("请补充验证方式、版本、环境、日期，以及说明、链接或截图中的至少一项依据。");return;}
    if(draft.status==="na"&&!draft.notes.trim()){setError("请说明这项要求为什么不适用。");return;}
    const stamp=now();const record={...draft,id:crypto.randomUUID(),check_title:check.title,criterion:check.criterion,updated_at:stamp};
    if(await updateTrial(plan.id,p=>({...p,results:[record,...p.results],updated_at:stamp})))setMessage("验证记录已保存，旧版本保留在历史中。");else setError("验证记录未保存，原记录保持不变。请检查页面提示，或导出备份并减少截图后重试。");}
  return <details className="trial-check" open={first||undefined}><summary><span>{check.title}<small>{check.required?"必需项":"可选项"}</small></span><span className={`trial-status ${current?.status||"pending"}`}>{statusNames[current?.status||"pending"]}</span></summary>
    <p className="trial-criterion">本次验收要求：{check.criterion}</p>{latest&&!current&&<p className="trial-warning">要求已修改，原结果仅供历史参考，请按新要求重新验证。</p>}
    <OfficialReference app={app} cell={cell} from={`/trials/${plan.id}`}/>
    <form className="trial-result-form" aria-label={`${app.name} · ${check.title} · 个人验证`} onSubmit={submit}><p className="personal-label">个人验证记录 · 不修改官方信息</p>
      <div className="trial-form-grid"><label>记录结果<select aria-label="记录结果" value={draft.status} onChange={e=>field("status",e.target.value as TrialStatus)}>{Object.entries(statusNames).map(([k,n])=><option key={k} value={k}>{n}</option>)}</select></label>
      <label>验证方式<select aria-label="验证方式" value={draft.method} required={completed} onChange={e=>field("method",e.target.value as TrialMethod)}><option value="">尚未选择</option><option value="documentation">只核对资料 · 未实际操作</option><option value="hands_on">本人实际操作</option></select></label>
      <label>产品版本<input aria-label="产品版本" required={completed} maxLength={160} value={draft.version} onChange={e=>field("version",e.target.value)} placeholder="实际版本；官方未注明时如实填写"/></label>
      <label>验证日期<input aria-label="验证日期" type="date" required={completed} value={draft.tested_on} onChange={e=>field("tested_on",e.target.value)}/></label></div>
      <label>验证环境或条件<input aria-label="验证环境或条件" required={completed} maxLength={500} value={draft.environment} onChange={e=>field("environment",e.target.value)} placeholder="例如：本地 Docker / 官方演示 / 仅阅读指定文档"/></label>
      <label>验证说明<textarea aria-label="验证说明" rows={3} maxLength={10000} value={draft.notes} onChange={e=>field("notes",e.target.value)} placeholder="做了什么、观察到什么、哪些结论仍有限制？"/></label>
      <label>证据链接<input aria-label="证据链接" type="url" maxLength={2000} value={draft.evidence_url} onChange={e=>field("evidence_url",e.target.value)} placeholder="可选：官方文档或你自己的验证依据"/></label>
      <label>验证截图<input aria-label="验证截图" type="file" accept="image/png,image/jpeg,image/webp" onChange={async e=>{const f=e.target.files?.[0];e.target.value="";if(!f)return;if(!["image/png","image/jpeg","image/webp"].includes(f.type)||f.size>500*1024){setError("请选择不超过 500KB 的 PNG、JPEG 或 WebP 截图。");return;}const reader=new FileReader();reader.onload=()=>field("image_data",String(reader.result));reader.onerror=()=>setError("截图读取失败，原记录未改动。");reader.readAsDataURL(f);}}/></label>
      <p className="quiet-note">截图只保存在当前浏览器，随备份导出。容量有限，建议裁剪后上传。</p>{draft.image_data&&<div><img className="trial-proof" src={draft.image_data} alt={`${app.name} 个人验证截图`}/><button type="button" className="text-action" onClick={()=>field("image_data","")}>从这次记录移除截图</button></div>}
      {draft.method==="documentation"&&<p className="trial-warning">此记录仅说明你核对过资料，不代表已部署或实际操作验证。</p>}
      <div className="local-form-actions"><button className="button" type="submit" disabled={saving}>保存验证记录</button><span role="status">{saving?"正在保存…":message}</span></div>{error&&<p role="alert">{error}</p>}
    </form><ResultHistory records={history} plan={plan} names={trialNames(plan,[app])}/>
  </details>;
}

function ChecklistEditor({plan}:{plan:TrialPlan}) {
  const {updateTrial,saving}=useSaved();const [checks,setChecks]=useState(plan.checks),[message,setMessage]=useState(""),[error,setError]=useState("");
  useEffect(()=>{setChecks(plan.checks);},[JSON.stringify(plan.checks)]);
  function change(id:string,key:keyof TrialCheck,value:string|boolean){setChecks(rows=>rows.map(c=>c.id===id?{...c,[key]:value}:c));setMessage("");setError("");}
  return <details className="trial-checklist-editor"><summary>调整检查要求</summary><form onSubmit={async e=>{e.preventDefault();setMessage("");setError("");if(!checks.some(c=>c.active)){setMessage("至少保留一个启用的检查项。");return;}if(await updateTrial(plan.id,p=>({...p,checks,updated_at:now()})))setMessage("清单已更新；要求变化的旧结果保留为历史，需重新验证。");else setError("清单要求未保存，原记录保持不变，请检查本地存储后重试。");}}><p>修改标题或验收要求后，旧结果不会自动视为符合新要求。停用项目的历史仍保留。</p>{checks.map(c=><fieldset key={c.id}><div className="trial-check-options"><label><input type="checkbox" checked={c.active} onChange={e=>change(c.id,"active",e.target.checked)}/>本轮启用</label><label><input type="checkbox" checked={c.required} onChange={e=>change(c.id,"required",e.target.checked)}/>必需项</label></div><label>检查项标题<input aria-label="检查项标题" required maxLength={160} value={c.title} onChange={e=>change(c.id,"title",e.target.value)}/></label><label>验收要求<textarea aria-label="验收要求" required maxLength={2000} rows={2} value={c.criterion} onChange={e=>change(c.id,"criterion",e.target.value)}/></label></fieldset>)}
      <button className="text-action" type="button" onClick={()=>setChecks(c=>[...c,{id:crypto.randomUUID(),title:"新增检查",criterion:"请填写可观察的验收要求。",dimension:"",required:false,active:true}])}><Plus size={13}/>增加自定义检查</button><div className="local-form-actions"><button type="submit" className="button" disabled={saving}>保存清单要求</button><span role="status">{saving?"正在保存…":message}</span></div>{error&&<p role="alert">{error}</p>}</form></details>;
}

function FinalDecision({plan,apps}:{plan:TrialPlan;apps:Application[]}) {
  const {updateTrial,saving}=useSaved();const latest=plan.decisions[0];const [selected,setSelected]=useState(latest?.selected_id||""),[reason,setReason]=useState(latest?.reason||""),[questions,setQuestions]=useState(latest?.open_questions||""),[alternatives,setAlternatives]=useState<Record<string,string>>(()=>Object.fromEntries(latest?.alternatives.map(a=>[a.product_id,a.reason])||[])),[message,setMessage]=useState("");
  useEffect(()=>{setSelected(latest?.selected_id||"");setReason(latest?.reason||"");setQuestions(latest?.open_questions||"");setAlternatives(Object.fromEntries(latest?.alternatives.map(a=>[a.product_id,a.reason])||[]));},[latest?.id]);
  const [error,setError]=useState("");const names=trialNames(plan,apps);const identitiesReady=plan.ids.every(id=>names.has(id));const progress=selected?trialProgress(plan,selected):undefined;
  return <section className="trial-final"><p className="eyebrow">YOUR FINAL CHOICE</p><h2>最终选择，留下理由。</h2><p className="personal-label">这是你的个人选择，允许保留未解决的问题；不生成产品评分。</p>
    {latest&&<div className="trial-decision-summary"><strong>当前记录：{latest.selected_id?trialLabel(plan,latest.selected_id,names):"暂不选择，继续核实"}</strong><p className="personal-text">{latest.reason}</p>{latest.open_questions&&<p className="personal-text">尚存疑问：{latest.open_questions}</p>}<small>{date(latest.updated_at)} 保存</small></div>}
    <form onSubmit={async e=>{e.preventDefault();setMessage("");setError("");if(!reason.trim()||!identitiesReady)return;const stamp=now();const d:TrialDecision={id:crypto.randomUUID(),selected_id:selected,reason:reason.trim(),open_questions:questions,alternatives:plan.ids.filter(id=>id!==selected).map(product_id=>({product_id,reason:alternatives[product_id]||""})),updated_at:stamp};if(await updateTrial(plan.id,p=>({...p,decisions:[d,...p.decisions],updated_at:stamp})))setMessage("最终选择已保存；过往选择保留在历史中。");else setError("最终选择未保存，原记录保持不变，请检查本地存储后重试。");}}>
      {!identitiesReady&&<p className="trial-warning">候选名称暂时无法读取；现有选择和历史仍保留，请重新读取官方资料后再保存选择。</p>}<label>本次选择<select disabled={!identitiesReady} aria-label="本次选择" value={selected} onChange={e=>{setSelected(e.target.value);setMessage("");}}><option value="">暂不选择，继续核实</option>{plan.ids.map(id=><option value={id} key={id}>{trialLabel(plan,id,names)}</option>)}</select></label>
      {progress&&<p className="trial-warning">所选候选的必需项：已记录通过 {progress.passed}/{progress.total}，其中实际操作 {progress.handsOn}、资料核对 {progress.documentation}；未通过 {progress.failed}，待验证或不适用 {progress.unresolved}。{progress.failed+progress.unresolved>0&&"仍有要求未确认，保存选择不表示验收全部通过。"}</p>}
      <label>选择或暂不选择的理由<textarea aria-label="选择或暂不选择的理由" required rows={3} maxLength={10000} value={reason} onChange={e=>{setReason(e.target.value);setMessage("");}}/></label>
      <label>仍需确认的问题<textarea aria-label="仍需确认的问题" rows={2} maxLength={10000} value={questions} onChange={e=>{setQuestions(e.target.value);setMessage("");}}/></label>
      {plan.ids.filter(id=>id!==selected).map(id=><label key={id}>暂不选择 {trialLabel(plan,id,names)} 的原因<textarea aria-label={`暂不选择 ${trialLabel(plan,id,names)} 的原因`} rows={2} maxLength={5000} value={alternatives[id]||""} onChange={e=>setAlternatives(a=>({...a,[id]:e.target.value}))}/></label>)}
      <div className="local-form-actions"><button className="button primary-button" type="submit" disabled={saving||!reason.trim()||!identitiesReady}>保存最终选择</button><span role="status">{saving?"正在保存…":message}</span></div>{error&&<p role="alert">{error}</p>}
    </form>{!!plan.decisions.length&&<details className="trial-history"><summary>查看选择历史（{plan.decisions.length} 条）</summary>{plan.decisions.map(d=><div key={d.id}><strong>{d.selected_id?trialLabel(plan,d.selected_id,names):"暂不选择"}</strong><small>{date(d.updated_at)}</small><p className="personal-text">{d.reason}</p><p>尚存疑问：{d.open_questions||"未补充"}</p>{d.alternatives.map(a=><p key={a.product_id}>暂不选择 {trialLabel(plan,a.product_id,names)}：{a.reason||"未填写原因"}</p>)}</div>)}</details>}
  </section>;
}

export function TrialPage() {
  const {id=""}=useParams();const {trials,error:storageError}=useSaved();const plan=trials.find(p=>p.id===id);
  useEffect(()=>{document.title=`${plan?.name||"个人试用计划"} · SaaS Grove`;},[plan?.name]);
  if(!plan)return <main id="main" className="page"><Link className="return-context" to="/shortlist"><ArrowLeft size={14}/>返回候选清单</Link><div className="message-card"><h1>{storageError?"暂时无法读取试用记录":"这个浏览器还没有这份试用计划"}</h1><p>{storageError||"计划只保存在创建它的浏览器和访问地址。可从候选清单导入本地备份，原有记录不会被自动删除。"}</p></div></main>;
  return <TrialWorkspace key={plan.id} plan={plan}/>;
}
function TrialWorkspace({plan}:{plan:TrialPlan}) {
  const {data,error,retry}=useResource<Comparison>(`/api/compare?${new URLSearchParams({leaf:plan.leaf,ids:plan.ids.join(",")})}`);
  const [active,setActive]=useState(plan.ids[0]);const checks=plan.checks.filter(c=>c.active);
  const rows=data?.selection_rows||data?.crm_rows||[];const names=trialNames(plan,data?.products||[]);
  return <main id="main" className="page trial-page"><Link className="return-context" to="/shortlist"><ArrowLeft size={14}/>返回候选清单与备份</Link><div className="discovery-heading"><div><p className="eyebrow">A PERSONAL TRIAL WORKSPACE</p><h1>{plan.name}</h1><p>{plan.goal}</p></div><Link className="text-action" to={comparePath(plan)}>查看当前官方比较 <ArrowRight size={14}/></Link></div>
    <div className="trial-separation"><strong>个人试用 · 仅保存在本浏览器</strong><p>官方资料只作参考。资料核对、本人实际操作和最终选择分别记录，均不改写正式目录的“部署实测”状态。浏览器存储可能被清除，请定期从候选清单导出完整备份。</p></div>
    <section className="trial-progress" aria-label="候选验证进度">{plan.ids.map(product=>{const p=trialProgress(plan,product);return <div key={product}><strong>{trialLabel(plan,product,names)}</strong><p>必需项已记录通过 {p.passed}/{p.total}</p><small>实际操作 {p.handsOn} · 资料核对 {p.documentation} · 未通过 {p.failed} · 待验证/不适用 {p.unresolved}</small></div>;})}</section>
    <ChecklistEditor plan={plan}/>
    {error?<div className="message-card" role="alert"><h2>暂时无法读取当前官方资料</h2><p>{error}</p><p>个人计划和全部历史仍保留；{plan.ids.every(id=>names.has(id))?"可继续查看原有记录并留下选择。":"可查看历史，需恢复官方资料后才能保存新的最终选择。"}</p><button className="button" onClick={retry}>重新读取官方资料</button>{plan.results.length?<ResultHistory records={plan.results} plan={plan} names={names}/>:<p>尚未保存验证记录。</p>}</div>:!data?<p role="status">正在读取候选资料…</p>:<><div className="trial-tabs" role="tablist" aria-label="选择验证产品">{data.products.map(app=><button key={app.id} type="button" role="tab" id={`trial-tab-${app.id}`} aria-selected={active===app.id} aria-controls={`trial-panel-${app.id}`} onClick={()=>setActive(app.id)}>{app.name}</button>)}</div>
      {data.products.map((app,index)=><section id={`trial-panel-${app.id}`} key={app.id} role="tabpanel" aria-labelledby={`trial-tab-${app.id}`} hidden={active!==app.id}><h2>{app.name} · 个人验证</h2><p className="quiet-note">先核对资料，再按自己的条件操作。不要在没有验证时记录通过。</p>{checks.map((c,i)=><ResultEditor key={c.id} plan={plan} check={c} app={app} cell={rows.find(r=>r.key===c.dimension)?.cells[index]} first={i===0}/>)}</section>)}
    </>}
    <FinalDecision plan={plan} apps={data?.products||[]}/>
    {!!plan.checks.some(c=>!c.active)&&<details className="trial-history"><summary>已停用检查项的历史</summary>{plan.checks.filter(c=>!c.active).map(c=><div key={c.id}><strong>{c.title}</strong><ResultHistory records={plan.results.filter(r=>r.check_id===c.id)} plan={plan} names={names}/></div>)}</details>}
  </main>;
}
