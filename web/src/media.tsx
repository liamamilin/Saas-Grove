import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Code2, ExternalLink, Globe, History, Images, LayoutGrid, MonitorPlay, PlayCircle, Server, X } from "lucide-react";
import type { Application, ProductResource, ResourceType, Screenshot } from "./api";

export const resourceNames: Record<ResourceType, string> = { homepage: "官网", repository: "代码仓库", docs: "文档", demo: "在线演示 / 试用",
  deployment: "部署指南", features: "功能介绍", changelog: "更新记录", video: "视频介绍" };
const missingNames: Record<string, string> = { ...resourceNames, screenshot: "界面截图", logo: "Logo" };
const icons = { homepage: Globe, repository: Code2, docs: BookOpen, demo: MonitorPlay, deployment: Server, features: LayoutGrid, changelog: History, video: PlayCircle };
const host = (url: string) => { try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; } };
const day = (value?: string) => value ? value.slice(0, 10) : "日期未记录";

/** Official logo when curated; otherwise, or when the image fails, the shared monogram placeholder. */
export function ProductLogo({ app, size = "card" }: { app: Pick<Application, "name" | "logo_url">; size?: "card" | "large" | "small" }) {
  const [failed, setFailed] = useState("");
  const url = app.logo_url && failed !== app.logo_url ? app.logo_url : "";
  return <span className={`product-logo logo-${size} ${url ? "has-image" : ""}`} aria-hidden="true">
    {url ? <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(url)} /> : app.name.slice(0, 1).toUpperCase()}
  </span>;
}

export function DemoActions({ app }: { app: Application }) {
  const items = (app.resource_profile?.resources || []).filter(r => (r.type === "demo" || r.type === "video") && r.status !== "unreachable");
  return <>{items.map(r => { const Icon = icons[r.type]; return <a key={r.url} className="button demo-button" href={r.url} target="_blank" rel="noreferrer"><Icon size={16} />{r.label}<ExternalLink size={13} /></a>; })}</>;
}

function ResourceCard({ item }: { item: ProductResource }) {
  const Icon = icons[item.type];
  return <a className={`resource-card ${item.status === "unreachable" ? "unreachable" : ""}`} href={item.url} target="_blank" rel="noreferrer">
    <span className="resource-icon"><Icon size={18} /></span>
    <span className="resource-text"><strong>{resourceNames[item.type]}</strong><span>{item.from_formal_record ? "来自正式产品记录" : item.label}</span><small>{host(item.url)}{item.note && ` · ${item.note}`}</small>{item.status === "unreachable" && <small className="resource-warning">最近一次检查无法打开，链接暂时保留</small>}</span>
    <ExternalLink size={14} className="resource-out" />
  </a>;
}

export function ResourcePanel({ app }: { app: Application }) {
  const profile = app.resource_profile;
  const open = app.tracks?.includes("open_source");
  if (!profile) {
    const fallback: ProductResource[] = [
      ...(app.homepage ? [{ type: "homepage" as const, url: app.homepage, label: "正式记录", found_on: app.homepage, from_formal_record: true }] : []),
      ...(open && app.repository_url ? [{ type: "repository" as const, url: app.repository_url, label: "正式记录", found_on: app.repository_url, from_formal_record: true }] : [])];
    return <section className="reading-section resource-section" id="resources"><p className="eyebrow">GO TO THE SOURCE</p><h2>官方资源</h2>
      {fallback.length ? <div className="resource-grid">{fallback.map(r => <ResourceCard key={r.url} item={r} />)}</div> : null}
      <p className="quiet-note">文档、演示、部署指南等官方资源尚未整理；这里只显示正式记录中的链接，不代表这些资源不存在。</p></section>;
  }
  const visible = profile.resources.filter(r => open || r.type !== "repository");
  return <section className="reading-section resource-section" id="resources"><p className="eyebrow">GO TO THE SOURCE</p><h2>官方资源</h2>
    <div className="resource-grid">{visible.map(r => <ResourceCard key={`${r.type}-${r.url}`} item={r} />)}</div>
    {!!profile.missing.length && <div className="resource-missing"><h3>暂未找到</h3><ul>{profile.missing.map(m => <li key={m.type + m.reason}><strong>{missingNames[m.type] || m.type}</strong>{m.reason}</li>)}</ul></div>}
    <p className="quiet-note">{profile.curated ? `资源于 ${day(profile.curated_at)} 整理，除标注“来自正式产品记录”的链接外，均为当时实际打开过的官方链接；` : "官方资源尚未系统整理，以上为单产品更新命令从正式记录与 GitHub 核对到的链接，不代表其他资源不存在；"}{profile.refreshed_at && `最近一次自动核对 ${day(profile.refreshed_at)}。`}演示与试用入口跳转到原站，不代表本站做过功能实测。</p>
  </section>;
}

