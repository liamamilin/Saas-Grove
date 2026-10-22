#!/usr/bin/env node
// Prototype step 3: build one static index.html from one or more version directories.
//   node toolbox/research/build.mjs --out index.html --version <label>=<dir> [--version <label>=<dir> ...]   (newest first)
import fs from "node:fs";
import path from "node:path";

const a = process.argv.slice(2);
let out = "index.html";
const versions = [];
for (let i = 0; i < a.length; i += 2) {
  if (a[i] === "--out") out = a[i + 1];
  else if (a[i] === "--version") { const [label, dir] = a[i + 1].split("="); versions.push({ label, dir: path.resolve(dir) }); }
}
const load = ({ label, dir }) => {
  const c = JSON.parse(fs.readFileSync(path.join(dir, "candidates.json"), "utf8"));
  const ov = fs.existsSync(path.join(dir, "overview.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "overview.json"), "utf8")) : {};
  const items = c.items.map((p) => {
    const f = path.join(dir, "notes", `${p.full_name.replace("/", "__")}.json`);
    const n = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
    delete n._meta;
    return { ...p, ...n };
  });
  return { label, topic: c.topic, fetchedAt: c.fetchedAt, queries: c.queries, overview: ov, items };
};
const data = versions.map((v) => { const d = load(v); if (v.limit) d.items = d.items.slice(0, v.limit); return d; });
const html = fs.readFileSync(new URL("./template.html", import.meta.url), "utf8").replace("/*DATA*/null", JSON.stringify(data).replace(/</g, "\\u003c"));
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${Math.round(html.length / 1024)} KB, ${data.length} versions)`);
