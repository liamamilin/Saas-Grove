#!/usr/bin/env node
// Independent review of a blueprint change (tests + spec), by the read-only reviewer.
//
//   node harness/review-blueprint.mjs --blueprint <id> --since <git-ref> --why <file> [--focus <file>] [--run <run-id>]
//
// --focus is a Markdown list of the things to check; the default is prompts/review-blueprint-focus.md.
//
// Builds a throwaway run whose blueprint/ is the current working tree (without installed dependencies), a
// CHANGES.diff against <git-ref>, and the reason for the changes. The report is written to
// <run>/records/reviews/blueprint.md. Nothing in the main repository is touched.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { HARNESS, MODELS, REPO, blueprintDir, createRun, newRunId, prompt, runPaths, snapshot, saveState } from "./lib/run.mjs";
import { agentTurn } from "./lib/steps.mjs";

const opts = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--blueprint") opts.blueprint = argv[++i];
  else if (a === "--since") opts.since = argv[++i];
  else if (a === "--why") opts.why = path.resolve(argv[++i]);
  else if (a === "--focus") opts.focus = path.resolve(argv[++i]);
  else if (a === "--run") opts.run = argv[++i];
  else throw new Error(`unknown argument ${a}`);
}
if (!opts.blueprint || !opts.since || !opts.why) throw new Error("needs --blueprint, --since and --why");

const runId = opts.run ?? newRunId("R");
const p = createRun({ runId, kind: "baseline", blueprint: opts.blueprint });
fs.mkdirSync(p.blueprint, { recursive: true });
execFileSync("rsync", [
  "-a",
  "--exclude", "node_modules",
  "--exclude", "acceptance-results",
  "--exclude", ".DS_Store",
  `${blueprintDir(opts.blueprint)}/`,
  `${p.blueprint}/`,
]);
const diff = execFileSync("git", ["diff", opts.since, "--", path.relative(REPO, blueprintDir(opts.blueprint))], { cwd: REPO, encoding: "utf8" });
fs.writeFileSync(path.join(p.project, "CHANGES.diff"), diff);
fs.copyFileSync(opts.why, path.join(p.project, "CHANGES-WHY.md"));
saveState(runId, { kind: "blueprint-review", blueprint: opts.blueprint, phase: "review" });
snapshot(runId, "blueprint under review");

const turn = await agentTurn(runId, {
  role: "reviewer",
  agent: "reviewer",
  model: MODELS.reviewer,
  sessionKey: "blueprintreview",
  message: prompt("review-blueprint", { focus: fs.readFileSync(opts.focus ?? path.join(HARNESS, "prompts", "review-blueprint-focus.md"), "utf8").trim() }),
  label: "blueprint-review",
});
const dir = path.join(p.records, "reviews");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, "blueprint.md");
fs.writeFileSync(file, turn.finalText || turn.allText || "(reviewer produced no text)\n");
console.log(`harness: review written to ${file}`);
