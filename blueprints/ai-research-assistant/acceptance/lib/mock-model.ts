// A stand-in for the model service, for the tests that run the product in real mode
// (MODEL_PROVIDER=real, spec/architecture.md §5.1–§5.2). It speaks the OpenAI-compatible
// chat-completions protocol, both as one JSON reply and as a stream, and always reports `usage`.
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
    const request: MockRequest = { callNo: this.requests.length + 1, path: url.pathname, headers: req.headers, body, cap, stream: body?.stream === true };
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
    // `usage` always rides on the last chunk, whether or not the product asked for it.
    res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage })}\n\n`);
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
