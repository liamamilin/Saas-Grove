#!/usr/bin/env node
// Module cognition templates: one agent job per module, written to templates/modules/<name>/ (status 草稿).
//
//   node harness/modules.mjs run [--only a,b] [--jobs 4] [--model <provider/model>]
//   node harness/modules.mjs status
//
// Input per module: its row in templates/modules.json (name, one-line scope, optional next-forge package)
// plus a read-only copy of that next-forge package (cognition source, not code to copy). Output: MODULE.md,
// contract.md, acceptance-plan.md, decisions.md. Nothing here is verified by a build yet: status stays 草稿.
// Records (model, minutes, fallback) go to <runs>/modules/state.json. Arguments are always passed as arrays.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { HARNESS, REPO, RUNS, runPaths } from "./lib/run.mjs";
import { runAgent, sessionId } from "./lib/opencode.mjs";
import { assertSandboxAvailable, writeProfile } from "./lib/sandbox.mjs";

const MODEL_DEFAULT = "opencode-go/minimax-m3.1-flash-free";
const [command, ...rest] = process.argv.slice(2);
const o = {};
for (let i = 0; i < rest.length; i += 2) o[rest[i].replace(/^--/, "")] = rest[i + 1];
const model = o.model ?? MODEL_DEFAULT;
const sfx = o.suffix ?? "";
const stateFile = path.join(RUNS, "modules", "state.json");
fs.mkdirSync(path.dirname(stateFile), { recursive: true });
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : { modules: {} };
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
const list = JSON.parse(fs.readFileSync(path.join(REPO, "templates", "modules.json"), "utf8")).modules;

const AGENT_MD = `---
description: Module template author. Edits only ./out.
mode: primary
steps: 800
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: edit
    resource: "out/**"
    effect: allow
  - action: webfetch
    resource: "*"
    effect: deny
  - action: websearch
    resource: "*"
    effect: deny
  - action: external_directory
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: allow
  - action: shell
    resource: "git push*"
    effect: deny
  - action: shell
    resource: "sudo *"
    effect: deny
---

You work only inside this project directory. Never read, print or copy secrets.
`;

const NAMES = list.map((x) => x.name).join(", ");
const DEPTH = { core: "Go deep: this is a core module; cover the hard parts concretely.", secondary: "Keep it tighter than a core module: the essentials and the traps only.", later: "A short first draft is enough." };
const PROMPT = (m) => `You are writing a COGNITION TEMPLATE for the SaaS module "${m.name}" (${m.scope}). The reader is a coding agent that will implement this module in a buyer's own stack; the buyer is not an expert. A cognition template teaches what a mature version of this module is, NOT code. No vendor names, no library-specific code, no implementation code (short pseudo-steps and example payloads are fine).
${m.source ? `Cognition source: ./source (the open-source next-forge package "${m.source}", MIT). Read it to learn what the module covers; drop its vendor lock-in and rewrite in vendor-neutral terms.` : "There is no source package for this module; use your own knowledge of mature SaaS products."}
Write these files in ./out, in Chinese (keep identifiers, HTTP and code terms in English):
1. MODULE.md — sections: 这个模块是什么 / 成熟版应该有什么（按 MVP→成熟分层，逐条）/ 每项的正确行为 / 容易做错的地方（具体到会出什么事故）/ 与其他模块的接口（只列模块名和接口含义）/ 不做什么。
2. contract.md — the black-box contract another agent's tests can rely on: observable behaviors, status codes and error shapes written as rules (no framework names), data that must be stored hashed, invariants. Every rule must be checkable from outside the running application.
3. acceptance-plan.md — 15-30 black-box test cases as a table: id, given, action, expected, negative(yes/no). Include the hard negatives (isolation, replay, limits, races). Executable tests come later; this is the plan.
4. decisions.md — human decision points with a recommended default each and the consequence of choosing otherwise.
Read ./HOST.md first: it is the host convention every module shares (how the acceptance starts and operates any host, the module-map.json path mapping, test hooks, dependency order). Refer to it instead of repeating it; contract paths are concept names the host maps. When you mention another module use only these names: ${NAMES}. ${DEPTH[m.tier]} FORMAT (a script checks it): in contract.md give every rule an id 'R-<n>' (R-1, R-2, … no other id scheme) as the first cell of a table row or the start of a bold line; in acceptance-plan.md give every case an id 'T-<n>' as the first cell of a table row; end contract.md with a heading containing the word 追溯 followed by a table with one row per rule: '| R-<n> | T-<n>, T-<n> |'; a rule that cannot be tested black-box is listed in a section 'suggestions, not tested' and its trace row says 不测. Every R id has at least one T id and every T id appears in the trace table. Before you finish, re-read all four files once and make every status code, error code, number, TTL and name identical wherever it appears; for each case state how it obtains every token/id/state it needs using only HOST.md hooks and public endpoints; and check your rules against this attack list: concurrency and replay, enumeration in every account state, cross-tenant access, boundary values, failure modes of dependencies, idempotency, clock changes. Quality rules learned from reviews (apply them): every MUST rule needs a concept the host can map and at least one acceptance case; every case traces to a rule (end contract.md with a rule->case table); give numeric limits/TTLs as bounds in the contract (host declares actuals in params); rules not observable by a black box go to a section 'suggestions, not tested', not into MUST; one status code per situation, no contradictions between files; outbox template names '<module>.<name>' with the link in data.link; behind proxies take the client IP from the rightmost non-trusted X-Forwarded-For hop, never the leftmost; never advise 'recompute stored digests' for hashed tokens (dual keys until old tokens expire; password hashes upgrade at next login); enumeration safety must hold in every account state (disabled, unverified, existing); a requirement for a request header (Origin) must say how the acceptance script supplies it; a numeric acceptance threshold must be read from host params, not hardcoded; every case must be executable with the hooks in HOST.md (check that each needed token/id can actually be obtained); the final rule->case table must be exact, double-check each row; keep at least 1 KB spare under every size limit; include concurrency/replay cases (single-use tokens) and negative cases; cover the attacks a security reviewer would try; do not put things that belong to another module in this one. Size limits (hard): MODULE.md at most 13 KB and starting with a one-page 'must read' summary; contract.md at most 15 KB; acceptance-plan.md at most 11 KB; decisions.md at most 5 KB. Check spelling. Cut explanations of well-known terms; keep traps, rules and checks. Be concrete and complete, not generic. Finish with a two-line summary and the single word DONE.`;

