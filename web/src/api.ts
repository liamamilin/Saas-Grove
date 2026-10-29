import { useEffect, useState } from "react";
export type Track = "open_source" | "commercial";
export type Counts = Record<Track, number>;
export type Scope = "included" | "conditional";
export type Category = { id: string; parent_id: string | null; name: string; name_zh: string };
export type Leaf = { slug: string; name: string; name_zh: string; aliases_zh: string[]; parent_id: string;
  domain_id: string; scope: Scope; scope_reason: string; counts: Counts };
export type Group = Category & { leaves: Leaf[] };
export type Domain = Category & { groups: Group[]; leaf_count: number };
export type Taxonomy = { domains: Domain[]; matching_leaves: number; domain_count: number;
  source_leaf_count: number; counts: Record<Scope | "excluded", number>; application_counts: Counts; revision: string };
export type LeafDetail = Leaf & { overview: string; overview_zh: string; dc: string; dc_zh: string;
  rules: string; rules_zh: string; breadcrumbs: Category[];
  source: { project: string; import_date: string; reference_revision: string } };
export type Application = { id: string; name: string; summary?: string; homepage?: string; repository_url?: string;
  source_url?: string; license?: string; checked_at?: string; features?: string[];
  deployment?: string[]; technology_stack?: string[]; runtime_tested?: boolean;
  tracks?: Track[]; types?: ProductType[]; verification_status?: string;
  license_status?: "reviewed" | "unverified"; license_evidence_url?: string;
  license_review?: { rationale?: string; scope?: string; source_url?: string };
  deployment_options?: string[]; checked_at_basis?: "recorded" | "source_fetched";
  unsupported_features?: { name: string; source_url: string }[];
  sources?: { url: string; kind: string; fetched_at: string }[] };
export type ProductType = { slug: string; name: string; name_zh: string; scope: Scope; domain_id: string };
export type ProductResults = { applications: Application[]; total: number; page: number; pages: number; page_size: number;
  facets: { licenses: { value: string; count: number }[]; deployments: { value: string; label: string; count: number }[] } };
export type Comparison = { products: Application[]; leaf: ProductType; candidates: Application[] };
export type ApplicationList = { applications: Application[]; leaf: string; track: Track; total: number };

export function useResource<T>(url: string) {
  const [state, setState] = useState<{ url: string; data?: T; error?: string }>({ url: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ url });
    fetch(url, { signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "资料暂时无法读取");
      if (!controller.signal.aborted) setState({ url, data: value as T });
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setState({ url, error: error.message });
    });
    return () => controller.abort();
  }, [url, revision]);
  return { data: state.url === url ? state.data : undefined,
    error: state.url === url ? state.error : undefined, retry: () => setRevision(v => v + 1) };
}
