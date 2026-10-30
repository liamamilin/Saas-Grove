import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Download, MessageSquare, Upload } from "lucide-react";
import { useSaved } from "./saved";
import { comparisonUrl, downloadFile, mergeLocal, parseBackup, type LocalData, type NoteStatus, type SavedComparison } from "./local-data";
export const statusNames = {research:"待了解",trial:"准备试用",excluded:"暂不考虑"};
export function PersonalNoteEditor({id,name}: {id:string;name:string}) {
  const {notes,saveNote,deleteNote}=useSaved(); const note=notes.find(n=>n.product_id===id);
  const [text,setText]=useState(note?.text||""), [status,setStatus]=useState<NoteStatus>(note?.status||"research"),[message,setMessage]=useState("");
  useEffect(()=>{setMessage("");},[id]);
  useEffect(()=>{setText(note?.text||"");setStatus(note?.status||"research");},[id,note?.text,note?.status]);
  return <details className="personal-note"><summary><MessageSquare size={14}/><span>我的选型记录{note?` · ${statusNames[note.status]}`:""}</span></summary><form onSubmit={e=>{e.preventDefault();if(saveNote({product_id:id,text,status,updated_at:new Date().toISOString()}))setMessage("个人记录已保存");}}>
    <p className="personal-label">个人判断 · 不属于官方产品资料</p><label>选型状态<select aria-label={`${name} 选型状态`} value={status} onChange={e=>{setStatus(e.target.value as NoteStatus);setMessage("");}}>{Object.entries(statusNames).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>
    <label>备注<textarea aria-label={`${name} 个人备注`} value={text} rows={3} maxLength={10000} placeholder="为什么考虑它？还有什么需要确认？" onChange={e=>{setText(e.target.value);setMessage("");}}/></label><div className="local-form-actions"><button className="button" type="submit">保存个人记录</button><span role="status">{message}</span>{note&&<button className="text-action" type="button" onClick={()=>{if(deleteNote(id))setMessage("个人记录已删除");}}>删除个人记录</button>}</div>
  </form></details>;
}
export function BackupTools() {
  const {snapshot,importData}=useSaved(); const [incoming,setIncoming]=useState<LocalData>(),[error,setError]=useState(""),[message,setMessage]=useState("");
  let current:LocalData|undefined; try{current=snapshot();}catch{/* Display error without replacing unreadable data. */}
  const merged=current&&incoming?mergeLocal(current,incoming):undefined;
  return <details className="backup-tools"><summary><Download size={15}/>本地备份与恢复</summary><p>备份包含收藏、个人备注、选型状态和保存的比较。产品资料仍从本地目录读取。</p><div className="backup-actions"><button className="button" disabled={!current} onClick={()=>{try{const v=snapshot();downloadFile(`saas-grove-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({format:"saas-grove.local-backup",version:1,exported_at:new Date().toISOString(),favorites:v.items,notes:v.notes,comparisons:v.comparisons},null,2));setMessage("备份已导出");setError("");}catch{setError("无法读取本地记录，未导出备份。");}}}><Download size={14}/>导出完整备份</button>
    <label className="button file-button"><Upload size={14}/>选择备份文件<input aria-label="选择本地备份文件" type="file" accept=".json,application/json" onChange={async e=>{const file=e.target.files?.[0];e.target.value="";setIncoming(undefined);setMessage("");setError("");if(!file)return;try{if(file.size>10*1024*1024)throw new Error();setIncoming(parseBackup(await file.text()));}catch{setError("备份无法读取：请选择完整、有效的 SaaS Grove JSON 备份。现有记录未改动。");}}}/></label></div>
    {incoming&&merged&&current&&<div className="backup-preview"><h3>导入预览</h3><p>将新增 {merged.items.length-current.items.length} 个收藏、{merged.notes.length-current.notes.length} 条备注、{merged.comparisons.length-current.comparisons.length} 个比较。</p><p>相同 ID 的记录保留当前内容，不覆盖已有备注和比较；没有出现在备份中的记录也会保留。</p><button className="button primary-button" onClick={()=>{if(importData(incoming)){setIncoming(undefined);setMessage("备份已合并导入，当前已有记录保持不变");}}}>合并导入</button><button className="text-action" onClick={()=>setIncoming(undefined)}>取消导入</button></div>}
    {!current&&<p className="error">当前记录无法读取，请先保留浏览器中的原数据。</p>}{error&&<p role="alert">{error}</p>}<p role="status">{message}</p></details>;
}
export function SavedComparisons() {
  const {comparisons,deleteComparison}=useSaved();
  return <section className="saved-comparisons"><div className="local-section-heading"><div><p className="eyebrow">YOUR DECISIONS</p><h2>已保存的比较 <span>{comparisons.length}</span></h2></div><BackupTools/></div>{!comparisons.length?<p className="quiet-note">比较产品时可以命名保存，留下关注维度和选型结论，下次继续。</p>:<div className="saved-comparison-list">{comparisons.map(c=><article key={c.id}><div><Link to={comparisonUrl(c)}>{c.name}<ArrowRight size={15}/></Link><p>{c.ids.length} 个产品 · {new Date(c.updated_at).toLocaleDateString("zh-CN")}</p>{c.conclusion&&<p className="saved-conclusion">个人结论：{c.conclusion}</p>}</div><button className="text-action" aria-label={`删除比较 ${c.name}`} onClick={()=>deleteComparison(c.id)}>删除</button></article>)}</div>}</section>;
}
export function SaveComparisonForm({value,savedId,onSaved}: {value:Omit<SavedComparison,"id"|"name"|"conclusion"|"updated_at">;savedId:string;onSaved:(id:string)=>void}) {
  const {comparisons,saveComparison}=useSaved(); const existing=comparisons.find(c=>c.id===savedId);
  const [name,setName]=useState(existing?.name||""),[conclusion,setConclusion]=useState(existing?.conclusion||""),[message,setMessage]=useState("");
  useEffect(()=>{setName(existing?.name||"");setConclusion(existing?.conclusion||"");},[existing?.id,existing?.name,existing?.conclusion]);
  const viewKey=JSON.stringify(value);
  useEffect(()=>{setMessage("");},[viewKey]);
  return <form className="save-comparison-form" onSubmit={e=>{e.preventDefault();if(!name.trim()){setMessage("请填写比较名称");return;}const id=existing?.id||crypto.randomUUID();if(saveComparison({...value,id,name:name.trim(),conclusion,updated_at:new Date().toISOString()})){onSaved(id);setMessage("比较已保存，可从候选清单继续");}}}><div><p className="eyebrow">KEEP YOUR REASONING</p><h2>{existing?"更新这次比较":"保存这次比较"}</h2><p className="personal-label">个人选型记录 · 不修改官方资料</p></div><label>比较名称<input aria-label="比较名称" required maxLength={120} value={name} placeholder="例如：团队 CRM 选型" onChange={e=>{setName(e.target.value);setMessage("");}}/></label><label>我的选型结论<textarea aria-label="我的选型结论" value={conclusion} maxLength={10000} rows={3} placeholder="目前倾向哪个选择？还需要验证什么？" onChange={e=>{setConclusion(e.target.value);setMessage("");}}/></label><div className="local-form-actions"><button className="button primary-button" disabled={!name.trim()} type="submit">{existing?"更新已保存比较":"保存比较"}</button><Link className="text-action" to="/shortlist">查看已保存比较</Link><span role="status">{message}</span></div></form>;
}
