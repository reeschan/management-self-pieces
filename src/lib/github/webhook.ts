import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { RepoKey } from "@/lib/nodes/repo-link";

export type GithubAction =
  | { kind: "refresh"; repos: RepoKey[] } // 名前・id・届くかを GitHub に照らして直す
  | { kind: "unreachable"; repos: RepoKey[] }; // 届かない印を付ける

/** decideGithubAction の判断と、何もしないときの理由 (応答とログ用) */
type GithubDecision = { actions: GithubAction[]; reason: string };

const repoRef = z.object({
  id: z.number(),
  full_name: z.string().min(1),
});

const repositorySchema = z.object({
  action: z.string(),
  repository: repoRef,
});

const installationRepositoriesSchema = z.object({
  repositories_added: z.array(repoRef).optional().default([]),
  repositories_removed: z.array(repoRef).optional().default([]),
});

const installationSchema = z.object({
  action: z.string(),
  repositories: z.array(repoRef).optional().default([]),
});

/** repository イベントで、名前や状態が変わって見直しが要る action */
const refreshRepositoryActions = new Set([
  "renamed",
  "transferred",
  "archived",
  "unarchived",
]);

function toKey(ref: z.infer<typeof repoRef>): RepoKey {
  return { id: ref.id, fullName: ref.full_name };
}

/** GitHub Webhook のイベントから、つながりの更新の指示と理由を決める (例外を投げない) */
function decideGithubDecision(event: string, payload: unknown): GithubDecision {
  switch (event) {
    case "repository": {
      const parsed = repositorySchema.safeParse(payload);
      if (!parsed.success) {
        return { actions: [], reason: "repository の payload が不正です" };
      }
      const { action, repository } = parsed.data;
      if (refreshRepositoryActions.has(action)) {
        return {
          actions: [{ kind: "refresh", repos: [toKey(repository)] }],
          reason: `repository の action: ${action}`,
        };
      }
      if (action === "deleted") {
        return {
          actions: [{ kind: "unreachable", repos: [toKey(repository)] }],
          reason: `repository の action: ${action}`,
        };
      }
      return { actions: [], reason: `repository の action: ${action}` };
    }
    case "installation_repositories": {
      const parsed = installationRepositoriesSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          actions: [],
          reason: "installation_repositories の payload が不正です",
        };
      }
      const { repositories_added, repositories_removed } = parsed.data;
      const actions: GithubAction[] = [];
      if (repositories_added.length > 0) {
        actions.push({
          kind: "refresh",
          repos: repositories_added.map(toKey),
        });
      }
      if (repositories_removed.length > 0) {
        actions.push({
          kind: "unreachable",
          repos: repositories_removed.map(toKey),
        });
      }
      if (actions.length === 0) {
        return { actions, reason: "リポジトリの変化がありません" };
      }
      return { actions, reason: "installation の repositories が変わりました" };
    }
    case "installation": {
      const parsed = installationSchema.safeParse(payload);
      if (!parsed.success) {
        return { actions: [], reason: "installation の payload が不正です" };
      }
      const { action, repositories } = parsed.data;
      if (action === "deleted" && repositories.length > 0) {
        return {
          actions: [{ kind: "unreachable", repos: repositories.map(toKey) }],
          reason: "installation が削除されました",
        };
      }
      return { actions: [], reason: `installation の action: ${action}` };
    }
    default:
      return { actions: [], reason: `対象外のイベント: ${event || "(なし)"}` };
  }
}

/** GitHub Webhook のイベントから、つながりの更新の指示を決める (例外を投げない) */
export function decideGithubAction(
  event: string,
  payload: unknown,
): GithubAction[] {
  return decideGithubDecision(event, payload).actions;
}

/** 空になるときの理由を返す (応答とログ用) */
export function explainGithubAction(event: string, payload: unknown): string {
  return decideGithubDecision(event, payload).reason;
}

/** Authorization ヘッダーが "Bearer <cronSecret>" と一致するかを定数時間で比べる */
export function isAuthorizedCron(
  authorization: string | null,
  cronSecret: string,
): boolean {
  if (authorization === null || cronSecret.length === 0) return false;
  const actual = Buffer.from(authorization, "utf8");
  const expected = Buffer.from(`Bearer ${cronSecret}`, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
