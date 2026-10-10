import { verify } from "@octokit/webhooks-methods";

import { githubEnv } from "@/lib/env";
import { decideGithubAction } from "@/lib/github/webhook";
import { runRepoImport, type SyncSummary } from "@/lib/import/run";

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

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const action = decideGithubAction(
    req.headers.get("x-github-event") ?? "",
    payload,
  );
  if (action.kind === "ignore") {
    return Response.json({ ignored: action.reason });
  }

  const total: SyncSummary = {
    upserted: 0,
    deleted: 0,
    errors: 0,
    scannedRepos: 0,
  };
  try {
    for (const fullName of action.repos) {
      const summary = await runRepoImport(fullName);
      total.upserted += summary.upserted;
      total.deleted += summary.deleted;
      total.errors += summary.errors;
      total.scannedRepos += summary.scannedRepos;
    }
  } catch (error) {
    console.error("[webhook:github] import failed", error);
    return Response.json({ error: "import failed" }, { status: 500 });
  }
  return Response.json(total);
}