export function RepositoryFacts({ app }: { app: Application }) {
  const facts = app.resource_profile?.repository_facts;
  if (!facts) return null;
  return <div className="repo-facts">
    {facts.archived && <p className="repo-archived">GitHub 显示该仓库已归档（只读）</p>}
    <dl>{facts.latest_release && <div><dt>最新发布</dt><dd><a href={facts.latest_release.url} target="_blank" rel="noreferrer">{facts.latest_release.tag}</a>{facts.latest_release.prerelease && "（预发布）"} · {day(facts.latest_release.published_at)}</dd></div>}
      {facts.pushed_at && <div><dt>最近代码推送</dt><dd>{day(facts.pushed_at)}</dd></div>}</dl>
    <small>GitHub 仓库信息 · {day(facts.fetched_at)} 获取</small>
  </div>;
}

export function ScreenshotGallery({ app }: { app: Application }) {
  const shots = app.resource_profile?.screenshots || [];
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const [index, setIndex] = useState(0);
  const [broken, setBroken] = useState<string[]>([]);
  const usable = shots.filter(s => !broken.includes(s.url));
  useEffect(() => { if (index >= usable.length && usable.length) setIndex(usable.length - 1); }, [index, usable.length]);
  if (!app.resource_profile || (!app.resource_profile.curated && !shots.length)) return null;
  if (!usable.length) return <section className="screenshot-section empty" aria-label="产品界面"><p className="eyebrow">SEE THE PRODUCT</p><h2>产品界面</h2><p className="quiet-note">{shots.length ? "截图暂时无法加载，可以通过官方资源查看。" : "暂未找到可靠的官方界面截图。"}</p></section>;
  const show = (i: number, button: HTMLButtonElement) => { opener.current = button; setIndex(i); dialog.current?.showModal(); };
  const step = (delta: number) => setIndex(i => (i + delta + usable.length) % usable.length);
  const current: Screenshot = usable[Math.min(index, usable.length - 1)];
  return <section className="screenshot-section" aria-label="产品界面"><div className="screenshot-heading"><div><p className="eyebrow">SEE THE PRODUCT</p><h2>产品界面</h2></div><span><Images size={15} />{usable.length} 张官方图片</span></div>
    <div className={`screenshot-grid count-${usable.length}`}>{usable.map((s, i) => <figure key={s.url}>
      <button type="button" className="screenshot-thumb" aria-label={`放大查看：${s.caption}`} onClick={e => show(i, e.currentTarget)}>
        <img src={s.url} alt={`${app.name}：${s.caption}`} loading="lazy" decoding="async" referrerPolicy="no-referrer" width={s.width} height={s.height} onError={() => setBroken(b => [...b, s.url])} />
      </button>
      <figcaption>{s.caption}{s.kind === "ui_composite" && <span className="badge composite-badge">官方界面拼图</span>}</figcaption></figure>)}</div>
    <p className="quiet-note">图片来自官方仓库 README 或官网并直接链接原图；标注“官方界面拼图”的为官方营销排版中的界面组合，不是完整单屏截图。</p>
    <dialog ref={dialog} className="lightbox" aria-label={`${app.name} 截图`} onClose={() => opener.current?.focus()} onClick={e => { if (e.target === dialog.current) dialog.current?.close(); }} onKeyDown={e => { if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); }}>
      <div className="lightbox-bar"><span>{Math.min(index, usable.length - 1) + 1} / {usable.length} · {current.caption}</span><button type="button" aria-label="关闭截图" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      <img key={current.url} src={current.url} alt={`${app.name}：${current.caption}`} referrerPolicy="no-referrer" onError={() => setBroken(b => [...b, current.url])} />
      <div className="lightbox-foot">{usable.length > 1 && <button type="button" aria-label="上一张" onClick={() => step(-1)}><ChevronLeft size={20} /></button>}<a href={current.found_on} target="_blank" rel="noreferrer">图片出处 <ExternalLink size={12} /></a>{current.kind === "ui_composite" && <span className="badge composite-badge">官方界面拼图</span>}{usable.length > 1 && <button type="button" aria-label="下一张" onClick={() => step(1)}><ChevronRight size={20} /></button>}</div>
    </dialog>
  </section>;
}
