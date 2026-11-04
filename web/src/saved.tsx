import type { TrialPlan } from "./trial-data";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Bookmark, BookmarkCheck, X } from "lucide-react";
import { readLocal, parseLocal, emptyData, mergeLocal, SAVED_KEY, type LocalData, type PersonalNote, type SavedComparison } from "./local-data";
export { SAVED_KEY } from "./local-data";
export type { SavedProduct } from "./local-data";
type SavedContextValue = LocalData & { error: string; saving: boolean; toggle: (id: string, wanted: boolean) => void; remove: (id: string) => void; dismissError: () => void;
  saveNote: (note: PersonalNote) => Promise<boolean>; deleteNote: (id: string) => Promise<boolean>; saveComparison: (value: SavedComparison) => Promise<boolean>; deleteComparison: (id: string) => Promise<boolean>;
  saveTrial: (trial: TrialPlan) => Promise<boolean>; updateTrial: (id: string, change: (trial: TrialPlan) => TrialPlan) => Promise<boolean>; deleteTrial: (id: string) => Promise<boolean>; importData: (data: LocalData) => Promise<boolean>; snapshot: () => LocalData };
const SavedContext = createContext<SavedContextValue | null>(null);
function readState() {
  try { return { ...readLocal(), error: "" }; }
  catch { return { ...emptyData(), error: "暂时无法读取本地收藏或选型记录，浏览器中的原记录未改动。请检查此站点的浏览器存储设置后重试。" }; }
}
export function SavedProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(readState);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === SAVED_KEY || event.key === null) setState(readState()); };
    window.addEventListener("storage", sync); return () => window.removeEventListener("storage", sync);
  }, []);
  async function commit(change: (data: LocalData) => LocalData, action: string): Promise<boolean> {
    setPending(n=>n+1);
    // Every lock-capable writer shares one origin-scoped lock and re-reads inside it.
    const writeNow = () => {
      const current = readState();
      if (current.error) { setState(current); return false; }
      try { const {error: _error, ...data} = current; const next = parseLocal(change(data)); localStorage.setItem(SAVED_KEY, JSON.stringify(next)); setState({...next,error:""}); return true; }
      catch { setState({...current,error:`${action}，原记录保持不变：浏览器存储不可用或已满。请检查此站点的浏览器存储设置后重试。`}); return false; }
    };
    try { return navigator.locks ? await navigator.locks.request(SAVED_KEY, writeNow) : writeNow();
    } catch { setState(v=>({...v,error:`${action}：暂时无法取得本地写入锁，原记录保持不变。请稍后重试。`})); return false; } finally { setPending(n=>n-1); }
  }
  function update(id: string, wanted: boolean) {
    // Preserve the clicked button's intent even if another tab changes the record first.
    commit(current => ({...current,items:wanted
      ? current.items.some(i=>i.id===id) ? current.items : [{id,saved_at:new Date().toISOString()},...current.items]
      : current.items.filter(i=>i.id!==id)}),wanted ? "收藏未保存" : "取消收藏失败");
  }
  return <SavedContext.Provider value={{...state,saving:pending>0,toggle:(id,wanted)=>update(id,wanted),remove:id=>update(id,false),dismissError:()=>setState(v=>({...v,error:""})),
    saveNote:note=>commit(v=>({...v,notes:[note,...v.notes.filter(n=>n.product_id!==note.product_id)]}),"个人备注未保存"),
    deleteNote:id=>commit(v=>({...v,notes:v.notes.filter(n=>n.product_id!==id)}),"个人记录删除失败"),
    saveComparison:c=>commit(v=>({...v,comparisons:[c,...v.comparisons.filter(o=>o.id!==c.id)]}),"比较未保存"),
    deleteComparison:id=>commit(v=>({...v,comparisons:v.comparisons.filter(c=>c.id!==id)}),"比较删除失败"),
    saveTrial:t=>commit(v=>({...v,trials:[t,...v.trials.filter(o=>o.id!==t.id)]}),"试用计划未保存"),
    updateTrial:(id,change)=>commit(v=>{const current=v.trials.find(t=>t.id===id);if(!current)throw new Error("计划已移除");return {...v,trials:[change(current),...v.trials.filter(t=>t.id!==id)]};},"试用记录未保存"),
    deleteTrial:id=>commit(v=>({...v,trials:v.trials.filter(t=>t.id!==id)}),"试用计划删除失败"),
    importData:incoming=>commit(v=>mergeLocal(v,incoming),"备份导入失败"),snapshot:readLocal }}>{children}</SavedContext.Provider>;
}
export function useSaved() { const v=useContext(SavedContext); if(!v) throw new Error("SavedProvider is required"); return v; }
export function SaveButton({ id, name }: { id: string; name: string }) {
  const {items,toggle,saving}=useSaved(); const saved=items.some(i=>i.id===id);
  return <button className={`save-product-button ${saved?"is-saved":""}`} type="button" disabled={saving} aria-busy={saving} aria-label={`${saved?"取消收藏":"收藏"} ${name}`} aria-pressed={saved} onClick={()=>toggle(id,!saved)}>{saved?<BookmarkCheck size={16}/>:<Bookmark size={16}/>}<span>{saved?"已收藏":"收藏"}</span></button>;
}
export function SavedNotice() { const {error,dismissError}=useSaved(); return error?<div className="page"><div className="saved-storage-notice" role="alert"><span>{error}</span><button type="button" aria-label="关闭收藏提示" onClick={dismissError}><X size={17}/></button></div></div>:null; }
