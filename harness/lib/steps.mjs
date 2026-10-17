// Steps shared by the template (A) and baseline (B) flows: one agent turn with
// accounting, verification against the pristine blueprint, and status output.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runAgent, sessionId, sessionUsage } from "./opencode.mjs";
import { blueprintDir, journal, readJournal, runPaths, writeAgentConfig } from "./run.mjs";
import { assertSandboxAvailable, writeProfile } from "./sandbox.mjs";

/** One agent turn in a run, journaled with time and token deltas. */
export async function agentTurn(runId, { role, agent, model, sessionKey, message, label }) {
  const p = runPaths(runId);
  writeAgentConfig(runId);
  const session = sessionId(runId, sessionKey);
  // Usage before this turn comes from our own journal, never from exporting the
  // session first: exporting a session that does not exist yet creates it on
  // the shared background service, bound to a config without our agents.
  const before = lastUsage(runId, session);
  const logDir = path.join(p.records, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${label}.jsonl`);
  console.log(`harness: ${role} turn "${label}" (${model}) …`);
  assertSandboxAvailable();
  const sandbox = writeProfile(p.sandbox, p.project);
  const result = await runAgent({ cwd: p.project, agent, model, session, message, logFile, sandbox });
  const after = sessionUsage(p.project, session);
  const tokens = after
    ? Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v - (before?.[k] ?? 0)]))
    : null;
  if (!after) {
    // Never silently undercount: a turn without usage is visible in STATUS.md.
    journal(runId, "usage.missing", { label, session });
    console.log(`harness: WARNING token usage of "${label}" could not be read`);
  }
  journal(runId, "agent.turn", {
    role,
    label,
    model,
    session,
    exitCode: result.exitCode,
    ms: result.ms,
    tokens,
    sessionTotal: after,
    errors: result.errors,
  });
  const textFile = path.join(logDir, `${label}.md`);
  fs.writeFileSync(textFile, result.allText || "(no text output)\n");
  console.log(`harness: ${role} turn done in ${(result.ms / 60000).toFixed(1)} min, exit ${result.exitCode}`);
  return { ...result, tokens, textFile };
}

function lastUsage(runId, session) {
  const turns = readJournal(runId).filter((e) => e.event === "agent.turn" && e.session === session && e.sessionTotal);
  return turns.length ? turns[turns.length - 1].sessionTotal : null;
}

/** Run the pristine acceptance suite of `blueprint` against the run's app. */
export function verify(runId, { blueprint, stage, label }) {
  const p = runPaths(runId);
  const out = path.join(p.records, "verify", label);
  const runner = path.join(blueprintDir(blueprint), "acceptance", "run.mjs");
  console.log(`harness: verifying ${stage} with the pristine blueprint …`);
  const started = Date.now();
  return new Promise((resolve) => {
    fs.mkdirSync(path.join(p.records, "verify"), { recursive: true });
    const log = fs.openSync(path.join(p.records, "verify", `${label}.log`), "w");
    // The product's own code (build, start script) runs in the same sandbox as the
    // agent, so the code being judged cannot reach the tests that judge it.
    const sandbox = writeProfile(p.sandbox, p.project);
    const child = spawn("node", [runner, "--app", p.app, "--stage", stage, "--out", out, "--app-sandbox", sandbox], {
      cwd: p.records,
      stdio: ["ignore", log, log],
    });
    child.on("exit", (code) => {
      fs.closeSync(log);
      const reportFile = path.join(out, "report.json");
      const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, "utf8")) : null;
      const failed = report?.tests?.filter((t) => t.status === "failed") ?? [];
      const result = {
        stage,
        label,
        exitCode: code,
        ms: Date.now() - started,
        started: report?.startup?.ok ?? false,
        startupError: report?.startup?.error,
        totals: report?.totals ?? { passed: 0, failed: 0, skipped: 0 },
        passed: code === 0,
        failures: failed.map((t) => ({ stage: t.stage, name: t.name, failure: t.failure })),
        appLogTail: tail(path.join(out, "app.log"), 60),
        reportFile,
      };
      journal(runId, "verify", {
        stage,
        label,
        exitCode: code,
        ms: result.ms,
        started: result.started,
        totals: result.totals,
      });
      console.log(
        result.started
          ? `harness: ${stage} passed ${result.totals.passed}, failed ${result.totals.failed}`
          : `harness: ${stage} could not start the app: ${result.startupError}`,
      );
      resolve(result);
    });
  });
}

export function tail(file, lines) {
  if (!fs.existsSync(file)) return "(no log)";
  const all = fs.readFileSync(file, "utf8").split("\n");
  return all.slice(-lines).join("\n");
}

export function describeFailures(v, limit = 15) {
  if (!v.started) return `- 应用没能启动：${v.startupError}`;
  const shown = v.failures.slice(0, limit).map((f) => {
    const first = (f.failure ?? "").split("\n").slice(0, 4).join("\n    ");
    return `- [${f.stage}] ${f.name}\n    ${first}`;
  });
  if (v.failures.length > limit) shown.push(`- ……另有 ${v.failures.length - limit} 条，见 ${v.reportFile}`);
  return shown.join("\n");
}

/** A Markdown status of the run, from its journal (written to harness/STATUS.md). */
export function writeStatus(runId, state) {
  const events = readJournal(runId);
  const turns = events.filter((e) => e.event === "agent.turn");
  const verifies = events.filter((e) => e.event === "verify");
  const human = events.filter((e) => e.event.startsWith("human."));
  const sum = (list, key) => list.reduce((t, e) => t + (e.tokens?.[key] ?? 0), 0);
  const minutes = (ms) => (ms / 60000).toFixed(1);
  const lines = [
    `# Run ${runId}`,
    "",
    `- kind: ${state.kind}`,
    ...(state.maxAttempts ? [`- attempts allowed per stage: ${state.maxAttempts}`] : []),
    `- blueprint: ${state.blueprint}`,
    `- phase: **${state.phase}**${state.stages ? ` (stage ${state.stages[state.stageIndex] ?? "—"})` : ""}`,
    `- agent turns: ${turns.length} (builder ${turns.filter((t) => t.role === "builder").length}, reviewer ${turns.filter((t) => t.role === "reviewer").length})`,
    `- agent time: ${minutes(turns.reduce((t, e) => t + e.ms, 0))} min; verification time: ${minutes(verifies.reduce((t, e) => t + e.ms, 0))} min`,
    `- tokens: input ${sum(turns, "input")}, output ${sum(turns, "output")}, reasoning ${sum(turns, "reasoning")}, cache read ${sum(turns, "cacheRead")}`,
    `- turns whose token usage could not be read: ${turns.filter((t) => !t.tokens).length}${turns.some((t) => !t.tokens) ? " (totals above are a LOWER bound)" : ""}`,
    // Approvals are checkpoints; feedback rounds are interventions that change the work.
    `- human approvals: ${human.filter((e) => e.event === "human.approve").length}; human feedback rounds (interventions): ${human.filter((e) => e.event === "human.feedback").length}`,
    "",
    "| verification | stage | passed | failed | started |",
    "|---|---|---|---|---|",
    ...verifies.map((v) => `| ${v.label} | ${v.stage} | ${v.totals.passed} | ${v.totals.failed} | ${v.started ? "yes" : "no"} |`),
    "",
  ];
  fs.writeFileSync(path.join(runPaths(runId).records, "STATUS.md"), lines.join("\n"));
  return lines.join("\n");
}
