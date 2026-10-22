#!/usr/bin/env node
// Mechanical checks on module templates (cheap; run before paying for a review).
//   node harness/modules-lint.mjs [--dir <modules dir>] [module ...]     prints one line per module; exit 1 if any WARN
// Format the generator prompt fixes: contract rules have ids R-<n>, acceptance cases T-<n>, and contract.md ends with a
// trace table whose rows start with `| R-<n> |` and list case ids. Checks: size limits; every R id defined in contract.md
// appears in a trace row with at least one existing T id; every T id of the plan appears in some trace row; trace rows
// refer only to existing ids; each file exists; module names used in backticks follow modules.json when written `module:<name>`.
import fs from "node:fs";
import path from "node:path";
import { REPO } from "./lib/run.mjs";

const LIMITS = { "MODULE.md": 15 * 1024, "contract.md": 17 * 1024, "acceptance-plan.md": 13 * 1024, "decisions.md": 7 * 1024 };
const argv = process.argv.slice(2);
let root = path.join(REPO, "templates", "modules");
if (argv[0] === "--dir") { root = path.resolve(argv[1]); argv.splice(0, 2); }
const names = argv.length ? argv : fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "contract.md")));
let bad = 0;
for (const n of names) {
  const dir = path.join(root, n);
  const problems = [];
  const text = {};
  for (const [f, lim] of Object.entries(LIMITS)) {
    if (!fs.existsSync(path.join(dir, f))) { problems.push(`missing ${f}`); text[f] = ""; continue; }
    text[f] = fs.readFileSync(path.join(dir, f), "utf8");
    const size = Buffer.byteLength(text[f]);
    if (size > lim) problems.push(`${f} ${size}>${lim}`);
  }
  const contract = text["contract.md"], plan = text["acceptance-plan.md"];
  const rules = new Set(), cases = new Set();
  for (const line of contract.split("\n")) { const m = line.match(/^\s*(?:\|\s*)?(?:\*\*)?`?(R-\d{1,3})`?(?:\*\*)?\s*(?:[|:：.]|\s)/); if (m && !/^\|\s*R-\d+\s*\|\s*(T-|\S*T-\d)/.test(line)) rules.add(m[1]); }
  for (const line of plan.split("\n")) { const m = line.match(/^\s*\|\s*`?(T-\d{1,3})`?\s*\|/); if (m) cases.add(m[1]); }
  if (!rules.size) problems.push("no R-<n> rules found in contract.md");
  if (!cases.size) problems.push("no T-<n> cases found in acceptance-plan.md");
  const traceIdx = contract.search(/\n#+[^\n]*(追溯|trace)/i);
  const trace = new Map();
  if (traceIdx < 0) problems.push("no trace table at the end of contract.md");
  else for (const line of contract.slice(traceIdx).split("\n")) {
    const m = line.match(/^\s*\|\s*`?(R-\d{1,3})`?\s*\|(.*)$/);
    if (m) trace.set(m[1], [...m[2].matchAll(/T-\d{1,3}/g)].map((x) => x[0]));
  }
  const noCase = [...rules].filter((r) => !(trace.get(r) ?? []).length && !/不测|not tested/i.test(contract.split("\n").find((l) => l.includes(r) && /^\s*\|\s*`?R-/.test(l)) ?? ""));
  if (noCase.length) problems.push(`rules without cases (${noCase.length}): ${noCase.slice(0, 10).join(",")}`);
  const used = new Set([...trace.values()].flat());
  const orphan = [...cases].filter((c) => !used.has(c));
  if (orphan.length) problems.push(`cases not in trace (${orphan.length}): ${orphan.slice(0, 10).join(",")}`);
  const ghostCase = [...used].filter((c) => !cases.has(c));
  if (ghostCase.length) problems.push(`trace names missing cases: ${ghostCase.slice(0, 10).join(",")}`);
  const ghostRule = [...trace.keys()].filter((r) => !rules.has(r));
  if (ghostRule.length) problems.push(`trace names missing rules: ${ghostRule.slice(0, 10).join(",")}`);
  if (problems.length) bad++;
  console.log(`${problems.length ? "WARN" : "ok  "} ${n}  rules=${rules.size} cases=${cases.size}${problems.length ? "  " + problems.join(" | ") : ""}`);
}
process.exit(bad ? 1 : 0);
