import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import type { AppDb } from "@/db/types";

import { gateRequest } from "./gate";
import { registerTools } from "./tools";

export type McpDeps = {
  db: AppDb;
  mode: "local" | "host";
  clientIp: string | null;
  now: () => Date;
};

/** 例外のときの固定の応答。例外の中身は返さない。 */
function internalErrorResponse(): Response {
  return new Response(JSON.stringify({ error: "internal error" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * MCP の口の本体。入口の判定 → MCP サーバーの組み立て → ツールの実行 (監査ログはツールの包みで残す) までを受け持つ。
 * ステートレス (セッションなし) で、リクエストごとにサーバーと transport を新しく作る。
 */
export async function handleMcpRequest(req: Request, deps: McpDeps): Promise<Response> {
  // 1. POST だけを受ける
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST" },
    });
  }

  try {
    // 2. 入口の判定
    const gate = await gateRequest(req, {
      db: deps.db,
      mode: deps.mode,
      clientIp: deps.clientIp,
      now: deps.now(),
    });
    if (!gate.ok) {
      return gate.response;
    }

    // 3. サーバーを組み立てて、このリクエストを処理する
    const server = new McpServer({ name: "pieces", version: "0.1.0" });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    registerTools(server, {
      db: deps.db,
      mode: deps.mode,
      clientIp: deps.clientIp,
      tokenId: gate.tokenId,
      scopes: gate.scopes,
      now: deps.now,
    });
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (error) {
    console.error("[mcp:handler] failed to handle request", error);
    return internalErrorResponse();
  }
}
