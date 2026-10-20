#!/usr/bin/env node
// Acceptance runner for the AI Support Bot blueprint.
//
// Starts the product under test against a brand-new Postgres database, runs the
// acceptance tests of the requested stage and every stage before it, and writes
// a JSON report. It only talks to the product over HTTP (plus the start script),
// so it is independent of how the product is built.
//
//   node run.mjs --app <product-dir> [--stage S1|S2|S3|S4] [--out <dir>]
//                [--pg-admin <postgres-url>] [--startup-timeout <seconds>]
//                [--filter <test-name-pattern>] [--keep-db] [--app-sandbox <profile.sb>]
//
// Before the first start the product is built from its current sources
// (`npm run build`, when package.json has a build script), so the suite never
// scores a stale build. Restarts during the run do not rebuild.
//
// --app-sandbox runs the product's own code (build and start script) under
// macOS sandbox-exec with the given profile. A harness uses it so the code
// being judged cannot reach the tests that judge it.
//
// Control API (ACCEPTANCE_CONTROL_URL): POST /restart restarts the product on the same database;
// POST /instances starts a further instance on its own port and brand-new database, with exactly the
// environment the test sends ({ env: { NAME: "value" | null }, startupTimeout }), and answers when it is
// healthy, has exited or the time is up; DELETE /instances/<id> stops it. Instances do not inherit
// TEST_MODE, MODEL_*, EMBEDDING_*, FAKE_* or MAIL_* from this process, run under the same --app-sandbox,
// and are stopped and dropped at the end of the run at the latest.
//
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
    else if (a === "--app-sandbox") opts.appSandbox = path.resolve(next());
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
  /** `inherit` is the environment the start script starts from (the runner's own, unless a caller scrubbed it). */
  constructor({ dir, env, logPath, startupTimeout, sandbox, inherit = process.env }) {
    this.dir = dir;
    this.env = env;
    this.inherit = inherit;
    this.logPath = logPath;
    this.startupTimeout = startupTimeout;
    this.sandbox = sandbox;
    this.child = null;
    this.base = `http://127.0.0.1:${env.PORT}`;
  }

  /** Start the script and wait until the product is healthy, exits, or the time is up. Never throws for those. */
  async probe() {
    const log = fs.openSync(this.logPath, "a");
    fs.writeSync(log, `\n===== start ${new Date().toISOString()} =====\n`);
    const script = path.join(this.dir, "scripts", "acceptance-start.sh");
    this.child = spawn(...this.command("bash", [script]), {
      cwd: this.dir,
      env: { ...this.inherit, ...this.env, PWD: this.dir },
      detached: true,
      stdio: ["ignore", log, log],
    });
    let exited = null;
    this.child.once("exit", (code, signal) => (exited = { code, signal }));

    const deadline = Date.now() + this.startupTimeout * 1000;
    const started = Date.now();
    const seconds = () => (Date.now() - started) / 1000;
    while (Date.now() < deadline) {
      if (exited) return { healthy: false, exited, timedOut: false, seconds: seconds() };
      try {
        const res = await fetch(`${this.base}/api/health`);
        if (res.status === 200) return { healthy: true, exited: null, timedOut: false, seconds: seconds() };
      } catch {
        // not listening yet
      }
      await sleep(500);
    }
    return { healthy: false, exited: null, timedOut: true, seconds: seconds() };
  }

  async start() {
    const result = await this.probe();
    if (result.healthy) return result.seconds;
    if (result.exited) throw new Error(`start script exited (${JSON.stringify(result.exited)}) before becoming healthy`);
    throw new Error(`not healthy within ${this.startupTimeout}s`);
  }

  /** [cmd, args], wrapped in sandbox-exec when a profile was given. */
  command(cmd, args) {
    return this.sandbox ? ["/usr/bin/sandbox-exec", ["-f", this.sandbox, cmd, ...args]] : [cmd, args];
  }

  /** Build from current sources if the product declares a build script. */
  async build() {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(this.dir, "package.json"), "utf8"));
    } catch {
      return null; // no package.json: nothing to build
    }
    if (!pkg.scripts?.build) return null;
    const log = fs.openSync(this.logPath, "a");
    fs.writeSync(log, `\n===== build ${new Date().toISOString()} =====\n`);
    const started = Date.now();
    const code = await new Promise((resolve) => {
      const child = spawn(...this.command("npm", ["run", "build"]), {
        cwd: this.dir,
        env: { ...process.env, ...this.env, PWD: this.dir },
        stdio: ["ignore", log, log],
      });
      const timer = setTimeout(() => child.kill("SIGTERM"), 15 * 60 * 1000);
      child.on("exit", (c) => {
        clearTimeout(timer);
        resolve(c ?? 1);
      });
    });
    fs.closeSync(log);
    if (code !== 0) throw new Error(`npm run build failed (exit ${code}); see the app log`);
    return (Date.now() - started) / 1000;
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

