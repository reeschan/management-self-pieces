import { getTableColumns, inArray, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "@/db/client";
import { importErrors, nodes, relations } from "@/db/schema";
import type { SyncPlan } from "./plan";

/** upsert で更新する列 (id 以外の全列) を excluded の値で上書きする */
function excludedSet(): Record<string, SQL> {
  const set: Record<string, SQL> = {};
  for (const [key, column] of Object.entries(getTableColumns(nodes))) {
    if (key === "id") continue;
    set[key] = sql.raw(`excluded."${column.name}"`);
  }
  return set;
}

/**
 * 計画を DB に反映する。neon-http はトランザクションが使えないので
 * `db.batch([...])` で 1 回にまとめる。
 */
export async function applySync(db: Db, plan: SyncPlan): Promise<void> {
  const statements: BatchItem<"pg">[] = [];

  // 1. 消す Node (relations・external_refs は FK の cascade で消える)
  if (plan.deleteIds.length > 0) {
    statements.push(db.delete(nodes).where(inArray(nodes.id, plan.deleteIds)));
  }

  // 2. upsert
  const upsertIds = plan.upserts.map((n) => n.id);
  if (plan.upserts.length > 0) {
    statements.push(
      db
        .insert(nodes)
        .values(plan.upserts)
        .onConflictDoUpdate({ target: nodes.id, set: excludedSet() }),
    );
  }

  // 3. upserts の Node の関係を入れ替える
  if (upsertIds.length > 0) {
    statements.push(
      db.delete(relations).where(inArray(relations.fromId, upsertIds)),
    );
  }
  if (plan.relations.length > 0) {
    statements.push(db.insert(relations).values(plan.relations));
  }

  // 4. 範囲内のリポジトリの import_errors を入れ替える
  const errorRepos = [
    ...new Set([...plan.scopeRepos, ...plan.errors.map((e) => e.repo)]),
  ];
  if (errorRepos.length > 0) {
    statements.push(
      db.delete(importErrors).where(inArray(importErrors.sourceRepo, errorRepos)),
    );
  }
  if (plan.errors.length > 0) {
    statements.push(
      db.insert(importErrors).values(
        plan.errors.map((e) => ({
          sourceRepo: e.repo,
          path: e.path,
          message: e.message,
        })),
      ),
    );
  }

  if (statements.length === 0) return;
  const [first, ...rest] = statements;
  await db.batch([first, ...rest]);
}
