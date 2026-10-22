#!/usr/bin/env node
// Prototype step 1: search GitHub for a topic and save candidates + READMEs.
//   node toolbox/research/fetch.mjs --topic "crypto trading software" --queries "q1;q2;q3" [--max 30] [--out dir]
// Unauthenticated (60 core requests/hour, 10 searches/minute). A token, if ever needed, comes from GITHUB_TOKEN only.
import fs from "node:fs";
import path from "node:path";

const a = process.argv.slice(2);
const o = {};
for (let i = 0; i < a.length; i += 2) o[a[i].replace(/^--/, "")] = a[i + 1];
const topic = o.topic, queries = (o.queries ?? "").split(";").map((s) => s.trim()).filter(Boolean);
const max = Number(o.max ?? 30);
if (!topic || !queries.length) { console.error("need --topic and --queries"); process.exit(2); }
const out = o.out ?? path.join(path.dirname(new URL(import.meta.url).pathname), "data", "_work", String(Date.now()));
fs.mkdirSync(path.join(out, "raw"), { recursive: true });
const H = { "User-Agent": "research-prototype", Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(url, headers = {}) {
  let r = await fetch(url, { headers: { ...H, ...headers } });
  for (let i = 0; i < 3 && (r.status === 403 || r.status === 429); i++) {
    const reset = Number(r.headers.get("x-ratelimit-reset")) * 1000, retry = Number(r.headers.get("retry-after")) * 1000;
    const wait = Math.min(Math.max(retry || 0, reset ? reset - Date.now() + 1500 : 0, 20000), 120000);
    console.log(`rate limited, waiting ${Math.round(wait / 1000)}s (remaining=${r.headers.get("x-ratelimit-remaining")})`);
    await sleep(wait);
    r = await fetch(url, { headers: { ...H, ...headers } });
  }
  if (r.status === 403 || r.status === 429) throw new Error(`rate limited: ${url} (${r.status}) reset=${r.headers.get("x-ratelimit-reset")}`);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r;
}

const seen = new Map();
for (const q of queries) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}+archived:false&sort=stars&order=desc&per_page=30`;
  const j = await (await api(url)).json();
  fs.writeFileSync(path.join(out, "raw", `search-${queries.indexOf(q)}.json`), JSON.stringify(j, null, 1));
  for (const it of j.items ?? []) if (!seen.has(it.full_name)) seen.set(it.full_name, { ...it, _query: q });
  console.log(`query "${q}": ${j.total_count} total, ${j.items?.length} taken`);
  await sleep(15000);
}
const yearAgo = Date.now() - 2 * 365 * 86400e3;
let cands = [...seen.values()]
  .filter((r) => !r.fork && !r.archived && r.stargazers_count >= 100 && new Date(r.pushed_at).getTime() > yearAgo)
  .sort((x, y) => y.stargazers_count - x.stargazers_count)
  .slice(0, max);
console.log(`candidates after filter: ${cands.length} (from ${seen.size})`);
const items = [];
for (const r of cands) {
  let readme = "";
  try { readme = await (await api(`https://api.github.com/repos/${r.full_name}/readme`, { Accept: "application/vnd.github.raw+json" })).text(); } catch (e) { console.log(`no readme ${r.full_name}: ${e.message}`); if (/rate limited/.test(e.message)) break; }
  if (!readme.trim()) continue;
  items.push({
    full_name: r.full_name, url: r.html_url, description: r.description, stars: r.stargazers_count, forks: r.forks_count,
    pushed_at: r.pushed_at, created_at: r.created_at, language: r.language, license: r.license?.spdx_id ?? null, topics: r.topics ?? [],
    open_issues: r.open_issues_count, query: r._query, readme_chars: readme.length,
  });
  fs.writeFileSync(path.join(out, "raw", `readme-${r.full_name.replace("/", "__")}.md`), readme);
}
fs.writeFileSync(path.join(out, "candidates.json"), JSON.stringify({ topic, queries, fetchedAt: new Date().toISOString(), items }, null, 1));
console.log(`saved ${items.length} projects with README to ${out}`);
