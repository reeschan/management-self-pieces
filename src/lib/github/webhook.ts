import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export type GithubAction =
  | { kind: "import-repo"; repos: string[] } // 取り込み直すリポジトリ (fullName)
  | { kind: "ignore"; reason: string };

const repoRef = z.object({ full_name: z.string().min(1) });

const pushSchema = z.object({
  ref: z.string(),
  repository: z.object({
    full_name: z.string().min(1),
    default_branch: z.string().min(1),
  }),
});

const installationRepositoriesSchema = z.object({
  repositories_added: z.array(repoRef).optional().default([]),
  repositories_removed: z.array(repoRef).optional().default([]),
});

const installationSchema = z.object({
  action: z.string(),
  repositories: z.array(repoRef).optional().default([]),
});

function importRepos(names: string[], emptyReason: string): GithubAction {
  const repos = [...new Set(names)];
  if (repos.length === 0) return { kind: "ignore", reason: emptyReason };
  return { kind: "import-repo", repos };
}

/** GitHub Webhook のイベントから、取り込み直すリポジトリを決める (例外を投げない) */
export function decideGithubAction(
  event: string,
  payload: unknown,
): GithubAction {
  switch (event) {
    case "push": {
      const parsed = pushSchema.safeParse(payload);
      if (!parsed.success) {
        return { kind: "ignore", reason: "invalid push payload" };
      }
      const { ref, repository } = parsed.data;
      if (ref !== `refs/heads/${repository.default_branch}`) {
        return { kind: "ignore", reason: "push to non-default branch" };
      }
      return { kind: "import-repo", repos: [repository.full_name] };
    }
    case "installation_repositories": {
      const parsed = installationRepositoriesSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          kind: "ignore",
          reason: "invalid installation_repositories payload",
        };
      }
      const { repositories_added, repositories_removed } = parsed.data;
      return importRepos(
        [...repositories_added, ...repositories_removed].map(
          (r) => r.full_name,
        ),
        "no repositories changed",
      );
    }
    case "installation": {
      const parsed = installationSchema.safeParse(payload);
      if (!parsed.success) {
        return { kind: "ignore", reason: "invalid installation payload" };
      }
      if (parsed.data.action !== "deleted") {
        return {
          kind: "ignore",
          reason: `installation action: ${parsed.data.action}`,
        };
      }
      return importRepos(
        parsed.data.repositories.map((r) => r.full_name),
        "no repositories in deleted installation",
      );
    }
    default:
      return {
        kind: "ignore",
        reason: `unhandled event: ${event || "(none)"}`,
      };
  }
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
