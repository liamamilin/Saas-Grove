#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const children = [spawn("python3", ["-B", "-m", "server.api"], { cwd: root, stdio: "inherit" }),
  spawn(process.execPath, [fileURLToPath(new URL("../web/node_modules/vite/bin/vite.js", import.meta.url))],
    { cwd: fileURLToPath(new URL("../web/", import.meta.url)), stdio: "inherit" })];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill("SIGTERM"); process.exitCode = code; }
for (const child of children) {
  child.on("error", error => { console.error(error.message); stop(1); });
  child.on("exit", code => { if (!stopping) stop(code || 0); });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
