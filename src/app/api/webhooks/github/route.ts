import { verify } from "@octokit/webhooks-methods";

import { getDb } from "@/db/client";
import { githubEnv } from "@/lib/env";
import { createRepoSource } from "@/lib/github/app";
import { decideGithubAction, explainGithubAction } from "@/lib/github/webhook";
import {
  createRepoLinkService,
  type RefreshSummary,
} from "@/lib/nodes/repo-link";

/** 1 つの指示の結果 (件数のみ) */
type ActionResult =
  | ({ kind: "refresh" } & RefreshSummary)
  | { kind: "unreachable"; marked: number };

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

  const event = req.headers.get("x-github-event") ?? "";
  const actions = decideGithubAction(event, payload);
  if (actions.length === 0) {
    return Response.json({ ignored: explainGithubAction(event, payload) });
  }

  const service = createRepoLinkService({
    db: getDb(),
    source: createRepoSource,
    now: () => new Date(),
  });

  const results: ActionResult[] = [];
  try {
    for (const action of actions) {
      if (action.kind === "refresh") {
        results.push({
          kind: "refresh",
          ...(await service.refreshRepos(action.repos)),
        });
      } else {
        results.push({
          kind: "unreachable",
          marked: await service.markUnreachable(action.repos),
        });
      }
    }
  } catch (error) {
    console.error("[webhook:github] repo link update failed", error);
    return Response.json({ error: "internal error" }, { status: 500 });
  }

  return Response.json({ results });
}
