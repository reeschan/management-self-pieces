import { and, count, eq } from "drizzle-orm";

import { externalRefs, taskCache } from "@/db/schema";
import type { AppDb } from "@/db/types";
import type { TrackerTaskDetail } from "@/lib/tracker/types";
import { parseItemNotes } from "./item-meta";

const PROVIDER = "asana";

/** Node のプロジェクトの写しを、列・タグ・meta ごと入れ直す。 */
export async function saveTaskCache(
  db: AppDb,
  input: {
    nodeId: string;
    projectId: string;
    details: TrackerTaskDetail[];
    now: Date;
  },
): Promise<number> {
  const { nodeId, projectId, details, now } = input;
  await db.delete(taskCache).where(
    and(
      eq(taskCache.provider, PROVIDER),
      eq(taskCache.projectExternalId, projectId),
    ),
  );
  if (details.length === 0) return 0;

  await db.insert(taskCache).values(
    details.map((task) => ({
      provider: PROVIDER,
      externalId: task.externalId,
      projectExternalId: projectId,
      nodeId,
      name: task.name,
      completed: task.completed,
      dueOn: task.dueOn,
      url: task.url,
      section: task.sectionName,
      tags: task.tags,
      meta: parseItemNotes(task.notes).meta,
      updatedAt: now,
    })),
  );
  return details.length;
}

/** 現在も Node に紐づく Asana のプロジェクトの項目だけを返す。 */
export async function findCachedItem(
  db: AppDb,
  itemId: string,
): Promise<{
  nodeId: string;
  projectExternalId: string;
  section: string | null;
} | null> {
  const [row] = await db
    .select({
      nodeId: taskCache.nodeId,
      projectExternalId: taskCache.projectExternalId,
      section: taskCache.section,
    })
    .from(taskCache)
    .innerJoin(
      externalRefs,
      and(
        eq(externalRefs.nodeId, taskCache.nodeId),
        eq(externalRefs.provider, taskCache.provider),
        eq(externalRefs.externalId, taskCache.projectExternalId),
      ),
    )
    .where(
      and(eq(taskCache.provider, PROVIDER), eq(taskCache.externalId, itemId)),
    )
    .limit(1);
  return row ?? null;
}

/** 未完了の「Owner 判断」を、全 Node または指定した Node で数える。 */
export async function countOwnerDecisions(
  db: AppDb,
  nodeId?: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(taskCache)
    .where(
      and(
        eq(taskCache.provider, PROVIDER),
        eq(taskCache.section, "Owner 判断"),
        eq(taskCache.completed, false),
        nodeId === undefined ? undefined : eq(taskCache.nodeId, nodeId),
      ),
    );
  return row.count;
}
