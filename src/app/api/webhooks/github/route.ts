import { verify } from "@octokit/webhooks-methods";

import { githubEnv } from "@/lib/env";

export async function POST(req: Request) {
  // 署名の検証には生の本文が要る。JSON.parse は必ず検証の後に行う
  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";

  let valid = false;
  try {
    valid = await verify(githubEnv().webhookSecret, body, signature);
  } catch (error) {
    console.error("[webhook:github] signature verification failed", error);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
  if (!valid) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    JSON.parse(body);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  return Response.json({ ignored: "取り込みは廃止 (つながりの更新は今後追加)" });
}
