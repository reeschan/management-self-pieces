import { and, eq, isNotNull, ne, or } from "drizzle-orm";

import { type NodeRow, nodes } from "@/db/schema";
import type { AppDb } from "@/db/types";
import type { RepoSource } from "@/lib/github/types";

/** Webhook や Cron が知らせてくるリポジトリ (GitHub の id と "owner/name") */
export type RepoKey = { id: number; fullName: string };

export type RefreshSummary = {
  checked: number;
  updated: number;
  unreachable: number;
  failed: number;
};

type CheckResult = "updated" | "unreachable" | "failed" | "unchanged";

/**
 * Node とリポジトリのつながり (名前・届くか) を GitHub に照らして直す。
 * Node は消さない。トランザクションは使わず、1 Node につき 1 文ずつ読み書きする。
 */
export function createRepoLinkService(deps: {
  db: AppDb;
  source: () => RepoSource;
  now: () => Date;
}) {
  const { db } = deps;

  /** repos に結び付く Node か。repoId があれば id、無ければ名前 (大文字小文字を無視) で見る */
  function matches(node: NodeRow, repos: RepoKey[]): boolean {
    if (node.repoId !== null) {
      return repos.some((repo) => repo.id === node.repoId);
    }
    if (node.sourceRepo === null) return false;
    const name = node.sourceRepo.toLowerCase();
    return repos.some((repo) => repo.fullName.toLowerCase() === name);
  }

  /** リポジトリを持つ Node (名前か id のどちらかがある) */
  async function listLinkedNodes(): Promise<NodeRow[]> {
    return db
      .select()
      .from(nodes)
      .where(or(isNotNull(nodes.sourceRepo), isNotNull(nodes.repoId)));
  }

  /**
   * 1 つの Node を確かめる。見つかれば名前と id を最新にして届く印にし、
   * 見つからなければ届かない印にする。例外なら何も変えない。
   */
  async function checkOne(node: NodeRow): Promise<CheckResult> {
    try {
      const source = deps.source();
      const repo =
        node.repoId !== null
          ? await source.getRepoById(node.repoId)
          : node.sourceRepo !== null
            ? await source.getRepo(node.sourceRepo)
            : null;

      if (repo === null) {
        if (node.repoReachable) {
          await db
            .update(nodes)
            .set({ repoReachable: false, updatedAt: deps.now() })
            .where(eq(nodes.id, node.id));
        }
        return "unreachable";
      }

      const changed =
        node.sourceRepo !== repo.fullName ||
        node.repoId !== repo.id ||
        !node.repoReachable;
      if (!changed) return "unchanged";

      // 名前か id が別の Node と重なるなら、一意制約にぶつかるので更新しない
      const conflict = await db
        .select({ id: nodes.id })
        .from(nodes)
        .where(
          and(
            ne(nodes.id, node.id),
            or(eq(nodes.sourceRepo, repo.fullName), eq(nodes.repoId, repo.id)),
          ),
        )
        .limit(1);
      if (conflict.length > 0) return "failed";

      await db
        .update(nodes)
        .set({
          sourceRepo: repo.fullName,
          repoId: repo.id,
          repoReachable: true,
          updatedAt: deps.now(),
        })
        .where(eq(nodes.id, node.id));
      return "updated";
    } catch {
      return "failed";
    }
  }

  async function checkAll(targets: NodeRow[]): Promise<RefreshSummary> {
    const summary: RefreshSummary = {
      checked: targets.length,
      updated: 0,
      unreachable: 0,
      failed: 0,
    };
    for (const node of targets) {
      const result = await checkOne(node);
      if (result !== "unchanged") summary[result] += 1;
    }
    return summary;
  }

  return {
    /** リポジトリを持つ全 Node を確かめる */
    async refreshAll(): Promise<RefreshSummary> {
      const targets = await db
        .select()
        .from(nodes)
        .where(isNotNull(nodes.sourceRepo));
      return checkAll(targets);
    },

    /** 指定のリポジトリに結び付く Node だけを確かめる */
    async refreshRepos(repos: RepoKey[]): Promise<RefreshSummary> {
      const linked = await listLinkedNodes();
      return checkAll(linked.filter((node) => matches(node, repos)));
    },

    /** 同じ一致の決まりで届かない印を付ける (GitHub は呼ばない) */
    async markUnreachable(repos: RepoKey[]): Promise<number> {
      const linked = await listLinkedNodes();
      const targets = linked.filter((node) => matches(node, repos));
      for (const node of targets) {
        if (!node.repoReachable) continue;
        await db
          .update(nodes)
          .set({ repoReachable: false, updatedAt: deps.now() })
          .where(eq(nodes.id, node.id));
      }
      return targets.length;
    },
  };
}
