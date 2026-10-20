// The public side of the product: the widget settings a team member sees, and an anonymous website
// visitor talking to the public widget API (spec/api.yaml, "public widget API"). A Visitor sends the
// Origin header a browser would send; by default that is the product's own origin (APP_BASE_URL),
// which the product always allows (spec/architecture.md §4.4).

import http from "node:http";
import { expect } from "vitest";
import { BASE_URL, Client, type Res, type SseEvent, type SseRes } from "./client";
import { expectStatus, owner, type Team } from "./helpers";

export interface WidgetSettings {
  widgetKey: string;
  enabled: boolean;
  allowedOrigins: string[];
  botName: string;
  greeting: string;
  fallbackMessage: string;
  embedSnippet?: string;
}

export async function widgetSettings(client: Client, wsId: string): Promise<WidgetSettings> {
  const res = await client.get(`/api/workspaces/${wsId}/widget`);
  expectStatus(res, 200);
  expect(typeof res.body?.widget?.widgetKey, "widget.widgetKey").toBe("string");
  expect(res.body.widget.widgetKey.length).toBeGreaterThan(0);
  return res.body.widget;
}

export async function updateWidget(client: Client, wsId: string, patch: Partial<WidgetSettings>): Promise<WidgetSettings> {
  const res = await client.patch(`/api/workspaces/${wsId}/widget`, patch);
  expectStatus(res, 200);
  expect(res.body?.widget, "PATCH widget returns { widget }").toBeTruthy();
  return res.body.widget;
}

export interface SupportTeam extends Team {
  widget: WidgetSettings;
  key: string;
}

/** A fresh owner with a fresh workspace, and its widget settings. */
export async function supportTeam(): Promise<SupportTeam> {
  const team = await owner();
  const widget = await widgetSettings(team.client, team.ws.id);
  return { ...team, widget, key: widget.widgetKey };
}

export const OWN_ORIGIN = new URL(BASE_URL).origin;

export interface Answer {
  res: SseRes;
  deltas: SseEvent[];
  /** The assistant message from the `done` event. */
  message: any;
}

export class Visitor {
  readonly http: Client;
  id = "";
  token = "";

  /** `origin: null` sends no Origin header at all (a script, not a browser). */
  constructor(
    readonly key: string,
    readonly origin: string | null = OWN_ORIGIN,
    base: string = BASE_URL,
  ) {
    this.http = new Client(base);
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.origin !== null) h.origin = this.origin;
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  path(rest: string): string {
    return `/api/widget/${encodeURIComponent(this.key)}${rest}`;
  }

  request(method: string, rest: string, json?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    return this.http.request(method, this.path(rest), json === undefined ? { headers: this.headers(headers) } : { json, headers: this.headers(headers) });
  }

  /** POST /conversations without asserting anything. */
  tryStart(): Promise<Res> {
    return this.request("POST", "/conversations", {});
  }

  /** Start a conversation; it must succeed. */
  async start(): Promise<this> {
    const res = await this.tryStart();
    expectStatus(res, 201);
    expect(typeof res.body?.conversation?.id, "conversation.id").toBe("string");
    expect(typeof res.body?.visitorToken, "visitorToken").toBe("string");
    expect(res.body.visitorToken.length, "visitorToken is long enough to be a secret").toBeGreaterThanOrEqual(16);
    this.id = res.body.conversation.id;
    this.token = res.body.visitorToken;
    return this;
  }

  /** Ask a question and read the whole SSE answer, asserting nothing. */
  ask(content: string, conversationId = this.id): Promise<SseRes> {
    return this.http.sse(this.path(`/conversations/${conversationId}/messages`), { content }, this.headers());
  }

  /** Ask a question; the answer must stream to a `done` event. */
  async answer(content: string): Promise<Answer> {
    const res = await this.ask(content);
    expect(res.status, `${res.status} ${JSON.stringify(res.body ?? res.events).slice(0, 400)}`).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/event-stream/);
    const done = res.events.find((e) => e.event === "done");
    expect(done, `no done event: ${JSON.stringify(res.events).slice(0, 400)}`).toBeTruthy();
    const message = done!.data?.message;
    expect(message, "done event carries { message }").toBeTruthy();
    expect(message.role).toBe("assistant");
    return { res, deltas: res.events.filter((e) => e.event === "delta"), message };
  }

  /** GET the visitor's own conversation; it must succeed. */
  async conversation(): Promise<{ conversation: any; messages: any[] }> {
    const res = await this.request("GET", `/conversations/${this.id}`);
    expectStatus(res, 200);
    expect(Array.isArray(res.body?.messages), "messages must be an array").toBe(true);
    return res.body;
  }

  feedback(messageId: string, rating: string): Promise<Res> {
    return this.request("POST", `/conversations/${this.id}/messages/${messageId}/feedback`, { rating });
  }

  handoff(body: { name?: string; email?: string; note?: string } = {}): Promise<Res> {
    return this.request("POST", `/conversations/${this.id}/handoff`, body);
  }
}

/** A visitor who has started a conversation. */
export async function visitor(key: string, origin: string | null = OWN_ORIGIN, base: string = BASE_URL): Promise<Visitor> {
  return new Visitor(key, origin, base).start();
}

/** An answered message: it must be answered, cite something, and have a citation for each marker. */
export function expectAnswered(message: any) {
  expect(message.outcome, JSON.stringify(message).slice(0, 400)).toBe("answered");
  expect(Array.isArray(message.citations) && message.citations.length > 0, "an answered message has citations").toBe(true);
}

/** An unanswered message: exactly the fallback text, and no citations. */
export function expectUnanswered(message: any, fallbackMessage: string) {
  expect(message.outcome, JSON.stringify(message).slice(0, 400)).toBe("unanswered");
  expect(message.content).toBe(fallbackMessage);
  expect(message.citations ?? []).toEqual([]);
}

/** Serve one HTML page from another origin (a customer's website), for the embedded widget. */
export async function hostPage(html: string): Promise<{ origin: string; url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  // Another port is another origin: the page is cross-origin to the product, as a customer's site is.
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    url: `${origin}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
