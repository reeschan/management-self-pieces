// パス名 (cron/import) は以前の取り込み (node.yaml の取り込み) の名残。
// 取り込みは廃止したが、vercel.json の Cron がこのパスを呼ぶため変えない。
import { getDb } from "@/db/client";
import { cronEnv } from "@/lib/env";
import { createRepoSource } from "@/lib/github/app";
import { isAuthorizedCron } from "@/lib/github/webhook";
import { purgeAudit } from "@/lib/mcp/audit";
import { purgeRateLimits } from "@/lib/mcp/rate-limit";
import {
  createRepoLinkService,
  type RefreshSummary,
} from "@/lib/nodes/repo-link";

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

  // Node とリポジトリのつながり (名前と届くか) を直す
  let summary: RefreshSummary;
  try {
    summary = await createRepoLinkService({
      db: getDb(),
      source: createRepoSource,
      now: () => new Date(),
    }).refreshAll();
  } catch (error) {
    console.error("[cron:import] repo link refresh failed", error);
    return Response.json({ error: "internal error" }, { status: 500 });
  }

  // つながりの更新の後で、90 日を過ぎた監査ログと古い回数の行を消す
  const now = new Date();
  const auditPurged = await purgeSafely("audit", () =>
    purgeAudit(getDb(), now),
  );
  const rateLimitsPurged = await purgeSafely("rate-limit", () =>
    purgeRateLimits(getDb(), now),
  );

  return Response.json({ ...summary, auditPurged, rateLimitsPurged });
}
