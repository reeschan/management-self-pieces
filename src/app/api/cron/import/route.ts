import { getDb } from "@/db/client";
import { cronEnv } from "@/lib/env";
import { isAuthorizedCron } from "@/lib/github/webhook";
import { runFullImport } from "@/lib/import/run";
import { purgeAudit } from "@/lib/mcp/audit";
import { purgeRateLimits } from "@/lib/mcp/rate-limit";

export const maxDuration = 60;

/** 古い行の削除。失敗はログに出すだけにし、件数の代わりに null を返す (cron を 500 にしない) */
async function purgeSafely(
  label: string,
  purge: () => Promise<number>,
): Promise<number | null> {
  try {
    return await purge();
  } catch (error) {
    console.error(`[cron:import] ${label} purge failed`, error);
    return null;
  }
}

export async function GET(req: Request) {
  // ヘッダーは try の外で読む (prerender 中の中断を catch で握りつぶさないため)
  const authorization = req.headers.get("authorization");
  let authorized = false;
  try {
    authorized = isAuthorizedCron(authorization, cronEnv().cronSecret);
  } catch (error) {
    console.error("[cron:import] configuration error", error);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
  if (!authorized) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let summary: Awaited<ReturnType<typeof runFullImport>>;
  try {
    summary = await runFullImport();
  } catch (error) {
    console.error("[cron:import] import failed", error);
    return Response.json({ error: "import failed" }, { status: 500 });
  }

  // 取り込みの後で、90 日を過ぎた監査ログと古い回数の行を消す
  const now = new Date();
  const auditPurged = await purgeSafely("audit", () =>
    purgeAudit(getDb(), now),
  );
  const rateLimitsPurged = await purgeSafely("rate-limit", () =>
    purgeRateLimits(getDb(), now),
  );

  return Response.json({ ...summary, auditPurged, rateLimitsPurged });
}
