import { ipAddress } from "@vercel/functions";

import { getDb } from "@/db/client";
import { runtimeMode } from "@/lib/env";
import { handleMcpRequest } from "@/lib/mcp/handler";

export const maxDuration = 30;

/**
 * MCP の口。POST だけを export する (GET などは Next が 405 を返す)。
 * 環境変数はモジュールの読み込み時に読まない (環境変数なしで `next build` が通るようにするため)。
 */
export async function POST(req: Request) {
  try {
    return await handleMcpRequest(req, {
      db: getDb(),
      mode: runtimeMode(),
      // Vercel 以外では undefined になりうる。ローカルでは IP を使わないので null で構わない
      clientIp: ipAddress(req) ?? null,
      now: () => new Date(),
    });
  } catch (error) {
    // 想定外の例外。中身はログにだけ出し、応答には返さない
    console.error("[api:mcp] unexpected error", error);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
