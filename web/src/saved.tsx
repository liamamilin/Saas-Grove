import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Bookmark, BookmarkCheck, X } from "lucide-react";
import { readLocal, parseLocal, emptyData, mergeLocal, SAVED_KEY, type LocalData, type PersonalNote, type SavedComparison } from "./local-data";
export { SAVED_KEY } from "./local-data";
export type { SavedProduct } from "./local-data";
type SavedContextValue = LocalData & { error: string; toggle: (id: string) => void; remove: (id: string) => void; dismissError: () => void;
  saveNote: (note: PersonalNote) => boolean; deleteNote: (id: string) => boolean; saveComparison: (value: SavedComparison) => boolean; deleteComparison: (id: string) => boolean;
  importData: (data: LocalData) => boolean; snapshot: () => LocalData };
const SavedContext = createContext<SavedContextValue | null>(null);
function readState() {
  try { return { ...readLocal(), error: "" }; }
  catch { return { ...emptyData(), error: "暂时无法读取本地收藏或选型记录，浏览器中的原记录未改动。请检查此站点的浏览器存储设置后重试。" }; }
}
export function SavedProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(readState);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === SAVED_KEY || event.key === null) setState(readState()); };
    window.addEventListener("storage", sync); return () => window.removeEventListener("storage", sync);
  }, []);
  function commit(change: (data: LocalData) => LocalData, action: string) {
    const current = readState();
    if (current.error) { setState(current); return false; }
    try { const {error: _error, ...data} = current; const next = parseLocal(change(data)); localStorage.setItem(SAVED_KEY, JSON.stringify(next)); setState({...next,error:""}); return true; }
    catch { setState({...current,error:`${action}，原记录保持不变：浏览器存储不可用或已满。请检查此站点的浏览器存储设置后重试。`}); return false; }
  }
  function update(id: string, removeOnly = false) {
    const exists = readState().items.some(i=>i.id===id);
    commit(current => { const remove = removeOnly || current.items.some(i=>i.id===id); return {...current,items:remove?current.items.filter(i=>i.id!==id):[{id,saved_at:new Date().toISOString()},...current.items]}; },exists || removeOnly ? "取消收藏失败" : "收藏未保存");
  }
  return <SavedContext.Provider value={{...state,toggle:id=>update(id),remove:id=>update(id,true),dismissError:()=>setState(v=>({...v,error:""})),
    saveNote:note=>commit(v=>({...v,notes:[note,...v.notes.filter(n=>n.product_id!==note.product_id)]}),"个人备注未保存"),
    deleteNote:id=>commit(v=>({...v,notes:v.notes.filter(n=>n.product_id!==id)}),"个人记录删除失败"),
    saveComparison:c=>commit(v=>({...v,comparisons:[c,...v.comparisons.filter(o=>o.id!==c.id)]}),"比较未保存"),
    deleteComparison:id=>commit(v=>({...v,comparisons:v.comparisons.filter(c=>c.id!==id)}),"比较删除失败"),
    importData:incoming=>commit(v=>mergeLocal(v,incoming),"备份导入失败"),snapshot:readLocal }}>{children}</SavedContext.Provider>;
}
export function useSaved() { const v=useContext(SavedContext); if(!v) throw new Error("SavedProvider is required"); return v; }
export function SaveButton({ id, name }: { id: string; name: string }) {
  const {items,toggle}=useSaved(); const saved=items.some(i=>i.id===id);
  return <button className={`save-product-button ${saved?"is-saved":""}`} type="button" aria-label={`${saved?"取消收藏":"收藏"} ${name}`} aria-pressed={saved} onClick={()=>toggle(id)}>{saved?<BookmarkCheck size={16}/>:<Bookmark size={16}/>}<span>{saved?"已收藏":"收藏"}</span></button>;
}
export function SavedNotice() { const {error,dismissError}=useSaved(); return error?<div className="page"><div className="saved-storage-notice" role="alert"><span>{error}</span><button type="button" aria-label="关闭收藏提示" onClick={dismissError}><X size={17}/></button></div></div>:null; }
