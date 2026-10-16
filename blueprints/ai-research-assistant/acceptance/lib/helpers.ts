// Shared steps for the acceptance tests. Every helper asserts the step it takes,
// so a test that depends on a broken step fails at that step, not later.
//
// Rule for test authors: a negative test first proves the positive path it is
// guarding (the owner CAN read it) before proving the negative (others CANNOT).
// Otherwise an app that answers 404 to everything would pass it.

import { afterEach, beforeEach, expect } from "vitest";
import { Client, CONTROL_URL, Res } from "./client";
import { COFFEE, SOLAR } from "./corpus";

export const PASSWORD = "correct-horse-battery-42";
export const CALL_COST = 0.01; // FAKE_CHAT_CALL_COST_USD default
export const EPS = 1e-9;
export const TERMINAL = ["succeeded", "failed", "canceled", "budget_exceeded"];

let counter = 0;
export function uid(): string {
  counter += 1;
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter}`;
}

export function newEmail(prefix = "user"): string {
  return `${prefix}-${uid()}@example.test`;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(
  probe: () => Promise<T | undefined | null | false>,
  { timeout = 30_000, interval = 150, what = "condition" } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await probe();
      if (v) return v as T;
    } catch (e) {
      last = e;
    }
    await sleep(interval);
  }
  throw new Error(`timed out after ${timeout} ms waiting for ${what}${last ? `: ${last}` : ""}`);
}

export function expectError(res: Res, status: number, code?: string) {
  const detail = `${res.status} ${res.text.slice(0, 300)}`;
  expect(res.status, detail).toBe(status);
  if (code) expect(res.body?.error?.code, detail).toBe(code);
  if (res.body?.error) expect(typeof res.body.error.message, detail).toBe("string");
}

export function expectStatus(res: Res, status: number) {
  expect(res.status, `${res.status} ${res.text.slice(0, 300)}`).toBe(status);
}

/** Every key in a JSON value, at any depth. */
export function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}

/** Keys that would carry credentials. Token *counts* (inputTokens, ...) are not secrets. */
export function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  if (k.endsWith("tokens")) return false;
  return /pass(word)?|hash|salt|secret|token|session/.test(k);
}

export function secretKeys(value: unknown): string[] {
  return allKeys(value).filter(isSecretKey);
}

// --- accounts and workspaces -------------------------------------------------

export interface Account {
  client: Client;
  user: { id: string; email: string; name: string };
  email: string;
  password: string;
}

export async function signup(opts: { email?: string; name?: string; password?: string } = {}): Promise<Account> {
  const client = new Client();
  const email = opts.email ?? newEmail();
  const password = opts.password ?? PASSWORD;
  const res = await client.post("/api/auth/signup", { email, password, name: opts.name ?? "Test User" });
  expectStatus(res, 201);
  expect(res.body?.user?.id).toBeTruthy();
  return { client, user: res.body.user, email, password };
}

export async function login(email: string, password = PASSWORD): Promise<Client> {
  const client = new Client();
  const res = await client.post("/api/auth/login", { email, password });
  expectStatus(res, 200);
  return client;
}

export async function createWorkspace(client: Client, name = `Workspace ${uid()}`) {
  const res = await client.post("/api/workspaces", { name });
  expectStatus(res, 201);
  expect(res.body?.workspace?.id).toBeTruthy();
  return res.body.workspace as { id: string; name: string };
}

export interface Team extends Account {
  ws: { id: string; name: string };
}

/** A fresh user who owns a fresh workspace. */
export async function owner(): Promise<Team> {
  const account = await signup();
  const ws = await createWorkspace(account.client);
  return { ...account, ws };
}

export async function outbox(to: string, template: "invitation" | "password_reset") {
  const res = await new Client().get(`/api/__test__/outbox?to=${encodeURIComponent(to)}`);
  expectStatus(res, 200);
  const messages = (res.body?.messages ?? []).filter((m: any) => m.template === template);
  expect(messages.length, `no ${template} email to ${to}`).toBeGreaterThan(0);
  return messages[messages.length - 1] as { to: string; template: string; token: string };
}

export async function invite(by: Client, wsId: string, email: string, role: "admin" | "member") {
  const res = await by.post(`/api/workspaces/${wsId}/invitations`, { email, role });
  expectStatus(res, 201);
  return (await outbox(email, "invitation")).token;
}

/** Sign up a new user and bring them into the workspace with the given role. */
export async function addMember(team: Team, role: "admin" | "member"): Promise<Account> {
  const account = await signup();
  const token = await invite(team.client, team.ws.id, account.email, role);
  const res = await account.client.post("/api/invitations/accept", { token });
  expectStatus(res, 200);
  expect(res.body?.role).toBe(role);
  return account;
}

// --- documents ----------------------------------------------------------------

export async function addText(client: Client, wsId: string, doc: { title: string; text: string }) {
  const res = await client.post(`/api/workspaces/${wsId}/documents`, doc);
  expectStatus(res, 201);
  const id = res.body?.document?.id as string;
  expect(id).toBeTruthy();
  return waitForDocument(client, wsId, id);
}

export async function waitForDocument(client: Client, wsId: string, id: string) {
  return waitFor(
    async () => {
      const res = await client.get(`/api/workspaces/${wsId}/documents/${id}`);
      expectStatus(res, 200);
      const doc = res.body.document;
      if (doc.status === "failed") throw new Error(`document ${id} failed to process`);
      return doc.status === "ready" ? doc : undefined;
    },
    { what: `document ${id} to be ready` },
  );
}

/** Two ready documents with distinct topics. */
export async function twoDocs(client: Client, wsId: string) {
  return [await addText(client, wsId, SOLAR), await addText(client, wsId, COFFEE)];
}

// --- the fake model -------------------------------------------------------------

export const fakeModel = {
  async set(config: { latencyMs?: number; faults?: { stage: string; mode: "transient" | "permanent"; times?: number }[] }) {
    const res = await new Client().put("/api/__test__/fake-model", config);
    expectStatus(res, 204);
  },
  async reset() {
    // Must succeed: a reset that silently fails leaks faults and latency into
    // unrelated tests, which then fail far from the cause.
    expectStatus(await new Client().del("/api/__test__/fake-model"), 204);
  },
};

/** Reset the fake model before and after every test of the calling suite. */
export function isolateFakeModel() {
  beforeEach(() => fakeModel.reset());
  afterEach(() => fakeModel.reset());
}

// --- research jobs ----------------------------------------------------------------

export async function startJob(client: Client, wsId: string, documentIds: string[], question = "What do these documents say?") {
  const res = await client.post(`/api/workspaces/${wsId}/research-jobs`, { question, documentIds });
  expectStatus(res, 202);
  expect(res.body?.job?.id).toBeTruthy();
  return res.body.job;
}

export async function getJob(client: Client, wsId: string, id: string) {
  const res = await client.get(`/api/workspaces/${wsId}/research-jobs/${id}`);
  expectStatus(res, 200);
  return res.body.job;
}

export async function waitForJob(
  client: Client,
  wsId: string,
  id: string,
  until: (job: any) => boolean = (j) => TERMINAL.includes(j.status),
  timeout = 60_000,
) {
  return waitFor(
    async () => {
      const job = await getJob(client, wsId, id);
      return until(job) ? job : undefined;
    },
    { timeout, what: `job ${id}` },
  );
}

export async function finishedJob(client: Client, wsId: string, documentIds: string[], question?: string) {
  const job = await startJob(client, wsId, documentIds, question);
  const done = await waitForJob(client, wsId, job.id);
  expect(done.status, JSON.stringify(done.error)).toBe("succeeded");
  return done;
}

export async function report(client: Client, wsId: string, reportId: string) {
  const res = await client.get(`/api/workspaces/${wsId}/reports/${reportId}`);
  expectStatus(res, 200);
  return res.body.report;
}

export async function usageRecords(client: Client, wsId: string, query: { jobId?: string; reportId?: string } = {}) {
  const qs = new URLSearchParams(query as Record<string, string>).toString();
  const res = await client.get(`/api/workspaces/${wsId}/usage/records${qs ? `?${qs}` : ""}`);
  expectStatus(res, 200);
  return res.body.records as any[];
}

/** Successful chat calls of a job, counted per stage. */
export async function callsByStage(client: Client, wsId: string, jobId: string, status = "ok") {
  const counts: Record<string, number> = {};
  for (const r of await usageRecords(client, wsId, { jobId })) {
    if (r.kind !== "chat" || r.status !== status) continue;
    counts[r.stage] = (counts[r.stage] ?? 0) + 1;
  }
  return counts;
}

export function markers(markdown: string): number[] {
  return [...markdown.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
}

// --- the application process ----------------------------------------------------

/** Restart the application under test, keeping its database (runner control API). */
export async function restartApp() {
  if (!CONTROL_URL) throw new Error("ACCEPTANCE_CONTROL_URL is not set: run the suite through run.mjs");
  const res = await fetch(`${CONTROL_URL}/restart`, { method: "POST" });
  if (res.status !== 200) throw new Error(`restart failed: ${res.status} ${await res.text()}`);
}
