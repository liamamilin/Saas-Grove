#!/usr/bin/env node
// Prototype step 2: turn candidates + READMEs into structured notes with a free model.
//   node toolbox/research/summarize.mjs --dir <work dir with candidates.json> [--model m] [--jobs 4]
// One call per project (README-only evidence), then one overview call (categories, reading order, merged feature list).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runAgent, sessionId } from "../../harness/lib/opencode.mjs";

const a = process.argv.slice(2);
const o = {};
for (let i = 0; i < a.length; i += 2) o[a[i].replace(/^--/, "")] = a[i + 1];
const dir = path.resolve(o.dir);
const model = o.model ?? "opencode-go/minimax-m3.1-flash-free";
const jobs = Number(o.jobs ?? 4);
const cand = JSON.parse(fs.readFileSync(path.join(dir, "candidates.json"), "utf8"));
fs.mkdirSync(path.join(dir, "notes"), { recursive: true });
fs.mkdirSync(path.join(dir, "logs"), { recursive: true });

// A scratch project for the agent: no edit, no shell, no web.
const scratch = "/Users/Shared/saas-template-runs/toolbox-agent";
fs.mkdirSync(path.join(scratch, ".opencode", "agents"), { recursive: true });
fs.copyFileSync(path.resolve("harness/agents/opencode.jsonc"), path.join(scratch, "opencode.jsonc"));
fs.writeFileSync(path.join(scratch, ".opencode", "agents", "note.md"), `---
description: Read-only note taker. Answers with the requested JSON only.
mode: primary
steps: 6
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: deny
  - action: webfetch
    resource: "*"
    effect: deny
  - action: websearch
    resource: "*"
    effect: deny
  - action: external_directory
    resource: "*"
    effect: deny
---

Answer only from the text you are given. Output exactly one JSON object and nothing else.
`);
if (!fs.existsSync(path.join(scratch, ".git"))) execFileSync("git", ["init", "-q", "-b", "main"], { cwd: scratch });

const extract = (t) => {
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("no JSON");
  return JSON.parse(t.slice(s, e + 1));
};
const PROJECT = (p, readme) => `你在为一个想了解“${cand.topic}”领域有哪些开源软件的人做调研笔记。只能依据下面的元数据和 README；README 没写的一律写“未说明”，不得凭常识补全，不得编造功能或命令。用中文，简洁，面向没看过这个项目的人。

元数据：${JSON.stringify({ name: p.full_name, description: p.description, stars: p.stars, language: p.language, license: p.license, topics: p.topics, pushed_at: p.pushed_at })}

README（可能被截断）：
"""
${readme}
"""

输出一个 JSON 对象，字段：
{"what": "一句话说清它是什么（<=40字）", "kind": "项目类型，如 交易机器人/回测框架/交易所/行情终端/库/其他", "features": ["README 明确写出的核心功能，最多8条，每条<=20字"], "how_to_run": "README 里的安装/运行方式摘要（<=80字，没有就写 未说明）", "for_whom": "适合谁（<=40字，依据 README）", "caveats": ["README 里明确提到的限制、风险、前置条件，最多4条；没有就空数组"], "evidence_gaps": ["你想写但 README 没提供的信息"]}`;

async function one(p) {
  const f = path.join(dir, "notes", `${p.full_name.replace("/", "__")}.json`);
  if (fs.existsSync(f)) return;
  const readme = fs.readFileSync(path.join(dir, "raw", `readme-${p.full_name.replace("/", "__")}.md`), "utf8").slice(0, 9000);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    const r = await runAgent({ cwd: scratch, agent: "note", model, session: sessionId("note", p.full_name, Date.now()), message: PROJECT(p, readme), logFile: path.join(dir, "logs", `${p.full_name.replace("/", "__")}.jsonl`) });
    try {
      const j = extract(r.finalText || r.allText);
      fs.writeFileSync(f, JSON.stringify({ ...j, _meta: { ms: Date.now() - t0, model: r.modelUsed ?? model, attempt } }, null, 1));
      console.log(`ok ${p.full_name} (${Math.round((Date.now() - t0) / 1000)}s)`);
      return;
    } catch (e) { console.log(`retry ${p.full_name}: ${e.message}`); }
  }
  console.log(`FAILED ${p.full_name}`);
}

const queue = [...cand.items];
await Promise.all(Array.from({ length: jobs }, async () => { for (let p; (p = queue.shift()); ) await one(p); }));

// overview
const notes = cand.items.map((p) => { const f = path.join(dir, "notes", `${p.full_name.replace("/", "__")}.json`); return fs.existsSync(f) ? { name: p.full_name, ...JSON.parse(fs.readFileSync(f, "utf8")) } : null; }).filter(Boolean);
const brief = notes.map((n) => ({ name: n.name, what: n.what, kind: n.kind, features: n.features }));
const OVER = `下面是“${cand.topic}”领域 ${notes.length} 个开源项目的笔记。请做一份总览，只依据这些笔记，不要引入别的项目或事实。用中文。

${JSON.stringify(brief)}

输出一个 JSON 对象：
{"summary": "这个领域整体是什么样（<=120字）", "categories": [{"name": "分类名", "desc": "<=40字", "projects": ["owner/repo"...]}], "reading_order": [{"project": "owner/repo", "why": "<=40字，为什么先看它"}] (5到8个), "feature_matrix": [{"feature": "功能名（合并同义）", "projects": ["owner/repo"...]}] (最多20项，按覆盖项目数从多到少), "gaps": ["这个领域从笔记里看不出来、值得进一步查的问题"(最多4条)]}`;
for (let attempt = 1; attempt <= 3; attempt++) {
  const r = await runAgent({ cwd: scratch, agent: "note", model, session: sessionId("overview", Date.now()), message: OVER, logFile: path.join(dir, "logs", "overview.jsonl") });
  try { const j = extract(r.finalText || r.allText); fs.writeFileSync(path.join(dir, "overview.json"), JSON.stringify(j, null, 1)); console.log("overview ok"); break; } catch (e) { console.log(`overview retry: ${e.message}`); }
}
