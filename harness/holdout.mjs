#!/usr/bin/env node
// Held-out test authoring: an agent that has never seen an implementation or the existing
// acceptance tests writes an extra black-box suite from the contract (and, for bucket "spec",
// the spec). The suite is frozen before it is used and never shown to any builder.
//
//   node harness/holdout.mjs new --bucket contract|spec --model <provider/model> [--run <id>]
//   node harness/holdout.mjs go  --run <id>
//
// bucket "contract": brief + contract (api.yaml, testability.md). Fair to every arm.
// bucket "spec":     the same plus product.md, architecture.md and decisions.md; asks for
//                    observable requirements the contract does not state (what only the full
//                    template knows).
//
// The author runs in the same macOS sandbox as a builder: it sees only its own project/ directory.
// That directory holds the runner and its helper library (tools), but none of the existing tests.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { HARNESS, REPO, blueprintDir, journal, runPaths, saveState, loadState } from "./lib/run.mjs";
import { runAgent, sessionId, sessionUsage } from "./lib/opencode.mjs";
import { assertSandboxAvailable, writeProfile } from "./lib/sandbox.mjs";

const BLUEPRINT = "ai-research-assistant";

function args(argv) {
  const [command, ...rest] = argv;
  const opts = { command };
  for (let i = 0; i < rest.length; i++) {
    const next = () => rest[++i];
    if (rest[i] === "--bucket") opts.bucket = next();
    else if (rest[i] === "--model") opts.model = next();
    else if (rest[i] === "--run") opts.run = next();
  }
  return opts;
}

const AGENT = `---
description: Writes a held-out acceptance test suite. Edits only the tests directory.
mode: primary
steps: 1500
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: edit
    resource: "blueprint/acceptance/tests/**"
    effect: allow
  - action: webfetch
    resource: "*"
    effect: deny
  - action: websearch
    resource: "*"
    effect: deny
  - action: execute
    resource: "*"
    effect: deny
  - action: code
    resource: "*"
    effect: deny
  - action: subagent
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
  - action: shell
    resource: "brew *"
    effect: deny
---

You write a held-out black-box acceptance suite. Edit files only under blueprint/acceptance/tests/.
Never read, print or copy secrets. Installing nothing new is needed; the runner's dependencies are installed.
`;

function promptFor(bucket) {
  const common = `
You are the author of a HELD-OUT acceptance test suite for a SaaS product. You have never seen an implementation, and you have not seen any other test for it. Several independently built implementations will later be run against your tests. A good test passes on every correct implementation of the contract and fails on an incorrect one.

Inputs (read all of them first):
- brief/user-brief.md — what the user asked for.
- brief/contract/api.yaml and brief/contract/testability.md — the interface every implementation must obey (HTTP API, fake model, test routes, start convention, UI anchors, what the suite may inspect in the database).
${bucket === "spec" ? "- brief/spec/product.md, brief/spec/architecture.md, brief/spec/decisions.md — the full specification of the product.\n" : ""}- blueprint/acceptance/run.mjs, lib/*, fixtures/, package.json, vitest.config.ts — the runner and its helper library. These are tools: read lib/ to learn how to start requests, use the fake model, restart, start extra instances and inspect the database. The directory tests/ is empty; there are no other tests.

What to write:
- Put new test files in blueprint/acceptance/tests/s4/, named holdout-<topic>.test.ts. Aim for 25 to 40 tests in total, grouped by topic.
- ${bucket === "contract"
    ? "Test the behaviour a mature, sellable product of this kind must get right and that the contract lets a black-box test observe: tenant isolation, permissions per role, input validation and error shapes, boundary values, concurrency and idempotency, security (authentication, injection, secrets), usage/budget accounting and money paths in every place the product calls the model, report and citation integrity, deletion semantics, the user-facing UI. Choose what to test yourself; do not limit yourself to the obvious happy paths."
    : "Test requirements that the specification states (product.md, architecture.md, decisions.md) and that can be observed through the HTTP API, the UI or the database as the contract allows, but that the contract files do NOT already state. Skip anything not observable from outside. Choose what to test yourself."}
- Every test carries a comment naming the clause of the ${bucket === "spec" ? "specification" : "contract or brief"} it derives from. Rely only on documented behaviour. If the documents are ambiguous, do not test that point; list it in blueprint/acceptance/tests/s4/HOLDOUT-NOTES.md.
- No timing luck: wait for conditions with polling and generous limits, not fixed short sleeps. Each test must be independent of the others (own workspace/user).
- Use only the fake model and test routes the contract describes, except where the contract describes a way to test real mode.

How to check your work:
- You cannot run the tests against a real implementation. Run \`node blueprint/acceptance/run.mjs --self-check\` (from the project directory): it runs every test against an empty app and passes only if every test fails at an assertion about the app. Fix every test bug it reports and every vacuous test (one that passes on an empty app).
- Re-read each test against the contract once more: a test that a correct implementation could fail is worse than no test.

Finish with a short summary in Chinese: how many tests, the topics, which points you left out because the documents were ambiguous. End with the single word DONE.
`;
  return common;
}

