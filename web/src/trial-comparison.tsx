import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { Application } from "./api";
import { useSaved } from "./saved";
import { currentResult, latestResult, trialCompareUrl, trialNames, trialLabel, type TrialCheck, type TrialPlan, type TrialResult } from "./trial-data";

const states = {pending:"待验证",passed:"通过",failed:"未通过",na:"不适用"};
const methods = {documentation:"资料核对 · 未实际操作",hands_on:"本人实际操作"};
const date = (s:string) => new Date(s).toLocaleString("zh-CN");
function matches(plan:TrialPlan,leaf:string,ids:string[]) {
  return plan.leaf===leaf && ids.length===plan.ids.length && ids.every(id=>plan.ids.includes(id));
}
function signature(r:TrialResult|undefined) {
  return !r||r.status==="pending" ? null : `${r.status}:${r.method}`;
}
function different(plan:TrialPlan,c:TrialCheck) {
  const known=plan.ids.map(id=>signature(currentResult(plan,id,c))).filter(v=>v!==null);
  return known.length>1 && new Set(known).size>1;
}
export function TrialComparison({leaf,ids,apps=[]}:{leaf:string;ids:string[];apps?:Application[]}) {
  const {trials,error:storageMessage,snapshot}=useSaved();
  let error="";if(storageMessage){try{snapshot();}catch{error=storageMessage;}}const [params,setParams]=useSearchParams();
  const requested=params.get("trial")||"";
  const eligible=trials.filter(p=>matches(p,leaf,ids));
  const explicit=requested?trials.find(p=>p.id===requested):undefined;
  const plan=requested ? eligible.find(p=>p.id===requested) : eligible.length===1?eligible[0]:undefined;
  const requiredQuery=params.get("trial_required")==="1";
  const filterQuery=["unresolved","different"].includes(params.get("trial_filter")||"")?params.get("trial_filter")!:"all";
  const [required,setRequired]=useState(requiredQuery),[filter,setFilter]=useState(filterQuery);
  useEffect(()=>setRequired(requiredQuery),[requiredQuery]);
  useEffect(()=>setFilter(filterQuery),[filterQuery]);
  // Consecutive filter actions must merge with the latest address, before deferred router renders.
  function view(key:string,value:string) {const next=new URLSearchParams(window.location.search);if(value)next.set(key,value);else next.delete(key);setParams(next,{replace:true});}
  const from=`/compare?${params}#trial-overview`;
  const loadedIds=apps.map(a=>a.id).join(",");
  useEffect(()=>{if(loadedIds&&window.location.hash==="#trial-overview")document.getElementById("trial-overview")?.scrollIntoView({block:"start"});},[loadedIds]);
  const names=plan?trialNames(plan,apps):new Map<string,string>();
  const rows=plan?.checks.filter(c=>c.active&&(!required||c.required)).filter(c=>filter==="unresolved"?plan.ids.some(id=>currentResult(plan,id,c)?.status!=="passed"):filter==="different"?different(plan,c):true)||[];
  return <section id="trial-overview" className="trial-comparison" aria-label="个人试用结果并排总览">
    <div className="local-section-heading"><div><p className="eyebrow">YOUR OBSERVATIONS, SIDE BY SIDE</p><h2>个人试用结果，并排看。</h2><p className="personal-label">仅属于本浏览器的个人记录 · 与上方官方资料分开</p></div></div>
    <p className="quiet-note">只展示同一计划、相同验收要求下的记录。未记录不代表产品不支持；资料核对不等于实际操作，不自动生成评分。</p>
    {error?<p role="alert">本地试用记录暂时无法读取，原记录未改动。{error}</p>:<>
      {requested&&!explicit&&<p className="trial-warning" role="status">这个浏览器没有链接指定的试用计划，可从候选清单导入备份。不会替换成其他计划。</p>}
      {explicit&&!matches(explicit,leaf,ids)&&<p className="trial-warning" role="status">“{explicit.name}”的类型或候选与当前比较不一致，原记录保持不变。<Link to={trialCompareUrl(explicit,"/shortlist")}>按原候选查看此计划 <ArrowRight size={13}/></Link></p>}
      {!!eligible.length&&<label className="trial-plan-picker">选择试用计划<select aria-label="选择试用计划" value={plan?.id||""} onChange={e=>view("trial",e.target.value)}><option value="">{eligible.length>1?"请选择一份计划，不合并不同计划的结果":"请选择试用计划"}</option>{eligible.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      {!eligible.length&&!requested&&<p className="quiet-note">当前候选还没有对应的试用计划。<Link to="/shortlist">从已保存的 CRM 比较生成清单，或导入本地备份 <ArrowRight size={13}/></Link></p>}
      {plan&&<>
        <div className="trial-overview-context"><div><h3>{plan.name}</h3><p>{plan.goal}</p></div><Link className="text-action" to={`/trials/${plan.id}?${new URLSearchParams({from})}`}>继续验证与最终选择 <ArrowRight size={14}/></Link></div>
        <div className="trial-overview-filters"><label><input type="checkbox" checked={required} onChange={e=>{setRequired(e.target.checked);view("trial_required",e.target.checked?"1":"");}}/>只看必需项</label><label>检查项筛选<select aria-label="试用检查项筛选" value={filter} onChange={e=>{setFilter(e.target.value);view("trial_filter",e.target.value==="all"?"":e.target.value);}}><option value="all">全部检查项</option><option value="unresolved">待解决、未通过或不适用</option><option value="different">验证状态或方式不同</option></select></label><span>{rows.length} / {plan.checks.filter(c=>c.active).length} 项</span></div>
        <p className="quiet-note">“不同”仅比较已有记录的结果状态和验证方式，不推断产品优劣。版本、环境不同的观察需要结合条件阅读；修改要求后的旧结果只在历史中保留。</p>
        <div className="compare-scroll trial-overview-scroll" role="region" aria-label="个人试用结果表，可横向滚动" tabIndex={0}><table className="comparison-table trial-comparison-table"><thead><tr><th scope="col">相同验收要求</th>{ids.map(id=><th scope="col" key={id}>{trialLabel(plan,id,names)}<small>个人记录</small></th>)}</tr></thead><tbody>{rows.map(c=><tr key={c.id} data-check={c.id}><th scope="row">{c.title}<small>{c.required?"必需项":"可选项"}</small><p>{c.criterion}</p>{different(plan,c)&&<small className="difference-label">验证状态 / 方式不同</small>}</th>{ids.map(id=><td key={id}><Observation plan={plan} check={c} product={id} from={from}/></td>)}</tr>)}{!rows.length&&<tr><td colSpan={ids.length+1}>当前筛选下没有检查项。可以查看全部检查项，或回到计划调整要求。</td></tr>}</tbody></table></div>
        {plan.decisions[0]&&<div className="trial-overview-decision"><strong>个人选择记录：{plan.decisions[0].selected_id?trialLabel(plan,plan.decisions[0].selected_id,names):"暂不选择，继续核实"}</strong><p className="personal-text">{plan.decisions[0].reason}</p>{plan.decisions[0].open_questions&&<p>未解决问题：{plan.decisions[0].open_questions}</p>}<small>{date(plan.decisions[0].updated_at)} 保存 · 个人选择不表示所有要求已经验证通过</small></div>}
      </>}
    </>}
  </section>;
}
function Observation({plan,check,product,from}:{plan:TrialPlan;check:TrialCheck;product:string;from:string}) {
  const current=currentResult(plan,product,check),latest=latestResult(plan,product,check);
  const next=`/trials/${plan.id}?${new URLSearchParams({product,check:check.id,from})}`;
  return <div className="trial-observation"><strong className="trial-observation-check">{check.title}</strong>
    <span className={`trial-status ${current?.status||"pending"}`}>{current?states[current.status]:"待验证"}</span>
    {!current?<p className="quiet-note">{latest?"要求已修改，原结果仅供历史参考，需重新验证。":"尚未保存这项验证，能力保持未知。"}</p>:<>
      {current.method&&<strong className="trial-observation-method">{methods[current.method]}</strong>}
      <dl><dt>版本</dt><dd>{current.version||"未记录"}</dd><dt>环境 / 条件</dt><dd>{current.environment||"未记录"}</dd><dt>验证日期</dt><dd>{current.tested_on||"未记录"}</dd></dl>
      <details className="trial-observation-evidence"><summary>查看验证说明与依据</summary><p className="personal-text">{current.notes||"未填写说明"}</p>{current.evidence_url&&<a href={current.evidence_url} target="_blank" rel="noreferrer">本次记录的证据链接</a>}{current.image_data&&<img className="trial-proof" src={current.image_data} alt="个人验证截图" loading="lazy"/>}<small>记录保存 {date(current.updated_at)}</small></details>
    </>}
    <Link className="text-action" to={next}>{current?"继续验证 / 查看历史":"验证这一项 / 查看历史"}<ArrowRight size={12}/></Link>
  </div>;
}
