#!/usr/bin/env node
// Acceptance runner for the AI Research Assistant blueprint.
//
// Starts the product under test against a brand-new Postgres database, runs the
// acceptance tests of the requested stage and every stage before it, and writes
// a JSON report. It only talks to the product over HTTP (plus the start script),
// so it is independent of how the product is built.
//
//   node run.mjs --app <product-dir> [--stage S1|S2|S3|S4] [--out <dir>]
//                [--pg-admin <postgres-url>] [--startup-timeout <seconds>]
//                [--filter <test-name-pattern>] [--keep-db]
//   node run.mjs --self-check
//
// --self-check runs every test against fixtures/empty-app (healthy, nothing
// else). It passes only if every test fails, and fails at an assertion about
// the app rather than through a bug in the test code itself.
//
// Exit codes: 0 all passed, 1 some test failed, 2 the product did not start,
// 3 usage or environment error.

import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGES = ["S1", "S2", "S3", "S4"];

function parseArgs(argv) {
  const opts = {
    stage: "S4",
    pgAdmin: process.env.PG_ADMIN_URL ?? "postgresql://localhost:5432/postgres",
    startupTimeout: 300,
    keepDb: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--app") opts.app = path.resolve(next());
    else if (a === "--stage") opts.stage = next().toUpperCase();
    else if (a === "--out") opts.out = path.resolve(next());
    else if (a === "--pg-admin") opts.pgAdmin = next();
    else if (a === "--startup-timeout") opts.startupTimeout = Number(next());
    else if (a === "--filter") opts.filter = next();
    else if (a === "--keep-db") opts.keepDb = true;
    else if (a === "--self-check") opts.selfCheck = true;
    else fail(3, `unknown argument ${a}`);
  }
  if (opts.selfCheck) {
    opts.app = path.join(HERE, "fixtures", "empty-app");
    opts.stage = "S4";
  }
  if (!opts.app) fail(3, "--app <product-dir> is required");
  if (!STAGES.includes(opts.stage)) fail(3, `--stage must be one of ${STAGES.join(", ")}`);
  opts.out ??= path.resolve("acceptance-results", `${opts.stage}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  return opts;
}

function fail(code, message) {
  console.error(`acceptance: ${message}`);
  process.exit(code);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- database -------------------------------------------------------------------

function psql(adminUrl, sql) {
  execFileSync("psql", [adminUrl, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], { stdio: "pipe" });
}

function createDatabase(adminUrl) {
  const name = `acceptance_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  psql(adminUrl, `CREATE DATABASE "${name}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return { name, url: url.toString() };
}

function dropDatabase(adminUrl, name) {
  try {
    psql(adminUrl, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } catch (e) {
    console.error(`acceptance: could not drop database ${name}: ${e.message}`);
  }
}

// --- the product process -------------------------------------------------------------

class App {
  constructor({ dir, env, logPath, startupTimeout }) {
    this.dir = dir;
    this.env = env;
    this.logPath = logPath;
    this.startupTimeout = startupTimeout;
    this.child = null;
    this.base = `http://127.0.0.1:${env.PORT}`;
  }

  async start() {
    const log = fs.openSync(this.logPath, "a");
    fs.writeSync(log, `\n===== start ${new Date().toISOString()} =====\n`);
    const script = path.join(this.dir, "scripts", "acceptance-start.sh");
    this.child = spawn("bash", [script], {
      cwd: this.dir,
      env: { ...process.env, ...this.env },
      detached: true,
      stdio: ["ignore", log, log],
    });
    let exited = null;
    this.child.once("exit", (code, signal) => (exited = { code, signal }));

    const deadline = Date.now() + this.startupTimeout * 1000;
    const started = Date.now();
    while (Date.now() < deadline) {
      if (exited) throw new Error(`start script exited (${JSON.stringify(exited)}) before becoming healthy`);
      try {
        const res = await fetch(`${this.base}/api/health`);
        if (res.status === 200) return (Date.now() - started) / 1000;
      } catch {
        // not listening yet
      }
      await sleep(500);
    }
    throw new Error(`not healthy within ${this.startupTimeout}s`);
  }

  async stop() {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const gone = new Promise((r) => child.once("exit", r));
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      return;
    }
    const timeout = sleep(10_000).then(() => "timeout");
    if ((await Promise.race([gone, timeout])) === "timeout") {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
      await gone;
    }
  }
}

function controlServer(app) {
  // Lets a test restart the product mid-run (same database) to check recovery.
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/restart") {
      res.writeHead(404).end();
      return;
    }
    try {
      await app.stop();
      const seconds = await app.start();
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, seconds }));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// --- tests -------------------------------------------------------------------------

