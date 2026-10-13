import { and, asc, eq } from "drizzle-orm";

import { nodes, taskCache } from "@/db/schema";
import type { AppDb } from "@/db/types";

const PROVIDER = "asana";
const OWNER_SECTION = "Owner 判断";

export type OwnerDecision = {
  nodeId: string;
  nodeTitle: string;
  itemId: string;
  name: string;
  url: string | null;
  meta: Record<string, unknown> | null;
};

/**
 * 写し (task_cache) から、列が「Owner 判断」で未完了の項目を全 Node 分返す。
 * Node の名前順、次に項目の名前順。Node が見つからない行は Node の ID を名前の代わりにする
 * (countOwnerDecisions と件数を揃えるため、行は落とさない)。
 */
export async function listOwnerDecisions(db: AppDb): Promise<OwnerDecision[]> {
  const rows = await db
    .select({
      nodeId: taskCache.nodeId,
      nodeTitle: nodes.title,
      itemId: taskCache.externalId,
      name: taskCache.name,
      url: taskCache.url,
      meta: taskCache.meta,
    })
    .from(taskCache)
    .leftJoin(nodes, eq(nodes.id, taskCache.nodeId))
    .where(
      and(
        eq(taskCache.provider, PROVIDER),
        eq(taskCache.section, OWNER_SECTION),
        eq(taskCache.completed, false),
      ),
    )
    .orderBy(
      asc(nodes.title),
      asc(taskCache.nodeId),
      asc(taskCache.name),
      asc(taskCache.externalId),
    );

  return rows.map((row) => ({
    ...row,
    nodeTitle: row.nodeTitle ?? row.nodeId,
  }));
}
