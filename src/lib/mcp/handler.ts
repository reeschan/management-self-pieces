import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import type { AppDb } from "@/db/types";
import { createBoardService } from "@/lib/devloop/board";
import { createControlService } from "@/lib/devloop/control";
import type { TrackerProvider } from "@/lib/tracker/types";

import { gateRequest } from "./gate";
import { type DevloopServices, registerTools } from "./tools";

export type McpDeps = {
  db: AppDb;
  mode: "local" | "host";
  clientIp: string | null;
  now: () => Date;
  /** Asana の Tracker を作る。看板のツールが呼ばれたときだけ呼ぶ (環境変数が無ければ例外) */
  tracker: () => TrackerProvider;
  /** 持ち主の Asana のユーザー gid (ASANA_OWNER_GID)。未設定なら null */
  ownerAssigneeId: string | null;
};

/** devloop のサービスを、最初に呼ばれたときに 1 回だけ作る関数を返す。 */
function lazyDevloop(deps: McpDeps): () => DevloopServices {
  let services: DevloopServices | null = null;
  return () => {
    services ??= {
      board: createBoardService({
        db: deps.db,
        tracker: deps.tracker(),
        ownerAssigneeId: deps.ownerAssigneeId ?? undefined,
        now: deps.now,
      }),
      control: createControlService({ db: deps.db, now: deps.now }),
    };
    return services;
  };
}

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
      devloop: lazyDevloop(deps),
    });
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (error) {
    console.error("[mcp:handler] failed to handle request", error);
    return internalErrorResponse();
  }
}
