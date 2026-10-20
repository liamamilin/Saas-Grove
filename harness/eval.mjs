#!/usr/bin/env node
// Score finished runs against frozen held-out suites (experiments/PROTOCOL.md).
//
//   node harness/eval.mjs score --suites <dir>[,<dir>…] --runs <id>[,<id>…] --out <dir>
//        [--exclude <json>] [--jobs 4]
//
// A suite dir is an acceptance project copy (it has run.mjs and tests/). Each run's app is cloned
// first, so scoring never touches the run. Anything that is not a pass (failed, errored, timed out,
// suite produced no result, app would not start) counts as a failure against a FIXED denominator,
// the union of the tests the suite contains. --exclude is a JSON list of test full names that the
// blind adjudicator removed; the report always shows scores before and after exclusion.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { runPaths } from "./lib/run.mjs";

const argv = process.argv.slice(2);
const command = argv.shift();
const opt = {};
for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, "")] = argv[i + 1];
if (command !== "score" || !opt.suites || !opt.runs || !opt.out) {
  console.error("usage: eval.mjs score --suites a,b --runs id1,id2 --out dir [--exclude file.json] [--jobs 4]");
  process.exit(2);
}
const suites = opt.suites.split(",").map((s) => path.resolve(s));
const runs = opt.runs.split(",");
const out = path.resolve(opt.out);
const jobs = Number(opt.jobs ?? 4);
const exclude = new Set(opt.exclude ? JSON.parse(fs.readFileSync(opt.exclude, "utf8")) : []);
fs.mkdirSync(path.join(out, "apps"), { recursive: true });

for (const id of runs) {
  const dest = path.join(out, "apps", id);
  if (!fs.existsSync(dest)) execFileSync("cp", ["-Rc", path.join(runPaths(id).project, "app"), dest]);
}

// One app is never driven by two suites at once: some apps (e.g. Next.js) build into their own
// directory on start, and concurrent builds corrupt each other. Parallelism is across apps.
function runOne({ run, suite }) {
  const name = path.basename(suite);
  const dir = path.join(out, `${name}--${run}`);
  return new Promise((resolve) => {
    const p = spawn("node", ["run.mjs", "--app", path.join(out, "apps", run), "--stage", "S4", "--out", dir], { cwd: suite, stdio: "ignore" });
    p.on("close", () => resolve());
  });
}
async function runApp(run) {
  for (const suite of suites) await runOne({ run, suite });
}
const pending = [...runs];
await Promise.all(Array.from({ length: Math.min(jobs, pending.length) }, async () => {
  while (pending.length) await runApp(pending.shift());
}));

// Aggregate: test -> run -> status
const res = {};
const suiteTests = {};
for (const suite of suites) {
  const name = path.basename(suite);
  const listing = [];
  for (const run of runs) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(out, `${name}--${run}`, "vitest.json"), "utf8")); } catch { continue; }
    for (const f of j.testResults) for (const t of f.assertionResults) {
      const key = `${name}::${t.fullName}`;
      listing.push(key);
      (res[key] ??= {})[run] = t.status === "passed" ? "passed" : "failed";
    }
  }
  suiteTests[name] = [...new Set(listing)];
}
const all = Object.values(suiteTests).flat();
const rows = runs.map((run) => {
  const score = (set) => {
    const pass = set.filter((k) => res[k]?.[run] === "passed").length;
    return { pass, fail: set.length - pass, total: set.length };
  };
  return { run, before: score(all), after: score(all.filter((k) => !exclude.has(k))) };
});
fs.writeFileSync(path.join(out, "scores.json"), JSON.stringify({ rows, excluded: [...exclude], res }, null, 1));
console.log("run".padEnd(18), "before(pass/total)".padEnd(20), "after exclusion");
for (const r of rows) console.log(r.run.padEnd(18), `${r.before.pass}/${r.before.total}`.padEnd(20), `${r.after.pass}/${r.after.total}`);
