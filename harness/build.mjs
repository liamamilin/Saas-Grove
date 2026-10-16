#!/usr/bin/env node
// Group A: build a product from a blueprint, stage by stage.
//
//   node harness/build.mjs new --blueprint <id> --brief <file> [--run <run-id>]
//   node harness/build.mjs step --run <run-id> [--max-attempts 6] [--auto-approve]
//   node harness/build.mjs approve --run <run-id>
//   node harness/build.mjs feedback --run <run-id> (--notes <file> | --review)
//   node harness/build.mjs status --run <run-id>
//
// `step` loops build -> snapshot -> verify (pristine blueprint) -> fix, until
// the stage passes or the attempts run out, then has an independent agent
// review the code and stops at the human checkpoint. `approve` moves to the
// next stage; `feedback` sends review findings or human notes back to the
// builder for another round on the same stage.

import fs from "node:fs";
import path from "node:path";
import {
  MODELS,
  createRun,
  journal,
  loadState,
  loadTemplate,
  newRunId,
  prompt,
  runPaths,
  saveState,
  snapshot,
} from "./lib/run.mjs";
import { agentTurn, describeFailures, verify, writeStatus } from "./lib/steps.mjs";

function args(argv) {
  const [command, ...rest] = argv;
  const opts = { command, maxAttempts: 6 };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const next = () => rest[++i];
    if (a === "--blueprint") opts.blueprint = next();
    else if (a === "--brief") opts.brief = path.resolve(next());
    else if (a === "--run") opts.run = next();
    else if (a === "--notes") opts.notes = path.resolve(next());
    else if (a === "--review") opts.useReview = true;
    else if (a === "--max-attempts") opts.maxAttempts = Number(next());
    else if (a === "--auto-approve") opts.autoApprove = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

function stageDoc(state, stage) {
  return loadTemplate(state.blueprint).stages.find((s) => s.id === stage).doc;
}

// --- commands -------------------------------------------------------------------

function cmdNew(opts) {
  if (!opts.blueprint || !opts.brief) throw new Error("new needs --blueprint and --brief");
  const template = loadTemplate(opts.blueprint);
  const runId = opts.run ?? newRunId("A");
  const p = createRun({ runId, kind: "template", blueprint: opts.blueprint });
  fs.copyFileSync(opts.brief, path.join(p.brief, "user-brief.md"));
  const state = {
    kind: "template",
    blueprint: opts.blueprint,
    stages: template.stages.map((s) => s.id),
    stageIndex: 0,
    phase: "build",
    attempt: 0,
    lastVerify: null,
  };
  saveState(runId, state);
  journal(runId, "run.created", { kind: "template", blueprint: opts.blueprint, brief: opts.brief, models: MODELS });
  snapshot(runId, "run created");
  writeStatus(runId, state);
  console.log(`harness: created run ${runId} at ${p.root}`);
  console.log(`next: node harness/build.mjs step --run ${runId}`);
}

async function buildUntilPass(runId, state, opts, firstMessage) {
  const stage = state.stages[state.stageIndex];
  let message = firstMessage;
  for (;;) {
    state.attempt += 1;
    saveState(runId, state);
    await agentTurn(runId, {
      role: "builder",
      agent: "builder",
      model: MODELS.builder,
      sessionKey: `build${stage}`,
      message,
      label: `${stage}-build-${state.attempt}`,
    });
    const commit = snapshot(runId, `${stage} attempt ${state.attempt}`);
    const v = await verify(runId, { blueprint: state.blueprint, stage, label: `${stage}-a${state.attempt}` });
    state.lastVerify = { label: v.label, passed: v.passed, totals: v.totals, commit };
    if (v.passed) {
      state.phase = "review";
      saveState(runId, state);
      return true;
    }
    if (state.attempt >= opts.maxAttempts) {
      state.phase = "stuck";
      saveState(runId, state);
      journal(runId, "stage.stuck", { stage, attempts: state.attempt });
      return false;
    }
    message = prompt("fix", {
      stage,
      attempt: state.attempt,
      failedCount: v.failures.length || "（应用没能启动）",
      failures: describeFailures(v),
      appLog: v.appLogTail,
    });
  }
}

async function review(runId, state) {
  const stage = state.stages[state.stageIndex];
  const round = (state.reviews?.[stage] ?? 0) + 1;
  const turn = await agentTurn(runId, {
    role: "reviewer",
    agent: "reviewer",
    model: MODELS.reviewer,
    sessionKey: `review${stage}r${round}`,
    message: prompt("review", { stage, stageDoc: stageDoc(state, stage) }),
    label: `${stage}-review-${round}`,
  });
  const dir = path.join(runPaths(runId).records, "reviews");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stage}-r${round}.md`);
  fs.writeFileSync(file, turn.finalText || turn.allText || "(reviewer produced no text)\n");
  state.reviews = { ...(state.reviews ?? {}), [stage]: round };
  state.lastReview = file;
  state.phase = "checkpoint";
  saveState(runId, state);
  return file;
}

async function cmdStep(opts) {
  const runId = opts.run;
  let state = loadState(runId);
  for (;;) {
    const stage = state.stages[state.stageIndex];
    if (state.phase === "done") {
      console.log("harness: all stages approved; the run is done.");
      break;
    }
    if (state.phase === "stuck") {
      console.log(`harness: ${stage} did not pass in ${state.attempt} attempts. Look at ${runPaths(runId).records}/verify,`);
      console.log(`then send guidance: node harness/build.mjs feedback --run ${runId} --notes <file>`);
      break;
    }
    if (state.phase === "build") {
      const brief = fs.readFileSync(path.join(runPaths(runId).brief, "user-brief.md"), "utf8").trim();
      await buildUntilPass(runId, state, opts, prompt("stage", { brief, stage, stageDoc: stageDoc(state, stage) }));
      continue;
    }
    if (state.phase === "review") {
      await review(runId, state);
      continue;
    }
    if (state.phase === "checkpoint") {
      if (opts.autoApprove) {
        approve(runId, state, "auto");
        continue;
      }
      console.log(`harness: ${stage} passed acceptance (${state.lastVerify.totals.passed} tests) and was reviewed.`);
      console.log(`  review: ${state.lastReview}`);
      console.log(`  approve:  node harness/build.mjs approve --run ${runId}`);
      console.log(`  or fix:   node harness/build.mjs feedback --run ${runId} --review   (or --notes <file>)`);
      break;
    }
    throw new Error(`unknown phase ${state.phase}`);
  }
  writeStatus(runId, state);
}

function approve(runId, state, by) {
  const stage = state.stages[state.stageIndex];
  journal(runId, by === "auto" ? "auto.approve" : "human.approve", { stage, commit: state.lastVerify?.commit });
  state.stageIndex += 1;
  state.attempt = 0;
  state.lastVerify = null;
  state.phase = state.stageIndex >= state.stages.length ? "done" : "build";
  saveState(runId, state);
}

function cmdApprove(opts) {
  const state = loadState(opts.run);
  if (state.phase !== "checkpoint") throw new Error(`nothing to approve: phase is ${state.phase}`);
  approve(opts.run, state, "human");
  writeStatus(opts.run, state);
  console.log(state.phase === "done" ? "harness: run done." : `harness: approved; next: node harness/build.mjs step --run ${opts.run}`);
}

async function cmdFeedback(opts) {
  const runId = opts.run;
  const state = loadState(runId);
  if (!["checkpoint", "stuck"].includes(state.phase)) throw new Error(`feedback applies at a checkpoint or when stuck, not in ${state.phase}`);
  const notesFile = opts.useReview ? state.lastReview : opts.notes;
  if (!notesFile || !fs.existsSync(notesFile)) throw new Error("feedback needs --notes <file> or --review");
  const notes = fs.readFileSync(notesFile, "utf8");
  const stage = state.stages[state.stageIndex];
  journal(runId, "human.feedback", { stage, source: opts.useReview ? "review" : notesFile });
  state.phase = "build";
  if (state.attempt >= opts.maxAttempts) state.attempt = 0; // a human intervention grants a new allowance
  saveState(runId, state);
  await buildUntilPass(runId, state, opts, prompt("feedback", { stage, notes }));
  await cmdStep(opts);
}

async function main() {
  const opts = args(process.argv.slice(2));
  if (opts.command === "new") return cmdNew(opts);
  if (!opts.run) throw new Error(`${opts.command} needs --run <run-id>`);
  if (opts.command === "step") return cmdStep(opts);
  if (opts.command === "approve") return cmdApprove(opts);
  if (opts.command === "feedback") return cmdFeedback(opts);
  if (opts.command === "status") return console.log(writeStatus(opts.run, loadState(opts.run)));
  throw new Error("usage: build.mjs new|step|approve|feedback|status (see the header of this file)");
}

main().catch((e) => {
  console.error(`harness: ${e.message}`);
  process.exit(1);
});
