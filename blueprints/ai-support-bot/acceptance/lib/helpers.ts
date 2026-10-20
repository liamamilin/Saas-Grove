// Shared steps for the acceptance tests. Every helper asserts the step it takes,
// so a test that depends on a broken step fails at that step, not later.
//
// Rule for test authors: a negative test first proves the positive path it is
// guarding (the owner CAN read it) before proving the negative (others CANNOT).
// Otherwise an app that answers 404 to everything would pass it.

import { afterEach, beforeEach, expect } from "vitest";
import { Client, CONTROL_URL, Res } from "./client";
import { REFUNDS, SHIPPING, WARRANTY } from "./corpus";

export const PASSWORD = "correct-horse-battery-42";
export const CALL_COST = 0.01; // FAKE_CHAT_CALL_COST_USD default
export const EPS = 1e-9;

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

export type MailTemplate = "invitation" | "password_reset" | "handoff" | "budget_warning" | "budget_exhausted";

/** Every test-mode email to this address with this template (possibly none). */
export async function mails(to: string, template: MailTemplate) {
  const res = await new Client().get(`/api/__test__/outbox?to=${encodeURIComponent(to)}`);
  expectStatus(res, 200);
  expect(Array.isArray(res.body?.messages), "outbox messages must be an array").toBe(true);
  return res.body.messages.filter((m: any) => m.template === template) as { to: string; template: string; token?: string; data?: any }[];
}

/** The latest email to this address with this template; there must be one. */
export async function outbox(to: string, template: MailTemplate) {
  const messages = await mails(to, template);
  expect(messages.length, `no ${template} email to ${to}`).toBeGreaterThan(0);
  return messages[messages.length - 1] as { to: string; template: string; token: string; data?: any };
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

/** Wait until the document leaves `processing`; by default it must end `ready`. */
export async function waitForDocument(client: Client, wsId: string, id: string, expected: "ready" | "failed" = "ready") {
  const doc = await waitFor(
    async () => {
      const res = await client.get(`/api/workspaces/${wsId}/documents/${id}`);
      expectStatus(res, 200);
      const d = res.body.document;
      return d.status === "ready" || d.status === "failed" ? d : undefined;
    },
    { what: `document ${id} to finish processing` },
  );
  expect(doc.status, `document ${id}: ${JSON.stringify(doc.error ?? null)}`).toBe(expected);
  return doc;
}

/** The standard knowledge base: refunds, shipping and warranty, each one short document. */
export async function knowledgeBase(client: Client, wsId: string) {
  return {
    refunds: await addText(client, wsId, REFUNDS),
    shipping: await addText(client, wsId, SHIPPING),
    warranty: await addText(client, wsId, WARRANTY),
  };
}

export async function documentText(client: Client, wsId: string, id: string): Promise<string> {
  const res = await client.get(`/api/workspaces/${wsId}/documents/${id}/text`);
  expectStatus(res, 200);
  expect(typeof res.body?.text).toBe("string");
  return res.body.text;
}

// --- the fake model -------------------------------------------------------------

export const fakeModel = {
  async set(config: { latencyMs?: number; faults?: { stage: "answer"; mode: "transient" | "permanent"; times?: number }[] }) {
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

// --- usage ------------------------------------------------------------------------

export async function usageRecords(client: Client, wsId: string, query: { conversationId?: string } = {}) {
  const qs = new URLSearchParams(query as Record<string, string>).toString();
  const res = await client.get(`/api/workspaces/${wsId}/usage/records${qs ? `?${qs}` : ""}`);
  expectStatus(res, 200);
  expect(Array.isArray(res.body?.records), "usage records must be an array").toBe(true);
  return res.body.records as any[];
}

/** Chat (model) calls recorded for the workspace, optionally for one conversation, with the given status. */
export async function answerCalls(client: Client, wsId: string, status: "ok" | "error" = "ok", conversationId?: string) {
  const records = await usageRecords(client, wsId, conversationId ? { conversationId } : {});
  return records.filter((r) => r.kind === "chat" && r.status === status);
}

export async function spent(client: Client, wsId: string): Promise<number> {
  const res = await client.get(`/api/workspaces/${wsId}/usage`);
  expectStatus(res, 200);
  expect(typeof res.body?.spentUsd, "spentUsd must be a number").toBe("number");
  return res.body.spentUsd as number;
}

export async function setBudget(client: Client, wsId: string, monthlyUsd: number | null) {
  const res = await client.put(`/api/workspaces/${wsId}/budget`, { monthlyUsd });
  expectStatus(res, 200);
  return res.body;
}

export function markers(text: string): number[] {
  return [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
}

// --- the application process ----------------------------------------------------

/** Restart the application under test, keeping its database (runner control API). */
export async function restartApp() {
  if (!CONTROL_URL) throw new Error("ACCEPTANCE_CONTROL_URL is not set: run the suite through run.mjs");
  const res = await fetch(`${CONTROL_URL}/restart`, { method: "POST" });
  if (res.status !== 200) throw new Error(`restart failed: ${res.status} ${await res.text()}`);
}
