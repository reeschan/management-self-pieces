import type { NewNodeRow } from "@/db/schema";
import type { ImportError, ImportResult } from "@/lib/github/types";

/**
 * 取り込み結果を DB に反映するための計画を作る。
 * DB にも GitHub にも依存しない純粋関数 (テストで import しても接続は起きない)。
 */

export type ExistingNode = { id: string; sourceRepo: string; sourceSha: string };

export type SyncPlan = {
  /** nodes に upsert する行 */
  upserts: NewNodeRow[];
  /** upserts の Node の関係 (全件、重複なし) */
  relations: { fromId: string; toId: string; type: string }[];
  /** 消す Node の id */
  deleteIds: string[];
  errors: ImportError[];
  /** 書き換える範囲のリポジトリ */
  scopeRepos: string[];
};

export function planSync(
  existing: ExistingNode[],
  result: ImportResult,
): SyncPlan {
  const scopeRepos = [...result.scannedRepos];
  const scope = new Set(scopeRepos);
  const now = new Date();

  const upserts: NewNodeRow[] = result.manifests.map(
    ({ repo, sha, manifest }) => ({
      id: manifest.id,
      kind: manifest.kind,
      title: manifest.title,
      summary: manifest.summary,
      status: manifest.status,
      detailPath: manifest.detail,
      tags: manifest.tags,
      links: manifest.links,
      diagrams: manifest.diagrams,
      meta: manifest.meta,
      sourceRepo: repo,
      sourceSha: sha,
      updatedAt: now,
    }),
  );

  const relations: SyncPlan["relations"] = [];
  const seen = new Set<string>();
  for (const { manifest } of result.manifests) {
    for (const r of manifest.relations) {
      const key = JSON.stringify([manifest.id, r.to, r.type]);
      if (seen.has(key)) continue;
      seen.add(key);
      relations.push({ fromId: manifest.id, toId: r.to, type: r.type });
    }
  }

  const importedIds = new Set(result.manifests.map((m) => m.manifest.id));
  const deleteIds = existing
    .filter((n) => scope.has(n.sourceRepo) && !importedIds.has(n.id))
    .map((n) => n.id);

  return {
    upserts,
    relations,
    deleteIds,
    errors: [...result.errors],
    scopeRepos,
  };
}
