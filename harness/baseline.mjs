#!/usr/bin/env node
// Group B: build the same product WITHOUT the blueprint.
//
//   node harness/baseline.mjs new --blueprint <id> --brief <file> [--run <run-id>]
//   node harness/baseline.mjs go --run <run-id> [--max-rounds 6]
//   node harness/baseline.mjs review --run <run-id>   (normally part of `go`; runs the final review alone)
//   node harness/baseline.mjs status --run <run-id>
//
// The builder gets the user's brief plus the blueprint's *test contract* only:
// the API contract and the testability sections of the architecture (fake model,
// test endpoints, start script, UI test ids). Without them no black-box test
// could score the result at all. It does not get the product definition, the
// pitfalls, the hard-part designs, the stage plan, the landscape or the tests.
//
// The contract lists every endpoint, so it already reveals the feature list:
// the A-B gap measured this way is a lower bound on what the blueprint adds.

import fs from "node:fs";
import path from "node:path";
import {
  MODELS,
  blueprintDir,
  createRun,
  journal,
  loadState,
  newRunId,
  prompt,
  runPaths,
  saveState,
  snapshot,
} from "./lib/run.mjs";
import { agentTurn, verify, writeStatus } from "./lib/steps.mjs";
import { loadTemplate } from "./lib/run.mjs";

function args(argv) {
  const [command, ...rest] = argv;
  const opts = { command, maxRounds: 6 };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const next = () => rest[++i];
    if (a === "--blueprint") opts.blueprint = next();
    else if (a === "--brief") opts.brief = path.resolve(next());
    else if (a === "--run") opts.run = next();
    else if (a === "--max-rounds") opts.maxRounds = Number(next());
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

/** The testability part of the architecture: from §5 (fake model) to the end. */
function testabilityExtract(blueprint) {
  const arch = fs.readFileSync(path.join(blueprintDir(blueprint), "spec", "architecture.md"), "utf8");
  const start = arch.indexOf("## 5.");
  if (start < 0) throw new Error("architecture.md has no §5 to extract");
  return [
    "# 测试接口约定（可测性契约）",
    "",
    "> 这不是需求说明。它规定的是：为了让自动化评分能操作你的产品，产品必须遵守的测试约定。",
    "",
    arch.slice(start),
  ].join("\n");
}

function cmdNew(opts) {
  if (!opts.blueprint || !opts.brief) throw new Error("new needs --blueprint and --brief");
  const runId = opts.run ?? newRunId("B");
  const p = createRun({ runId, kind: "baseline", blueprint: opts.blueprint });
  fs.copyFileSync(opts.brief, path.join(p.brief, "user-brief.md"));
  fs.mkdirSync(path.join(p.brief, "contract"), { recursive: true });
  fs.copyFileSync(path.join(blueprintDir(opts.blueprint), "spec", "api.yaml"), path.join(p.brief, "contract", "api.yaml"));
  fs.writeFileSync(path.join(p.brief, "contract", "testability.md"), testabilityExtract(opts.blueprint));
  const state = { kind: "baseline", blueprint: opts.blueprint, phase: "build", round: 0, done: false };
  saveState(runId, state);
  journal(runId, "run.created", { kind: "baseline", blueprint: opts.blueprint, brief: opts.brief, models: MODELS });
  snapshot(runId, "run created");
  writeStatus(runId, state);
  console.log(`harness: created baseline run ${runId} at ${p.root}`);
  console.log(`next: node harness/baseline.mjs go --run ${runId}`);
}

async function reviewFinal(runId, state) {
  const p = runPaths(runId);
  const src = blueprintDir(state.blueprint);
  for (const dir of ["spec", "stages"]) {
    fs.cpSync(path.join(src, dir), path.join(p.blueprint, dir), { recursive: true });
  }
  const stage = "S4";
  const stageDoc = loadTemplate(state.blueprint).stages.find((x) => x.id === stage).doc;
  const turn = await agentTurn(runId, {
    role: "reviewer",
    agent: "reviewer",
    model: MODELS.reviewer,
    sessionKey: "reviewfinal",
    message: prompt("review-baseline", {
      stage,
      stageDoc,
      passed: state.finalTotals?.passed ?? "?",
      failed: state.finalTotals?.failed ?? "?",
    }),
    label: "final-review",
  });
  const dir = path.join(p.records, "reviews");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "final-r1.md");
  fs.writeFileSync(file, turn.finalText || turn.allText || "(reviewer produced no text)\n");
  state.lastReview = file;
}

async function cmdGo(opts) {
  const runId = opts.run;
  const state = loadState(runId);
  const brief = fs.readFileSync(path.join(runPaths(runId).brief, "user-brief.md"), "utf8").trim();
  while (state.phase === "build") {
    state.round += 1;
    saveState(runId, state);
    const turn = await agentTurn(runId, {
      role: "builder",
      agent: "builder",
      model: MODELS.builder,
      sessionKey: "baseline",
      message: state.round === 1 ? prompt("baseline", { brief }) : prompt("baseline-continue", {}),
      label: `round-${state.round}`,
    });
    snapshot(runId, `round ${state.round}`);
    const saidDone = /(^|\n)\s*DONE\s*$/.test((turn.finalText || turn.allText).trim());
    if (saidDone || state.round >= opts.maxRounds) {
      state.done = saidDone;
      state.phase = "score";
      journal(runId, "baseline.stopped", { round: state.round, saidDone });
    }
    saveState(runId, state);
  }
  if (state.phase === "score") {
    // Scored once, on every stage at once, with the tests it never saw.
    const v = await verify(runId, { blueprint: state.blueprint, stage: "S4", label: "final-S4" });
    state.finalTotals = v.totals ?? null;
    state.phase = "review";
    saveState(runId, state);
  }
  if (state.phase === "review") {
    // Group A is reviewed at every checkpoint; "review findings" is one of the metrics we compare,
    // so B gets the same reviewer, the same model and the same prompt (apart from one sentence
    // saying the product was not built from the template), once, on the final code. The standard it
    // is held against is copied in only now: the builder is finished and can no longer see it.
    await reviewFinal(runId, state);
    state.phase = "scored";
    saveState(runId, state);
  }
  console.log(writeStatus(runId, state));
}

async function main() {
  const opts = args(process.argv.slice(2));
  if (opts.command === "new") return cmdNew(opts);
  if (!opts.run) throw new Error(`${opts.command} needs --run <run-id>`);
  if (opts.command === "go") return cmdGo(opts);
  if (opts.command === "review") {
    const state = loadState(opts.run);
    await reviewFinal(opts.run, state);
    saveState(opts.run, state);
    return console.log(`harness: review written to ${state.lastReview}`);
  }
  if (opts.command === "status") return console.log(writeStatus(opts.run, loadState(opts.run)));
  throw new Error("usage: baseline.mjs new|go|status (see the header of this file)");
}

main().catch((e) => {
  console.error(`harness: ${e.message}`);
  process.exit(1);
});
