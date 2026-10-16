// Thin wrapper over the opencode CLI: run an agent turn headlessly, keep its
// event log, and read token usage back from the exported session.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";

/** A session id opencode accepts ("ses" prefix) that is stable for a run/step. */
export function sessionId(...parts) {
  return `ses_${parts.join("_").replace(/[^A-Za-z0-9]/g, "")}`.slice(0, 120);
}

/**
 * Run one agent turn. Resolves when opencode exits.
 * The JSON event stream goes to `logFile`; the agent's final text is returned.
 */
export function runAgent({ cwd, agent, model, session, message, logFile, timeoutMs = 3 * 60 * 60 * 1000 }) {
  // --standalone: a private server per turn, so the run's freshly written agent config is
  // always read (the shared background service caches configuration).
  const args = ["run", "--standalone", "--format", "json", "--auto", "--session", session, "--agent", agent];
  if (model) args.push("--model", model);
  args.push(message);
  return new Promise((resolve) => {
    const started = Date.now();
    const out = fs.openSync(logFile, "a");
    // opencode locates the project from $PWD, not from the process cwd, so a
    // child started with `cwd` alone would look for agents in the parent's dir.
    const child = spawn("opencode", args, { cwd, env: { ...process.env, PWD: cwd }, stdio: ["ignore", "pipe", "pipe"] });
    let texts = [];
    let errors = [];
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      fs.writeSync(out, chunk);
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "text" && event.part?.text) texts.push(event.part.text);
          if (event.type === "error") errors.push(event.error?.message ?? JSON.stringify(event.error));
        } catch {
          // not JSON: keep it in the log only
        }
      }
    });
    child.stderr.on("data", (chunk) => fs.writeSync(out, chunk));
    const timer = setTimeout(() => {
      errors.push(`timed out after ${Math.round(timeoutMs / 60000)} min`);
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      fs.closeSync(out);
      resolve({
        exitCode: code ?? 1,
        ms: Date.now() - started,
        finalText: texts.length ? texts[texts.length - 1] : "",
        allText: texts.join("\n\n"),
        errors,
      });
    });
  });
}

/** Token totals of a session, from `opencode session export`. */
export function sessionUsage(cwd, session) {
  try {
    const raw = execFileSync("opencode", ["session", "export", "--standalone", session], {
      cwd,
      env: { ...process.env, PWD: cwd },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 512 * 1024 * 1024,
    });
    const info = JSON.parse(raw).info ?? {};
    const t = info.tokens ?? {};
    return {
      input: t.input ?? 0,
      output: t.output ?? 0,
      reasoning: t.reasoning ?? 0,
      cacheRead: t.cache?.read ?? 0,
      cacheWrite: t.cache?.write ?? 0,
      cost: info.cost ?? 0,
    };
  } catch {
    return null;
  }
}
