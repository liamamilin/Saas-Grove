export type SavedProduct = { id: string; saved_at: string };
export type NoteStatus = "research" | "trial" | "excluded";
export type PersonalNote = { product_id: string; text: string; status: NoteStatus; updated_at: string };
export type SavedComparison = { id: string; name: string; leaf: string; ids: string[]; dimensions: string[]; show_same: boolean; conclusion: string; updated_at: string };
export type LocalData = { version: 2; items: SavedProduct[]; notes: PersonalNote[]; comparisons: SavedComparison[] };
export const SAVED_KEY = "saas-grove.saved-products.v1";
export const emptyData = (): LocalData => ({ version: 2, items: [], notes: [], comparisons: [] });
const text = (v: unknown): v is string => typeof v === "string";
const nonempty = (v: unknown): v is string => text(v) && !!v.trim();
const date = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v));
const unique = <T,>(items: T[], key: (v: T) => string) => [...new Map(items.map(v => [key(v), v])).values()];
export function parseLocal(value: unknown): LocalData {
  const v = value as Omit<LocalData,"version"> & {version:number};
  // Legacy favorites tolerate unparseable dates; retain their IDs and show “时间未记录”.
  if (!v || ![1,2].includes(v.version) || !Array.isArray(v.items) || !v.items.every(i => i && nonempty(i.id) && text(i.saved_at))) throw new Error("收藏格式无法读取");
  const notes = v.notes === undefined ? [] : v.notes;
  const comparisons = v.comparisons === undefined ? [] : v.comparisons;
  if (!Array.isArray(notes) || !notes.every(n => n && nonempty(n.product_id) && text(n.text) && ["research", "trial", "excluded"].includes(n.status) && date(n.updated_at))) throw new Error("个人备注格式无法读取");
  if (!Array.isArray(comparisons) || !comparisons.every(c => c && nonempty(c.id) && nonempty(c.name) && nonempty(c.leaf) && Array.isArray(c.ids) && c.ids.length >= 2 && c.ids.length <= 4 && c.ids.every(nonempty) && new Set(c.ids).size === c.ids.length && Array.isArray(c.dimensions) && c.dimensions.every(text) && typeof c.show_same === "boolean" && text(c.conclusion) && date(c.updated_at))) throw new Error("已保存比较格式无法读取");
  // v2 prevents pre-upgrade tabs (v1-only readers) from overwriting new notes. Keep the existing storage key and item identities.
  // Retain only personal fields; product facts always come from the catalog.
  return { version: 2, items: unique(v.items.map(i => ({id:i.id,saved_at:i.saved_at})), i => i.id), notes: unique(notes.map(n => ({product_id:n.product_id,text:n.text,status:n.status,updated_at:n.updated_at})), n => n.product_id), comparisons: unique(comparisons.map(c => ({id:c.id,name:c.name,leaf:c.leaf,ids:c.ids,dimensions:c.dimensions,show_same:c.show_same,conclusion:c.conclusion,updated_at:c.updated_at})), c => c.id) };
}
export function readLocal(): LocalData {
  const raw = localStorage.getItem(SAVED_KEY);
  return raw === null ? emptyData() : parseLocal(JSON.parse(raw));
}
export function parseBackup(raw: string): LocalData {
  const v = JSON.parse(raw);
  if (v?.format !== "saas-grove.local-backup" || v.version !== 1 || !Array.isArray(v.favorites) || !Array.isArray(v.notes) || !Array.isArray(v.comparisons)) throw new Error("请选择 SaaS Grove 导出的完整 JSON 备份");
  return parseLocal({version:1,items:v.favorites,notes:v.notes,comparisons:v.comparisons});
}
export function mergeLocal(current: LocalData, incoming: LocalData): LocalData {
  const add = <T,>(old: T[], next: T[], key: (v: T) => string) => [...old, ...next.filter(v => !old.some(o => key(o) === key(v)))];
  return {version:2,items:add(current.items,incoming.items,i=>i.id),notes:add(current.notes,incoming.notes,n=>n.product_id),comparisons:add(current.comparisons,incoming.comparisons,c=>c.id)};
}
export function downloadFile(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function comparisonUrl(c: SavedComparison) {
  return `/compare?${new URLSearchParams({leaf:c.leaf,ids:c.ids.join(","),dims:c.dimensions.join(","),same:c.show_same?"1":"0",saved:c.id,from:"/shortlist"})}`;
}
