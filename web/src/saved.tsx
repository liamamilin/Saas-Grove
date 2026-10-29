import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Bookmark, BookmarkCheck, X } from "lucide-react";

export const SAVED_KEY = "saas-grove.saved-products.v1";
export type SavedProduct = { id: string; saved_at: string };
type SavedContextValue = {
  items: SavedProduct[];
  error: string;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  dismissError: () => void;
};
const SavedContext = createContext<SavedContextValue | null>(null);

function readSaved(): { items: SavedProduct[]; error: string } {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return { items: [], error: "" };
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !Array.isArray(value.items) || !value.items.every((item: SavedProduct) => item && typeof item.id === "string" && item.id && typeof item.saved_at === "string")) {
      throw new Error("Unreadable saved list");
    }
    const unique = new Set<string>();
    return { items: value.items.filter((item: SavedProduct) => { if (unique.has(item.id)) return false; unique.add(item.id); return true; }), error: "" };
  } catch {
    return { items: [], error: "暂时无法读取本地收藏，浏览器中的原记录未改动。请检查此站点的浏览器存储设置后重试。" };
  }
}

export function SavedProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(readSaved);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === SAVED_KEY || event.key === null) setState(readSaved()); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function update(id: string, removeOnly = false) {
    const current = readSaved();
    if (current.error) { setState(current); return; }
    const exists = current.items.some(item => item.id === id);
    const next = exists || removeOnly ? current.items.filter(item => item.id !== id) : [{ id, saved_at: new Date().toISOString() }, ...current.items];
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify({ version: 1, items: next }));
      setState({ items: next, error: "" });
    } catch {
      setState({ ...current, error: `${exists || removeOnly ? "取消收藏失败，原记录保持不变" : "收藏未保存"}：浏览器存储不可用或已满。请检查此站点的浏览器存储设置后重试。` });
    }
  }
  return <SavedContext.Provider value={{ ...state, toggle: id => update(id), remove: id => update(id, true), dismissError: () => setState(value => ({ ...value, error: "" })) }}>{children}</SavedContext.Provider>;
}

export function useSaved() {
  const value = useContext(SavedContext);
  if (!value) throw new Error("SavedProvider is required");
  return value;
}

export function SaveButton({ id, name }: { id: string; name: string }) {
  const { items, toggle } = useSaved();
  const saved = items.some(item => item.id === id);
  return <button className={`save-product-button ${saved ? "is-saved" : ""}`} type="button" aria-label={`${saved ? "取消收藏" : "收藏"} ${name}`} aria-pressed={saved} onClick={() => toggle(id)}>
    {saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}<span>{saved ? "已收藏" : "收藏"}</span>
  </button>;
}

export function SavedNotice() {
  const { error, dismissError } = useSaved();
  return error ? <div className="page"><div className="saved-storage-notice" role="alert"><span>{error}</span><button type="button" aria-label="关闭收藏提示" onClick={dismissError}><X size={17} /></button></div></div> : null;
}