function lintDir(outDir, name) {
  const tmp = fs.mkdtempSync(path.join(RUNS, "lint-"));
  fs.mkdirSync(path.join(tmp, name));
  for (const f of fs.readdirSync(outDir)) fs.copyFileSync(path.join(outDir, f), path.join(tmp, name, f));
  let out = "";
  try { out = execFileSync("node", [path.join(HARNESS, "modules-lint.mjs"), "--dir", tmp, name], { encoding: "utf8" }); }
  catch (e) { out = String(e.stdout ?? e.message); }
  fs.rmSync(tmp, { recursive: true, force: true });
  return out.trim();
}

async function job(m) {
  const runId = `modules-${m.name}${sfx}`;
  const p = runPaths(runId);
  fs.rmSync(p.root, { recursive: true, force: true });
  fs.mkdirSync(p.records, { recursive: true });
  fs.mkdirSync(path.join(p.project, ".opencode", "agents"), { recursive: true });
  fs.mkdirSync(path.join(p.project, "out"), { recursive: true });
  if (m.source) fs.cpSync(path.join(REPO, "references", "next-forge", "packages", m.source), path.join(p.project, "source"), { recursive: true, filter: (f) => !/node_modules|\.DS_Store/.test(f) });
  fs.copyFileSync(path.join(REPO, "templates", "HOST.md"), path.join(p.project, "HOST.md"));
  fs.copyFileSync(path.join(HARNESS, "agents", "opencode.jsonc"), path.join(p.project, "opencode.jsonc"));
  fs.writeFileSync(path.join(p.project, ".opencode", "agents", "job.md"), AGENT_MD);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: p.project });
  const sandbox = writeProfile(p.sandbox, p.project);
  fs.mkdirSync(path.join(p.records, "logs"), { recursive: true });
  const session = sessionId(runId, Date.now());
  const rec = { model, startedAt: Date.now(), turns: 0, fellBack: false };
  state.modules[m.name + sfx] = rec;
  let done = false;
  for (let round = 1; round <= 4 && !done; round++) {
    const r = await runAgent({
      cwd: p.project,
      agent: "job",
      model,
      session,
      message: round === 1 ? PROMPT(m) : "Continue until all four files are complete. End with the single word DONE.",
      logFile: path.join(p.records, "logs", `r${round}.jsonl`),
      sandbox,
    });
    rec.turns++;
    rec.fellBack ||= !!r.fellBack;
    if (r.exitCode !== 0) rec.lastError = r.errors.join("; ").slice(0, 300);
    done = /(^|\n)\s*DONE\s*$/.test((r.finalText || r.allText).trim());
    save();
  }
  // lint -> same-session repair (max 2 passes) before the files leave the sandbox
  for (let pass = 1; pass <= 2; pass++) {
    const lintOut = lintDir(path.join(p.project, "out"), m.name);
    rec.lint = lintOut;
    if (!lintOut.startsWith("WARN")) break;
    const r = await runAgent({ cwd: p.project, agent: "job", model, session, sandbox, logFile: path.join(p.records, "logs", `lint${pass}.jsonl`),
      message: `A mechanical check of your four files in ./out reported:\n${lintOut}\nFix exactly these problems in place (ids R-<n>/T-<n>, the trace table at the end of contract.md, sizes), without changing anything else. End with DONE.` });
    rec.turns++;
    rec.fellBack ||= !!r.fellBack;
    save();
  }
  rec.lint = lintDir(path.join(p.project, "out"), m.name);
  const files = ["MODULE.md", "contract.md", "acceptance-plan.md", "decisions.md"];
  const have = files.filter((f) => fs.existsSync(path.join(p.project, "out", f)));
  rec.ms = Date.now() - rec.startedAt;
  rec.files = have;
  rec.complete = have.length === files.length;
  if (have.length) {
    const dest = path.join(REPO, o.suffix ? "experiments/modules-model-ab" : "templates/modules", m.name + sfx);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of have) fs.copyFileSync(path.join(p.project, "out", f), path.join(dest, f));
    fs.writeFileSync(path.join(dest, "STATUS.md"), `状态：草稿（未经 agent 构建验证）\n生成：${model}，${Math.round(rec.ms / 60000)} 分钟，${rec.turns} 回合${rec.fellBack ? "，用过兜底" : ""}\n文件：${have.join("、")}${rec.complete ? "" : "（不完整）"}\n`);
  }
  save();
  console.log(`modules: ${m.name} ${rec.complete ? "complete" : "INCOMPLETE"} (${Math.round(rec.ms / 60000)} min)`);
}