/** Environment names a second instance never inherits from the runner: it gets exactly what the test passes. */
const SCRUBBED = /^(TEST_MODE|MODEL_|EMBEDDING_|FAKE_|MAIL_)/;

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function reply(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function controlServer(app, { opts, instances }) {
  // Lets a test restart the product mid-run (same database) to check recovery, and start further
  // instances of it, each on its own port and brand-new database, with an environment of the test's choosing.
  let counter = 0;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "POST" && req.url === "/restart") {
        await app.stop();
        const seconds = await app.start();
        return reply(res, 200, { ok: true, seconds });
      }
      if (req.method === "POST" && req.url === "/instances") {
        const { env: overrides = {}, startupTimeout = 60 } = await readJson(req);
        for (const reserved of ["PORT", "DATABASE_URL", "APP_SECRET", "APP_BASE_URL"]) {
          if (reserved in overrides) return reply(res, 400, { ok: false, error: `${reserved} is set by the runner` });
        }
        const id = String(++counter);
        const db = createDatabase(opts.pgAdmin);
        const port = await freePort();
        const inherit = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SCRUBBED.test(k)));
        const env = {
          PORT: String(port),
          DATABASE_URL: db.url,
          APP_SECRET: crypto.randomBytes(32).toString("hex"),
          APP_BASE_URL: `http://127.0.0.1:${port}`,
        };
        for (const [k, v] of Object.entries(overrides)) {
          if (v === null) delete inherit[k];
          else env[k] = String(v);
        }
        const logPath = path.join(opts.out, `instance-${id}.log`);
        const instance = new App({ dir: opts.app, env, logPath, startupTimeout, sandbox: opts.appSandbox, inherit });
        instance.db = db;
        const result = await instance.probe();
        if (result.healthy) {
          instances.set(id, instance);
          return reply(res, 200, { ok: true, id, base: instance.base, ...result });
        }
        await instance.stop();
        dropDatabase(opts.pgAdmin, db.name);
        let logTail = "";
        try {
          logTail = fs.readFileSync(logPath, "utf8").split("\n").slice(-20).join("\n");
        } catch {
          // no log
        }
        return reply(res, 200, { ok: true, id: null, base: null, ...result, logTail });
      }
      const stopMatch = req.method === "DELETE" && req.url.match(/^\/instances\/(\d+)$/);
      if (stopMatch) {
        const instance = instances.get(stopMatch[1]);
        if (instance) {
          instances.delete(stopMatch[1]);
          await instance.stop();
          dropDatabase(opts.pgAdmin, instance.db.name);
        }
        return reply(res, 200, { ok: true });
      }
      res.writeHead(404).end();
    } catch (e) {
      reply(res, 500, { ok: false, error: e.message });
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
    blueprint: "ai-support-bot",
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
    sandbox: opts.appSandbox,
    env: {
      PORT: String(port),
      DATABASE_URL: db.url,
      TEST_MODE: "1",
      MODEL_PROVIDER: "fake",
      APP_SECRET: crypto.randomBytes(32).toString("hex"),
      APP_BASE_URL: `http://127.0.0.1:${port}`,
    },
  });
  const instances = new Map();
  const control = await controlServer(app, { opts, instances });
  let exitCode = 0;

  const cleanup = async () => {
    for (const instance of instances.values()) {
      await instance.stop();
      dropDatabase(opts.pgAdmin, instance.db.name);
    }
    instances.clear();
    await app.stop();
    control.close();
    if (!opts.keepDb) dropDatabase(opts.pgAdmin, db.name);
  };
  process.once("SIGINT", async () => {
    await cleanup();
    process.exit(130);
  });

  try {
    const buildSeconds = await app.build();
    const seconds = await app.start();
    report.startup = { ok: true, seconds, buildSeconds, sandboxed: Boolean(opts.appSandbox) };
    console.log(`acceptance: app healthy on ${app.base} after ${seconds.toFixed(1)}s; running ${stageDirs.join(" ")}`);
    const jsonPath = path.join(opts.out, "vitest.json");
    await runVitest({
      stageDirs,
      jsonPath,
      filter: opts.filter,
      env: {
        ACCEPTANCE_BASE_URL: app.base,
        ACCEPTANCE_CONTROL_URL: `http://127.0.0.1:${control.address().port}`,
        // Only for the few tests that look at what the product stored (secrets at rest).
        ACCEPTANCE_DATABASE_URL: db.url,
      },
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
