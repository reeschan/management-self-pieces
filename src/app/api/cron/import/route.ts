import { cronEnv } from "@/lib/env";
import { isAuthorizedCron } from "@/lib/github/webhook";
import { runFullImport } from "@/lib/import/run";

export const maxDuration = 60;

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

  try {
    return Response.json(await runFullImport());
  } catch (error) {
    console.error("[cron:import] import failed", error);
    return Response.json({ error: "import failed" }, { status: 500 });
  }
}