if (command === "review") {
  // Independent review by a model other than the author: --only <module> --round <tag> [--model m]
  const m = list.find((x) => x.name === o.only);
  const dir = path.join(REPO, "templates", "modules", m.name);
  const tag = o.round ?? "r1";
  const runId = `modules-review-${m.name}-${tag}`;
  const p = runPaths(runId);
  fs.rmSync(p.root, { recursive: true, force: true });
  fs.mkdirSync(p.records, { recursive: true });
  fs.mkdirSync(path.join(p.project, ".opencode", "agents"), { recursive: true });
  fs.mkdirSync(path.join(p.project, "out"), { recursive: true });
  fs.mkdirSync(path.join(p.project, "module"), { recursive: true });
  for (const f of ["MODULE.md", "contract.md", "acceptance-plan.md", "decisions.md"]) fs.copyFileSync(path.join(dir, f), path.join(p.project, "module", f));
  fs.copyFileSync(path.join(REPO, "templates", "HOST.md"), path.join(p.project, "HOST.md"));
  fs.copyFileSync(path.join(REPO, "templates", "modules.json"), path.join(p.project, "modules.json"));
  fs.copyFileSync(path.join(REPO, "templates", "REVIEW-PROMPT.md"), path.join(p.project, "REVIEW-PROMPT.md"));
  fs.copyFileSync(path.join(HARNESS, "agents", "opencode.jsonc"), path.join(p.project, "opencode.jsonc"));
  fs.writeFileSync(path.join(p.project, ".opencode", "agents", "job.md"), AGENT_MD);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: p.project });
  const sandbox = writeProfile(p.sandbox, p.project);
  fs.mkdirSync(path.join(p.records, "logs"), { recursive: true });
  const session = sessionId(runId, Date.now());
  const t0 = Date.now();
  let done = false;
  for (let round = 1; round <= 3 && !done; round++) {
    const r = await runAgent({ cwd: p.project, agent: "job", model, session, sandbox, logFile: path.join(p.records, "logs", `r${round}.jsonl`),
      message: round === 1 ? `Follow ./REVIEW-PROMPT.md exactly. The module "${m.name}" is in ./module (MODULE.md, contract.md, acceptance-plan.md, decisions.md); the host convention is ./HOST.md and the module list ./modules.json. You are an independent reviewer: you did not write it. Instead of the file path named in the prompt, write your review to ./out/REVIEW.md (the only file you may write). Be adversarial and concrete; quote the files. Build the rule->case trace yourself. Finish with the single header statistics line and the word DONE.` : "Continue until ./out/REVIEW.md is complete with its header line. End with DONE." });
    done = /(^|\n)\s*DONE\s*$/.test((r.finalText || r.allText).trim());
  }
  const src = path.join(p.project, "out", "REVIEW.md");
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, `REVIEW-${tag}.md`));
  console.log(`modules: reviewed ${m.name} ${tag} (${Math.round((Date.now() - t0) / 60000)} min, done=${done}, exists=${fs.existsSync(src)})`);
} else if (command === "fix") {
  // Revise one module from its REVIEW.md (same model as the author).
  const m = list.find((x) => x.name === o.only);
  const dir = path.join(REPO, "templates", "modules", m.name);
  const runId = `modules-fix-${m.name}`;
  const p = runPaths(runId);
  fs.rmSync(p.root, { recursive: true, force: true });
  fs.mkdirSync(p.records, { recursive: true });
  fs.mkdirSync(path.join(p.project, ".opencode", "agents"), { recursive: true });
  fs.mkdirSync(path.join(p.project, "out"), { recursive: true });
  for (const f of ["MODULE.md", "contract.md", "acceptance-plan.md", "decisions.md", o.review ? `REVIEW-${o.review}.md` : "REVIEW.md"]) fs.copyFileSync(path.join(dir, f), path.join(p.project, f.startsWith("REVIEW") ? "REVIEW.md" : path.join("out", f)));
  fs.copyFileSync(path.join(REPO, "templates", "HOST.md"), path.join(p.project, "HOST.md"));
  fs.copyFileSync(path.join(HARNESS, "agents", "opencode.jsonc"), path.join(p.project, "opencode.jsonc"));
  fs.writeFileSync(path.join(p.project, ".opencode", "agents", "job.md"), AGENT_MD);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: p.project });
  const sandbox = writeProfile(p.sandbox, p.project);
  fs.mkdirSync(path.join(p.records, "logs"), { recursive: true });
  const session = sessionId(runId, Date.now());
  let done = false;
  const t0 = Date.now();
  for (let round = 1; round <= 4 && !done; round++) {
    const r = await runAgent({ cwd: p.project, agent: "job", model, session, sandbox, logFile: path.join(p.records, "logs", `r${round}.jsonl`),
      message: round === 1 ? `The four files in ./out are a cognition template for module "${m.name}". ./REVIEW.md is an independent review. ./HOST.md is the host convention (it was updated after the review: outbox template names, params, section 3b). Revise the four files in place to resolve EVERY finding in REVIEW.md (also keep R-<n>/T-<n> ids and the trace table at the end of contract.md exact: add a row for every new rule and case) (blocking and should-fix; nice items where cheap): fix contradictions, make rules observable under HOST.md, add numeric bounds, add the missing cases and the rule->case table at the end of contract.md, mark non-observable items as 'suggestions, not tested'. Keep the file structure, language (Chinese) and style. Size limits (hard, keep at least 1 KB spare under each): MODULE.md 15 KB, contract.md 17 KB, acceptance-plan.md 13 KB, decisions.md 7 KB; cut verbosity to make room. Check spelling. Finish with a list of how each finding was handled and the single word DONE.` : "Continue until every finding is handled and files are within limits. End with DONE." });
    done = /(^|\n)\s*DONE\s*$/.test((r.finalText || r.allText).trim());
    if (done) fs.writeFileSync(path.join(p.records, "fix-report.md"), r.finalText || r.allText);
  }
  for (const f of ["MODULE.md", "contract.md", "acceptance-plan.md", "decisions.md"]) fs.copyFileSync(path.join(p.project, "out", f), path.join(dir, f));
  if (fs.existsSync(path.join(p.records, "fix-report.md"))) fs.copyFileSync(path.join(p.records, "fix-report.md"), path.join(dir, `FIX-REPORT${o.review ? "-" + o.review : ""}.md`));
  console.log(`modules: fixed ${m.name} (${Math.round((Date.now() - t0) / 60000)} min, done=${done})`);
} else if (command === "run") {
  assertSandboxAvailable();
  const only = o.only ? o.only.split(",") : null;
  const todo = list.filter((m) => (!only || only.includes(m.name)) && !(state.modules[m.name + sfx]?.complete));
  const jobs = Number(o.jobs ?? 4);
  const queue = [...todo];
  await Promise.all(Array.from({ length: jobs }, async () => { for (let m; (m = queue.shift()); ) await job(m); }));
} else if (command === "status") {
  for (const m of list) { const r = state.modules[m.name]; console.log(`${r?.complete ? "done   " : r ? "partial" : "pending"} ${m.name}${r?.ms ? `  ${Math.round(r.ms / 60000)} min` : ""}`); }
} else {
  console.error("usage: modules.mjs run|status");
  process.exit(2);
}
