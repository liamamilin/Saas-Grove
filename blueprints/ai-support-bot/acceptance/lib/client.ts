// A small HTTP client for black-box tests: keeps its own cookie jar, speaks
// JSON, multipart and Server-Sent Events, and never follows redirects.

// Not BASE_URL: Vite/Vitest reserve that name and set it to "/".
export const BASE_URL = (process.env.ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
export const CONTROL_URL = process.env.ACCEPTANCE_CONTROL_URL;

export interface Res {
  status: number;
  headers: Headers;
  body: any;
  text: string;
}

export interface SseEvent {
  event: string;
  data: any;
  /** Milliseconds after the request was sent at which this event arrived. */
  at: number;
}

export interface SseRes {
  status: number;
  headers: Headers;
  events: SseEvent[];
  body: any; // parsed JSON when the server answered with an error instead of a stream
}

export interface Upload {
  filename: string;
  content: string | Uint8Array;
  mimeType: string;
  title?: string;
}

export class Client {
  private jar = new Map<string, string>();
  /** Raw Set-Cookie headers of the most recent response. */
  lastSetCookies: string[] = [];

  constructor(readonly base: string = BASE_URL) {}

  /** A copy of this client's cookies, to replay a session after it should have ended. */
  snapshot(): Map<string, string> {
    return new Map(this.jar);
  }

  static withCookies(cookies: Map<string, string>): Client {
    const c = new Client();
    c.jar = new Map(cookies);
    return c;
  }

  private cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private absorb(headers: Headers) {
    const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    this.lastSetCookies = list;
    for (const raw of list) {
      const [pair, ...attrs] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => {
        const [k, v] = a.trim().split("=");
        if (/^max-age$/i.test(k)) return Number(v) <= 0;
        if (/^expires$/i.test(k)) return Date.parse(v) < Date.now();
        return false;
      });
      if (!value || expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  private async send(method: string, path: string, init: { headers?: Record<string, string>; body?: any }) {
    const headers = new Headers(init.headers);
    if (this.jar.size) headers.set("cookie", this.cookieHeader());
    const res = await fetch(this.base + path, { method, headers, body: init.body, redirect: "manual" });
    this.absorb(res.headers);
    return res;
  }

  async request(
    method: string,
    path: string,
    opts: { json?: unknown; body?: any; headers?: Record<string, string> } = {},
  ): Promise<Res> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    let body = opts.body;
    if (opts.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.json);
    }
    const res = await this.send(method, path, { headers, body });
    const text = await res.text();
    let parsed: any;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = undefined;
    }
    return { status: res.status, headers: res.headers, body: parsed, text };
  }

  get(path: string) {
    return this.request("GET", path);
  }
  post(path: string, json?: unknown) {
    return this.request("POST", path, json === undefined ? {} : { json });
  }
  put(path: string, json?: unknown) {
    return this.request("PUT", path, json === undefined ? {} : { json });
  }
  patch(path: string, json?: unknown) {
    return this.request("PATCH", path, json === undefined ? {} : { json });
  }
  del(path: string) {
    return this.request("DELETE", path);
  }

  upload(path: string, file: Upload): Promise<Res> {
    const form = new FormData();
    const bytes = typeof file.content === "string" ? new TextEncoder().encode(file.content) : file.content;
    form.append("file", new Blob([new Uint8Array(bytes)], { type: file.mimeType }), file.filename);
    if (file.title) form.append("title", file.title);
    return this.request("POST", path, { body: form });
  }

  /**
   * POST JSON and read a Server-Sent Events response to its end, incrementally.
   * Each event carries `at`: milliseconds from sending the request to the moment
   * that event arrived, so a test can tell real streaming from a buffered reply.
   */
  async sse(path: string, json: unknown, extraHeaders: Record<string, string> = {}): Promise<SseRes> {
    const t0 = Date.now();
    const res = await this.send("POST", path, {
      headers: { ...extraHeaders, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(json),
    });
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text/event-stream") || !res.body) {
      const text = await res.text();
      let body: any;
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
      return { status: res.status, headers: res.headers, events: [], body };
    }
    const events: SseEvent[] = [];
    const decoder = new TextDecoder();
    let buffer = "";
    const flush = (block: string) => {
      let event = "message";
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (!data.length) return;
      const joined = data.join("\n");
      let parsed: any = joined;
      try {
        parsed = JSON.parse(joined);
      } catch {
        // leave as text
      }
      events.push({ event, data: parsed, at: Date.now() - t0 });
    };
    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut: RegExpExecArray | null;
      while ((cut = /\r?\n\r?\n/.exec(buffer))) {
        flush(buffer.slice(0, cut.index));
        buffer = buffer.slice(cut.index + cut[0].length);
      }
    }
    if (buffer.trim()) flush(buffer);
    return { status: res.status, headers: res.headers, events, body: undefined };
  }
}
