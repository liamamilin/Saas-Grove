// Start further instances of the product under test, from inside a test, through the runner's
// control API. Each one gets its own port and a brand-new database, and exactly the environment the
// test passes: nothing of TEST_MODE, MODEL_*, EMBEDDING_*, FAKE_* or MAIL_* is inherited from the
// runner, and a `null` value removes a variable. Used by the tests that need the product outside
// test mode (spec/architecture.md §5.2).

import { CONTROL_URL, Client } from "./client";
import { PASSWORD, createWorkspace, expectStatus, newEmail } from "./helpers";

export interface Launched {
  healthy: boolean;
  id: string | null;
  base: string | null;
  seconds: number;
  /** Set when the start script ended before the product became healthy. */
  exited: { code: number | null; signal: string | null } | null;
  timedOut: boolean;
  /** The last lines of the instance's output, when it did not become healthy. */
  logTail?: string;
}

async function control(method: string, path: string, body?: unknown): Promise<any> {
  if (!CONTROL_URL) throw new Error("ACCEPTANCE_CONTROL_URL is not set: run the suite through run.mjs");
  const res = await fetch(`${CONTROL_URL}${path}`, {
    method,
    // No keep-alive: these calls are minutes apart and the runner closes idle connections.
    headers: { "content-type": "application/json", connection: "close" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status !== 200) throw new Error(`runner control ${method} ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

/** Start the product with this environment; resolves when it is healthy, has exited, or the time is up. */
export async function launch(env: Record<string, string | null>, startupTimeoutSeconds = 60): Promise<Launched> {
  return control("POST", "/instances", { env, startupTimeout: startupTimeoutSeconds });
}

export async function stopInstance(id: string): Promise<void> {
  await control("DELETE", `/instances/${id}`);
}

export function describeLaunch(result: Launched): string {
  if (result.healthy) return `healthy after ${result.seconds.toFixed(1)}s`;
  const how = result.exited ? `exited (${JSON.stringify(result.exited)})` : `not healthy within ${result.seconds.toFixed(0)}s`;
  return `${how}${result.logTail ? `\n--- last output ---\n${result.logTail}` : ""}`;
}

/** Run `fn` against a healthy instance started with `env`; the instance is stopped afterwards. */
export async function withInstance<T>(env: Record<string, string | null>, fn: (base: string) => Promise<T>, startupTimeoutSeconds = 90): Promise<T> {
  const started = await launch(env, startupTimeoutSeconds);
  if (!started.healthy) throw new Error(`the product did not start with this configuration: ${describeLaunch(started)}`);
  try {
    return await fn(started.base!);
  } finally {
    await stopInstance(started.id!);
  }
}

/** A fresh user with a fresh workspace on another instance (sign-up needs no mail, so this works outside test mode). */
export async function teamAt(base: string) {
  const client = new Client(base);
  expectStatus(await client.post("/api/auth/signup", { email: newEmail("real"), password: PASSWORD, name: "Real Mode" }), 201);
  const ws = await createWorkspace(client);
  return { client, ws };
}