function runVitest({ stageDirs, env, jsonPath, filter }) {
  const bin = path.join(HERE, "node_modules", ".bin", "vitest");
  if (!fs.existsSync(bin)) fail(3, `vitest is not installed: run "npm ci" in ${HERE}`);
  const args = ["run", ...stageDirs, "--reporter=default", "--reporter=json", `--outputFile.json=${jsonPath}`];
  if (filter) args.push("-t", filter);
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: HERE, env: { ...process.env, ...env }, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function summarise(jsonPath) {
  if (!fs.existsSync(jsonPath)) return { tests: [], totals: { passed: 0, failed: 0, skipped: 0 } };
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const tests = [];
  for (const file of raw.testResults ?? []) {
    const rel = path.relative(HERE, file.name);
    const stage = (rel.match(/tests\/(s\d)\//) ?? [])[1]?.toUpperCase() ?? "?";
    for (const t of file.assertionResults ?? []) {
      tests.push({
        stage,
        file: rel,
        name: t.fullName ?? t.title,
        status: t.status === "pending" || t.status === "todo" ? "skipped" : t.status,
        failure: (t.failureMessages ?? []).join("\n").split("\n").slice(0, 12).join("\n") || undefined,
      });
    }
    if (!(file.assertionResults ?? []).length && file.status === "failed") {
      tests.push({ stage, file: rel, name: "(file failed to load)", status: "failed", failure: file.message });
    }
  }
  const totals = { passed: 0, failed: 0, skipped: 0 };
  for (const t of tests) totals[t.status] = (totals[t.status] ?? 0) + 1;
  return { tests, totals };
}

function selfCheckVerdict(report) {
  // A failure that comes from the test code itself proves nothing about the app.
  const testBug = /^(TypeError|ReferenceError|SyntaxError|RangeError)\b/;
  const passed = report.tests.filter((t) => t.status !== "failed");
  const buggy = report.tests.filter((t) => t.status === "failed" && testBug.test(t.failure ?? ""));
  for (const t of passed) console.log(`self-check: PASSED against the empty app (vacuous test): ${t.name}`);
  for (const t of buggy) console.log(`self-check: failed through a test bug: ${t.name}\n  ${t.failure.split("\n")[0]}`);
  const ok = report.startup?.ok && report.tests.length > 0 && !passed.length && !buggy.length;
  console.log(`self-check: ${ok ? "OK" : "FAILED"} — ${report.tests.length} tests, ${passed.length} vacuous, ${buggy.length} test bugs`);
  return ok ? 0 : 1;
}

// --- main ------------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const startScript = path.join(opts.app, "scripts", "acceptance-start.sh");
  if (!fs.existsSync(startScript)) fail(3, `${startScript} not found (see spec/architecture.md §7)`);
  fs.mkdirSync(opts.out, { recursive: true });

  const stageDirs = STAGES.slice(0, STAGES.indexOf(opts.stage) + 1).map((s) => `tests/${s.toLowerCase()}/`);
  const report = {
    blueprint: "ai-research-assistant",
    stage: opts.stage,
    app: opts.app,
    startedAt: new Date().toISOString(),
    stagesRun: stageDirs,
    startup: null,
    totals: null,
    tests: [],
    appLog: path.join(opts.out, "app.log"),
  };

  let db;
  try {
    db = createDatabase(opts.pgAdmin);
  } catch (e) {
    fail(3, `cannot create a database via ${opts.pgAdmin}: ${e.stderr?.toString() || e.message}`);
  }

  const port = await freePort();
  const app = new App({
    dir: opts.app,
    logPath: report.appLog,
    startupTimeout: opts.startupTimeout,
    env: {
      PORT: String(port),
      DATABASE_URL: db.url,
      TEST_MODE: "1",
      MODEL_PROVIDER: "fake",
      APP_SECRET: crypto.randomBytes(32).toString("hex"),
      APP_BASE_URL: `http://127.0.0.1:${port}`,
    },
  });
  const control = await controlServer(app);
  let exitCode = 0;

  const cleanup = async () => {
    await app.stop();
    control.close();
    if (!opts.keepDb) dropDatabase(opts.pgAdmin, db.name);
  };
  process.once("SIGINT", async () => {
    await cleanup();
    process.exit(130);
  });

  try {
    const seconds = await app.start();
    report.startup = { ok: true, seconds };
    console.log(`acceptance: app healthy on ${app.base} after ${seconds.toFixed(1)}s; running ${stageDirs.join(" ")}`);
    const jsonPath = path.join(opts.out, "vitest.json");
    await runVitest({
      stageDirs,
      jsonPath,
      filter: opts.filter,
      env: { ACCEPTANCE_BASE_URL: app.base, ACCEPTANCE_CONTROL_URL: `http://127.0.0.1:${control.address().port}` },
    });
    Object.assign(report, summarise(jsonPath));
    exitCode = report.totals.failed > 0 || report.tests.length === 0 ? 1 : 0;
  } catch (e) {
    report.startup = { ok: false, error: e.message };
    report.totals = { passed: 0, failed: 0, skipped: 0 };
    exitCode = 2;
  } finally {
    await cleanup();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(opts.out, "report.json"), JSON.stringify(report, null, 2));
  }

  if (opts.selfCheck) process.exit(selfCheckVerdict(report));
  const t = report.totals;
  if (exitCode === 2) console.log(`acceptance: ${opts.stage} NOT RUN — product did not start: ${report.startup.error} (log: ${report.appLog})`);
  else console.log(`acceptance: ${opts.stage} passed ${t.passed}, failed ${t.failed}, skipped ${t.skipped} → ${path.join(opts.out, "report.json")}`);
  process.exit(exitCode);
}

main().catch((e) => fail(3, e.stack ?? e.message));
