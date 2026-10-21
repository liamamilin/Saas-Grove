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

const PROMPT = (m) => `You are writing a COGNITION TEMPLATE for the SaaS module "${m.name}" (${m.scope}). The reader is a coding agent that will implement this module in a buyer's own stack; the buyer is not an expert. A cognition template teaches what a mature version of this module is, NOT code. No vendor names, no library-specific code, no implementation code (short pseudo-steps and example payloads are fine).
${m.source ? `Cognition source: ./source (the open-source next-forge package "${m.source}", MIT). Read it to learn what the module covers; drop its vendor lock-in and rewrite in vendor-neutral terms.` : "There is no source package for this module; use your own knowledge of mature SaaS products."}
Write these files in ./out, in Chinese (keep identifiers, HTTP and code terms in English):
1. MODULE.md — sections: 这个模块是什么 / 成熟版应该有什么（按 MVP→成熟分层，逐条）/ 每项的正确行为 / 容易做错的地方（具体到会出什么事故）/ 与其他模块的接口（只列模块名和接口含义）/ 不做什么。
2. contract.md — the black-box contract another agent's tests can rely on: observable behaviors, status codes and error shapes written as rules (no framework names), data that must be stored hashed, invariants. Every rule must be checkable from outside the running application.
3. acceptance-plan.md — 15-30 black-box test cases as a table: id, given, action, expected, negative(yes/no). Include the hard negatives (isolation, replay, limits, races). Executable tests come later; this is the plan.
4. decisions.md — human decision points with a recommended default each and the consequence of choosing otherwise.
Be concrete and complete, not generic. Finish with a two-line summary and the single word DONE.`;

async function job(m) {
  const runId = `modules-${m.name}`;
  const p = runPaths(runId);
  fs.rmSync(p.root, { recursive: true, force: true });
  fs.mkdirSync(p.records, { recursive: true });
  fs.mkdirSync(path.join(p.project, ".opencode", "agents"), { recursive: true });
  fs.mkdirSync(path.join(p.project, "out"), { recursive: true });
  if (m.source) fs.cpSync(path.join(REPO, "references", "next-forge", "packages", m.source), path.join(p.project, "source"), { recursive: true, filter: (f) => !/node_modules|\.DS_Store/.test(f) });
  fs.copyFileSync(path.join(HARNESS, "agents", "opencode.jsonc"), path.join(p.project, "opencode.jsonc"));
  fs.writeFileSync(path.join(p.project, ".opencode", "agents", "job.md"), AGENT_MD);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: p.project });
  const sandbox = writeProfile(p.sandbox, p.project);
  fs.mkdirSync(path.join(p.records, "logs"), { recursive: true });
  const session = sessionId(runId, Date.now());
  const rec = { model, startedAt: Date.now(), turns: 0, fellBack: false };
  state.modules[m.name] = rec;
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
  const files = ["MODULE.md", "contract.md", "acceptance-plan.md", "decisions.md"];
  const have = files.filter((f) => fs.existsSync(path.join(p.project, "out", f)));
  rec.ms = Date.now() - rec.startedAt;
  rec.files = have;
  rec.complete = have.length === files.length;
  if (have.length) {
    const dest = path.join(REPO, "templates", "modules", m.name);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of have) fs.copyFileSync(path.join(p.project, "out", f), path.join(dest, f));
    fs.writeFileSync(path.join(dest, "STATUS.md"), `状态：草稿（未经 agent 构建验证）\n生成：${model}，${Math.round(rec.ms / 60000)} 分钟，${rec.turns} 回合${rec.fellBack ? "，用过兜底" : ""}\n文件：${have.join("、")}${rec.complete ? "" : "（不完整）"}\n`);
  }
  save();
  console.log(`modules: ${m.name} ${rec.complete ? "complete" : "INCOMPLETE"} (${Math.round(rec.ms / 60000)} min)`);
}

if (command === "run") {
  assertSandboxAvailable();
  const only = o.only ? o.only.split(",") : null;
  const todo = list.filter((m) => (!only || only.includes(m.name)) && !(state.modules[m.name]?.complete));
  const jobs = Number(o.jobs ?? 4);
  const queue = [...todo];
  await Promise.all(Array.from({ length: jobs }, async () => { for (let m; (m = queue.shift()); ) await job(m); }));
} else if (command === "status") {
  for (const m of list) { const r = state.modules[m.name]; console.log(`${r?.complete ? "done   " : r ? "partial" : "pending"} ${m.name}${r?.ms ? `  ${Math.round(r.ms / 60000)} min` : ""}`); }
} else {
  console.error("usage: modules.mjs run|status");
  process.exit(2);
}
