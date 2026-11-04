import type { SavedComparison } from "./local-data";

export type TrialStatus = "pending" | "passed" | "failed" | "na";
export type TrialMethod = "" | "documentation" | "hands_on";
export type TrialCheck = { id: string; title: string; criterion: string; required: boolean; active: boolean; dimension: string };
export type TrialResult = { id: string; product_id: string; check_id: string; check_title: string; criterion: string;
  status: TrialStatus; method: TrialMethod; version: string; environment: string; tested_on: string;
  notes: string; evidence_url: string; image_data: string; updated_at: string };
export type TrialDecision = { id: string; selected_id: string; reason: string; open_questions: string;
  alternatives: { product_id: string; reason: string }[]; updated_at: string };
export type TrialPlan = { id: string; name: string; goal: string; comparison_id: string; leaf: string; ids: string[];
  candidate_labels?: {id: string; name: string}[]; checks: TrialCheck[]; results: TrialResult[]; decisions: TrialDecision[]; created_at: string; updated_at: string };

export const CRM = "customer-relationship-management-crm";
export const CRM_CHECKS = [
  { dimension: "records", title: "客户与线索记录", criterion: "用自己的样例建立客户和线索，确认字段、查找与关联符合需求。" },
  { dimension: "pipeline", title: "商机管道", criterion: "建立一条商机并推进阶段，确认阶段设置与日常跟进方式。" },
  { dimension: "io", title: "数据导入与导出", criterion: "用不含真实客户信息的样例检查导入、字段映射和完整导出。" },
  { dimension: "api", title: "API 与集成", criterion: "确认所用版本的接口与认证方式，按自己的集成需求检查一次调用。" },
  { dimension: "delivery", title: "部署与日常维护", criterion: "记录安装、备份恢复或官方演示的使用条件，明确是否已实际部署。" },
  { dimension: "license_boundary", title: "版本与扩展边界", criterion: "确认实际需要的能力属于哪个版本，以及是否需要额外扩展或授权。" },
];
const str = (v: unknown): v is string => typeof v === "string";
const filled = (v: unknown): v is string => str(v) && !!v.trim();
const stamp = (v: unknown) => str(v) && Number.isFinite(Date.parse(v));
export const evidenceUrl = (v: string) => !v || /^https?:\/\//i.test(v) && (()=>{try{return !!new URL(v).hostname;}catch{return false;}})();
const day = (v: unknown) => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
export function parseTrials(value: unknown): TrialPlan[] {
  if (!Array.isArray(value)) throw new Error("试用计划格式无法读取");
  const ids = new Set<string>();
  return value.map(p => {
    if (!p || !filled(p.id) || ids.has(p.id) || !filled(p.name) || !str(p.goal) || !str(p.comparison_id) || !filled(p.leaf)
      || !Array.isArray(p.ids) || p.ids.length < 2 || p.ids.length > 4 || !p.ids.every(filled) || new Set(p.ids).size !== p.ids.length
      || !stamp(p.created_at) || !stamp(p.updated_at) || !Array.isArray(p.checks) || !p.checks.length
      || !Array.isArray(p.results) || !Array.isArray(p.decisions)) throw new Error("试用计划格式无法读取");
    ids.add(p.id);
    const labels = p.candidate_labels === undefined ? [] : p.candidate_labels;
    if (!Array.isArray(labels) || !labels.every((l: {id:string;name:string})=>l && p.ids.includes(l.id) && filled(l.name)) || new Set(labels.map((l:{id:string})=>l.id)).size !== labels.length) throw new Error("候选名称记录格式无法读取");
    const checks = new Set<string>();
    for (const c of p.checks) {
      if (!c || !filled(c.id) || checks.has(c.id) || !filled(c.title) || !filled(c.criterion) || typeof c.required !== "boolean" || typeof c.active !== "boolean" || !str(c.dimension)) throw new Error("试用检查项格式无法读取");
      checks.add(c.id);
    }
    const records = new Set<string>();
    for (const r of p.results) {
      if (!r || !filled(r.id) || records.has(r.id) || !p.ids.includes(r.product_id) || !checks.has(r.check_id) || !filled(r.check_title) || !filled(r.criterion)
        || !["pending","passed","failed","na"].includes(r.status) || !["","documentation","hands_on"].includes(r.method)
        || ![r.version,r.environment,r.tested_on,r.notes,r.evidence_url,r.image_data].every(str) || !stamp(r.updated_at)
        || !evidenceUrl(r.evidence_url) || r.image_data && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(r.image_data) || r.image_data.length>700000)) throw new Error("个人验证记录格式无法读取");
      if ((r.status === "passed" || r.status === "failed") && (!r.method || !filled(r.version) || !filled(r.environment) || !day(r.tested_on) || !(r.notes.trim() || r.evidence_url || r.image_data))) throw new Error("验证结果须记录方式、版本、环境、日期和依据");
      if (r.status === "na" && !r.notes.trim()) throw new Error("请说明不适用的原因");
      records.add(r.id);
    }
    const decisions = new Set<string>();
    for (const d of p.decisions) {
      if (!d || !filled(d.id) || decisions.has(d.id) || !str(d.selected_id) || d.selected_id && !p.ids.includes(d.selected_id)
        || !filled(d.reason) || !str(d.open_questions) || !stamp(d.updated_at) || !Array.isArray(d.alternatives)
        || !d.alternatives.every((a: {product_id: string; reason: string}) => a && p.ids.includes(a.product_id) && a.product_id !== d.selected_id && str(a.reason))
        || new Set(d.alternatives.map((a: {product_id: string})=>a.product_id)).size !== d.alternatives.length) throw new Error("最终选择记录格式无法读取");
      decisions.add(d.id);
    }
    // Copy personal fields only. Imported catalog facts and runtime flags never become official data.
    return {id:p.id,name:p.name,goal:p.goal,comparison_id:p.comparison_id,leaf:p.leaf,ids:[...p.ids],created_at:p.created_at,updated_at:p.updated_at,candidate_labels:labels.map((l:{id:string;name:string})=>({id:l.id,name:l.name})),
      checks:p.checks.map((c:TrialCheck)=>({id:c.id,title:c.title,criterion:c.criterion,required:c.required,active:c.active,dimension:c.dimension})),
      results:p.results.map((r:TrialResult)=>({id:r.id,product_id:r.product_id,check_id:r.check_id,check_title:r.check_title,criterion:r.criterion,status:r.status,method:r.method,version:r.version,environment:r.environment,tested_on:r.tested_on,notes:r.notes,evidence_url:r.evidence_url,image_data:r.image_data,updated_at:r.updated_at})),
      decisions:p.decisions.map((d:TrialDecision)=>({id:d.id,selected_id:d.selected_id,reason:d.reason,open_questions:d.open_questions,alternatives:d.alternatives.map(a=>({product_id:a.product_id,reason:a.reason})),updated_at:d.updated_at}))};
  });
}
export function createTrial(comparison: SavedComparison, name: string, goal: string, checks: Omit<TrialCheck,"id">[], labels: {id:string;name:string}[] = []): TrialPlan {
  const now = new Date().toISOString();
  return parseTrials([{id:crypto.randomUUID(),name:name.trim(),goal:goal.trim(),comparison_id:comparison.id,leaf:comparison.leaf,ids:[...comparison.ids],
    candidate_labels:labels.map(l=>({id:l.id,name:l.name})),checks:checks.map(c=>({...c,id:crypto.randomUUID()})),results:[],decisions:[],created_at:now,updated_at:now}])[0];
}
// History is saved newest-first. Do not revive an older matching result after requirements change.
export function latestResult(plan: TrialPlan, product: string, check: TrialCheck) {
  return plan.results.find(r=>r.product_id===product && r.check_id===check.id);
}
export function currentResult(plan: TrialPlan, product: string, check: TrialCheck) {
  const r = latestResult(plan,product,check);
  return r?.check_title===check.title && r.criterion===check.criterion ? r : undefined;
}
export function trialProgress(plan: TrialPlan, product: string) {
  const required = plan.checks.filter(c=>c.active&&c.required);
  const rows = required.map(c=>currentResult(plan,product,c));
  return {total:required.length,passed:rows.filter(r=>r?.status==="passed").length,
    handsOn:rows.filter(r=>r?.status==="passed"&&r.method==="hands_on").length,
    documentation:rows.filter(r=>r?.status==="passed"&&r.method==="documentation").length,
    failed:rows.filter(r=>r?.status==="failed").length,
    unresolved:rows.filter(r=>!r||r.status==="pending"||r.status==="na").length};
}

// Creation-time display names only; current catalog names take precedence when available.
export function trialNames(plan: TrialPlan, apps: {id:string;name:string}[] = []) {
  return new Map([...(plan.candidate_labels||[]).map(l=>[l.id,l.name] as const),...apps.map(a=>[a.id,a.name] as const)]);
}
export function trialLabel(plan: TrialPlan, id: string, names: Map<string,string>) {
  return names.get(id) || `候选 ${plan.ids.indexOf(id)+1} · ${id}`;
}

export function trialCompareUrl(plan: TrialPlan, from = `/trials/${plan.id}`) {
  return `/compare?${new URLSearchParams({leaf:plan.leaf,ids:plan.ids.join(","),trial:plan.id,from})}#trial-overview`;
}