function cmdNew(opts) {
  if (!["contract", "spec"].includes(opts.bucket) || !opts.model) throw new Error("new needs --bucket contract|spec and --model");
  const runId = opts.run ?? `H-${opts.bucket}-${new Date().toISOString().slice(0, 10)}`;
  const p = runPaths(runId);
  if (fs.existsSync(p.root)) throw new Error(`run ${runId} exists`);
  fs.mkdirSync(p.records, { recursive: true });
  fs.mkdirSync(path.join(p.project, "brief", "contract"), { recursive: true });
  const bp = blueprintDir(BLUEPRINT);
  fs.copyFileSync(path.join(REPO, "experiments", "ab-01", "user-brief.md"), path.join(p.brief, "user-brief.md"));
  fs.copyFileSync(path.join(bp, "spec", "api.yaml"), path.join(p.brief, "contract", "api.yaml"));
  // The same contract extract a baseline builder gets.
  const tmp = `HOLDOUT-${process.pid}`;
  execFileSync("node", [path.join(HARNESS, "baseline.mjs"), "new", "--blueprint", BLUEPRINT, "--brief", path.join(REPO, "experiments", "ab-01", "user-brief.md"), "--run", tmp], { stdio: "ignore" });
  fs.copyFileSync(path.join(runPaths(tmp).brief, "contract", "testability.md"), path.join(p.brief, "contract", "testability.md"));
  fs.rmSync(runPaths(tmp).root, { recursive: true, force: true });
  if (opts.bucket === "spec") {
    fs.mkdirSync(path.join(p.brief, "spec"), { recursive: true });
    for (const f of ["product.md", "architecture.md", "decisions.md"]) fs.copyFileSync(path.join(bp, "spec", f), path.join(p.brief, "spec", f));
  }
  // Tools only: the runner and its helpers, never the tests.
  const dest = path.join(p.project, "blueprint", "acceptance");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(path.join(bp, "acceptance"), dest, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (f) => {
      if (f.includes("node_modules")) return true;
      const rel = path.relative(path.join(bp, "acceptance"), f);
      if (/^tests\/.+/.test(rel)) return false;
      return !/(^|\/)(acceptance-results|\.DS_Store)(\/|$)/.test(rel) && path.basename(f) !== "README.md";
    },
  });
  fs.mkdirSync(path.join(dest, "tests", "s4"), { recursive: true });
  for (const s of ["s1", "s2", "s3"]) fs.mkdirSync(path.join(dest, "tests", s), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: p.project });
  fs.writeFileSync(path.join(p.project, ".gitignore"), "node_modules/\nacceptance-results/\n.DS_Store\n");
  saveState(runId, { kind: "holdout", bucket: opts.bucket, model: opts.model, phase: "author" });
  journal(runId, "run.created", { kind: "holdout", bucket: opts.bucket, model: opts.model });
  console.log(`harness: created held-out authoring run ${runId} at ${p.root}\nnext: node harness/holdout.mjs go --run ${runId}`);
}

async function cmdGo(opts) {
  const runId = opts.run;
  const state = loadState(runId);
  const p = runPaths(runId);
  fs.mkdirSync(path.join(p.project, ".opencode", "agents"), { recursive: true });
  fs.copyFileSync(path.join(HARNESS, "agents", "opencode.jsonc"), path.join(p.project, "opencode.jsonc"));
  fs.writeFileSync(path.join(p.project, ".opencode", "agents", "author.md"), AGENT);
  assertSandboxAvailable();
  const sandbox = writeProfile(p.sandbox, p.project);
  const logDir = path.join(p.records, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const session = sessionId(runId, "author");
  console.log(`harness: author turn (${state.model}, bucket ${state.bucket}) …`);
  const result = await runAgent({
    cwd: p.project,
    agent: "author",
    model: state.model,
    session,
    message: promptFor(state.bucket),
    logFile: path.join(logDir, "author.jsonl"),
    sandbox,
  });
  const usage = sessionUsage(p.project, session);
  journal(runId, "agent.turn", { role: "author", label: "author", model: state.model, session, exitCode: result.exitCode, ms: result.ms, tokens: usage, errors: result.errors });
  fs.writeFileSync(path.join(logDir, "author.md"), result.allText || "(no text output)\n");
  const tests = path.join(p.project, "blueprint", "acceptance", "tests", "s4");
  const files = fs.existsSync(tests) ? fs.readdirSync(tests).filter((f) => f.endsWith(".test.ts")) : [];
  state.phase = "authored";
  saveState(runId, state);
  execFileSync("git", ["add", "-A"], { cwd: p.project });
  try {
    execFileSync("git", ["-c", "user.name=harness", "-c", "user.email=harness@local", "commit", "-q", "-m", "authored"], { cwd: p.project });
  } catch {
    /* nothing to commit */
  }
  console.log(`harness: author done in ${(result.ms / 60000).toFixed(1)} min, exit ${result.exitCode}; ${files.length} test files in ${tests}`);
}

const opts = args(process.argv.slice(2));
if (opts.command === "new") cmdNew(opts);
else if (opts.command === "go") await cmdGo(opts);
else throw new Error("usage: holdout.mjs new|go");
