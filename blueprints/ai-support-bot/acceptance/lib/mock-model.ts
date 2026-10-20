// A stand-in for the model service, for the tests that run the product in real mode
// (MODEL_PROVIDER=real, spec/architecture.md §5.1–§5.2). It speaks the OpenAI-compatible
// chat-completions protocol, both as one JSON reply (always with `usage`) and as a stream (with `usage`
// only when the request carries stream_options.include_usage, as the real protocol does).
//
// It knows nothing about the product's prompts, so a test decides every reply from the request
// number and the request itself. Everything the product sent is kept in `requests`.

import http from "node:http";

export interface MockRequest {
  /** 1-based, in arrival order. */
  callNo: number;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: any;
  /** `max_tokens` (or `max_completion_tokens`) as sent; null when the product sent neither. */
  cap: number | null;
  stream: boolean;
  /** The text of every message sent (string contents and text parts), joined with newlines. */
  promptText: string;
}

function messageText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  const parts: string[] = [];
  for (const m of messages as any[]) {
    if (typeof m?.content === "string") parts.push(m.content);
    else if (Array.isArray(m?.content)) for (const p of m.content) if (typeof p?.text === "string") parts.push(p.text);
  }
  return parts.join("\n");
}

/**
 * Characters of every message's text (string contents and text parts), counted in Unicode code points and
 * summed per message, without separators. spec/architecture.md §5.1: the product estimates input tokens at one
 * per character, so a reservation made that way always covers this many prompt tokens.
 */
export function promptChars(body: any): number {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return 0;
  let n = 0;
  for (const m of messages as any[]) {
    if (typeof m?.content === "string") n += [...m.content].length;
    else if (Array.isArray(m?.content)) for (const p of m.content) if (typeof p?.text === "string") n += [...p.text].length;
  }
  return n;
}

export interface MockReply {
  content: string;
  promptTokens: number;
  completionTokens: number;
}

export type MockReplyFn = (request: MockRequest) => MockReply;

export class MockModel {
  readonly requests: MockRequest[] = [];
  readonly replies: MockReply[] = [];
  private port = 0;
  private server: http.Server | null = null;

  private constructor(private readonly replyFor: MockReplyFn) {}

  static async start(replyFor: MockReplyFn): Promise<MockModel> {
    const mock = new MockModel(replyFor);
    mock.server = http.createServer((req, res) => void mock.handle(req, res));
    await new Promise<void>((resolve) => mock.server!.listen(0, "127.0.0.1", resolve));
    mock.port = (mock.server.address() as { port: number }).port;
    return mock;
  }

  /** What the product gets as MODEL_BASE_URL. */
  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}/v1`;
  }

  async close(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://mock");
    if (req.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: `mock model: no route for ${req.method} ${url.pathname}` } }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    let body: any;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "mock model: body is not JSON" } }));
      return;
    }
    const cap = [body?.max_tokens, body?.max_completion_tokens].find((v) => typeof v === "number") ?? null;
    const request: MockRequest = { callNo: this.requests.length + 1, path: url.pathname, headers: req.headers, body, cap, stream: body?.stream === true, promptText: messageText(body?.messages) };
    this.requests.push(request);
    const reply = this.replyFor(request);
    this.replies.push(reply);

    const usage = {
      prompt_tokens: reply.promptTokens,
      completion_tokens: reply.completionTokens,
      total_tokens: reply.promptTokens + reply.completionTokens,
    };
    const id = `chatcmpl-mock-${request.callNo}`;
    const created = Math.floor(Date.now() / 1000);
    const model = typeof body?.model === "string" ? body.model : "mock-model";
    if (!request.stream) {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          id,
          object: "chat.completion",
          created,
          model,
          choices: [{ index: 0, message: { role: "assistant", content: reply.content }, finish_reason: "stop" }],
          usage,
        }),
      );
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const half = Math.max(1, Math.floor(reply.content.length / 2));
    for (const piece of [reply.content.slice(0, half), reply.content.slice(half)].filter(Boolean)) {
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: piece } }] })}\n\n`);
    }
    // Like the real protocol: a stream reports `usage` (on a last, extra chunk) only when the request asked
    // for it with stream_options.include_usage. A product that does not ask cannot bill by usage.
    res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    if (body?.stream_options?.include_usage === true) {
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [], usage })}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  }
}

/** Dollars for one reply at these prices (USD per million tokens). */
export function replyCostUsd(reply: MockReply, inputPerMTok: number, outputPerMTok: number): number {
  return (reply.promptTokens * inputPerMTok + reply.completionTokens * outputPerMTok) / 1_000_000;
}

/** The environment that points the product at a mock, in real mode. */
export function realModeEnv(mock: MockModel, prices: { inputPerMTok: number; outputPerMTok: number }, apiKey: string): Record<string, string> {
  return {
    MODEL_PROVIDER: "real",
    MODEL_BASE_URL: mock.baseUrl,
    MODEL_API_KEY: apiKey,
    MODEL_NAME: "mock-model",
    MODEL_INPUT_USD_PER_MTOK: String(prices.inputPerMTok),
    MODEL_OUTPUT_USD_PER_MTOK: String(prices.outputPerMTok),
    EMBEDDING_PROVIDER: "local",
  };
}
