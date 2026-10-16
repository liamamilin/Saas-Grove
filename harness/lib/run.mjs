// Run directories: one per build, each its own git repository.
//
//   runs/<id>/
//     app/            the product the agent builds (the only place it may edit)
//     blueprint/      a copy of the blueprint for the agent to read (read-only by policy)
//     brief/          inputs that are not the blueprint (user brief, test contract)
//     .opencode/      agent definitions, rewritten by the harness before every turn
//     opencode.jsonc  project policy, rewritten likewise
//     harness/        the harness's own records (journal, logs, verify reports, reviews)
//
// Verification never uses runs/<id>/blueprint: it runs the pristine copy in the
// main repository, so whatever the agent does to its copy changes nothing.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HARNESS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO = path.dirname(HARNESS);
export const RUNS = path.join(REPO, "runs");

export const MODELS = {
  builder: "open-design/deepseek-v4.1-flash",
  reviewer: "open-design/deepseek-v4-pro",
  userSim: "open-design/deepseek-v4-pro",
};

export function blueprintDir(id) {
  const dir = path.join(REPO, "blueprints", id);
  if (!fs.existsSync(path.join(dir, "template.json"))) throw new Error(`no blueprint ${id} at ${dir}`);
  return dir;
}

export function loadTemplate(id) {
  return JSON.parse(fs.readFileSync(path.join(blueprintDir(id), "template.json"), "utf8"));
}

export function runPaths(runId) {
  const root = path.join(RUNS, runId);
  return {
    root,
    app: path.join(root, "app"),
    blueprint: path.join(root, "blueprint"),
    brief: path.join(root, "brief"),
    records: path.join(root, "harness"),
    journal: path.join(root, "harness", "journal.jsonl"),
    state: path.join(root, "harness", "state.json"),
  };
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Copy a blueprint without its installed or generated files. */
function copyBlueprint(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (p) => !/(^|\/)(node_modules|acceptance-results|\.DS_Store)(\/|$)/.test(p),
  });
  // Let the agent run the acceptance suite from its copy without installing anything.
  const modules = path.join(src, "acceptance", "node_modules");
  if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(dest, "acceptance", "node_modules"));
}

export function createRun({ runId, kind, blueprint }) {
  const p = runPaths(runId);
  if (fs.existsSync(p.root)) throw new Error(`run ${runId} already exists`);
  fs.mkdirSync(p.app, { recursive: true });
  fs.mkdirSync(p.brief, { recursive: true });
  fs.mkdirSync(p.records, { recursive: true });
  if (kind === "template") copyBlueprint(blueprintDir(blueprint), p.blueprint);
  fs.writeFileSync(
    path.join(p.root, ".gitignore"),
    ["node_modules/", ".next/", "acceptance-results/", "blueprint/acceptance/node_modules", "harness/", ".DS_Store", ""].join("\n"),
  );
  fs.writeFileSync(path.join(p.app, ".keep"), "");
  git(p.root, "init", "-q", "-b", "main");
  return p;
}

/** Write the project policy and agent definitions for this run (every turn). */
export function writeAgentConfig(runId) {
  const p = runPaths(runId);
  fs.mkdirSync(path.join(p.root, ".opencode", "agents"), { recursive: true });
  fs.copyFileSync(path.join(HARNESS, "agents", "opencode.jsonc"), path.join(p.root, "opencode.jsonc"));
  for (const name of ["builder.md", "reviewer.md"]) {
    fs.copyFileSync(path.join(HARNESS, "agents", name), path.join(p.root, ".opencode", "agents", name));
  }
}

/** Commit the run's current files as a snapshot; returns the commit id. */
export function snapshot(runId, message) {
  const root = runPaths(runId).root;
  git(root, "add", "-A");
  try {
    git(root, "-c", "user.name=harness", "-c", "user.email=harness@localhost", "commit", "-q", "--allow-empty", "-m", message);
  } catch (e) {
    throw new Error(`snapshot failed: ${e.stderr || e.message}`);
  }
  return git(root, "rev-parse", "--short", "HEAD");
}

export function journal(runId, event, data = {}) {
  const record = { at: new Date().toISOString(), event, ...data };
  fs.appendFileSync(runPaths(runId).journal, JSON.stringify(record) + "\n");
  return record;
}

export function readJournal(runId) {
  const file = runPaths(runId).journal;
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export function loadState(runId) {
  return JSON.parse(fs.readFileSync(runPaths(runId).state, "utf8"));
}

export function saveState(runId, state) {
  fs.writeFileSync(runPaths(runId).state, JSON.stringify(state, null, 2) + "\n");
}

export function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`prompt variable ${k} missing`);
    return String(vars[k]);
  });
}

export function prompt(name, vars) {
  return fill(fs.readFileSync(path.join(HARNESS, "prompts", `${name}.md`), "utf8"), vars);
}

export function newRunId(kind) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  return `${kind}-${stamp}`;
}
