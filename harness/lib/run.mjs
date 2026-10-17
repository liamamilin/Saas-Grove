// Run directories: one per build.
//
//   $HARNESS_RUNS_DIR/<id>/   (default /Users/Shared/saas-template-runs)
//     project/          the agent's world, its own git repository (snapshots)
//       app/            the product the agent builds (the only place it may edit)
//       blueprint/      a copy of the blueprint for the agent to read (A only)
//       brief/          the user brief, and for B the test contract
//       .opencode/      agent definitions, rewritten before every turn
//       opencode.jsonc  project policy, rewritten likewise
//     records/          the harness's own records: state, journal, logs,
//                       verification reports, reviews, sandbox profile
//
// Agent turns run in a sandbox that can reach <id>/project and nothing else of
// the runs directory or of $HOME, so records, other runs, the repository (the
// pristine blueprint, the acceptance tests, .env) are out of the agent's reach. Verification always runs the
// pristine blueprint in the main repository against project/app.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HARNESS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO = path.dirname(HARNESS);
// Outside the home directory on purpose: opencode resolves every ancestor of
// its project directory at startup, and the sandbox denies everything under
// $HOME, so runs inside the repository could not start. Override with
// HARNESS_RUNS_DIR.
export const RUNS = process.env.HARNESS_RUNS_DIR ?? "/Users/Shared/saas-template-runs";

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
  const project = path.join(root, "project");
  const records = path.join(root, "records");
  return {
    root,
    project,
    app: path.join(project, "app"),
    blueprint: path.join(project, "blueprint"),
    brief: path.join(project, "brief"),
    records,
    journal: path.join(records, "journal.jsonl"),
    state: path.join(records, "state.json"),
    sandbox: path.join(records, "sandbox.sb"),
  };
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Copy a blueprint, including the acceptance suite's installed dependencies as
 * real files (relative symlinks inside node_modules kept as they are). Nothing
 * in the copy points back into the main repository.
 */
function copyBlueprint(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (p) => !/(^|\/)(acceptance-results|\.DS_Store)(\/|$)/.test(p),
  });
}

/**
 * Copy only the acceptance suite of a blueprint (tests, runner and installed dependencies) into
 * `project/blueprint/acceptance`, so the builder can run it with the same command group A uses.
 * Nothing else of the blueprint is copied: no spec, no stages, no template instructions, and not
 * the suite's own README (which talks about the spec).
 */
export function copyAcceptanceOnly(blueprintId, runId) {
  const dest = path.join(runPaths(runId).blueprint, "acceptance");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(path.join(blueprintDir(blueprintId), "acceptance"), dest, {
    recursive: true,
    verbatimSymlinks: true,
    // Dependencies are copied as they are; only the suite's own files are filtered.
    filter: (p) =>
      p.includes("node_modules") ||
      (!/(^|\/)(acceptance-results|\.DS_Store)(\/|$)/.test(p) && path.basename(p) !== "README.md"),
  });
}

export function createRun({ runId, kind, blueprint }) {
  const p = runPaths(runId);
  if (fs.existsSync(p.root)) throw new Error(`run ${runId} already exists`);
  fs.mkdirSync(p.app, { recursive: true });
  fs.mkdirSync(p.brief, { recursive: true });
  fs.mkdirSync(p.records, { recursive: true });
  if (kind === "template") copyBlueprint(blueprintDir(blueprint), p.blueprint);
  fs.writeFileSync(
    path.join(p.project, ".gitignore"),
    ["node_modules/", ".next/", "acceptance-results/", ".DS_Store", ""].join("\n"),
  );
  fs.writeFileSync(path.join(p.app, ".keep"), "");
  git(p.project, "init", "-q", "-b", "main");
  return p;
}

/** Write the project policy and agent definitions for this run (every turn). */
export function writeAgentConfig(runId) {
  const p = runPaths(runId);
  fs.mkdirSync(path.join(p.project, ".opencode", "agents"), { recursive: true });
  fs.copyFileSync(path.join(HARNESS, "agents", "opencode.jsonc"), path.join(p.project, "opencode.jsonc"));
  for (const name of ["builder.md", "reviewer.md"]) {
    fs.copyFileSync(path.join(HARNESS, "agents", name), path.join(p.project, ".opencode", "agents", name));
  }
}

/** Commit the run's project as a snapshot; returns the commit id. */
export function snapshot(runId, message) {
  const root = runPaths(runId).project;
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
