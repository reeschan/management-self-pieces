import { count, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { nodes, relations, taskCache } from "@/db/schema";
import { toGraphData, type GraphData } from "./graph";

export async function loadGraph(): Promise<GraphData> {
  const db = getDb();
  const [nodeRows, relationRows, taskRows] = await Promise.all([
    db
      .select({
        id: nodes.id,
        kind: nodes.kind,
        title: nodes.title,
        summary: nodes.summary,
        status: nodes.status,
      })
      .from(nodes),
    db
      .select({
        fromId: relations.fromId,
        toId: relations.toId,
        type: relations.type,
      })
      .from(relations),
    db
      .select({ nodeId: taskCache.nodeId, n: count() })
      .from(taskCache)
      .where(eq(taskCache.completed, false))
      .groupBy(taskCache.nodeId),
  ]);
  const counts: Record<string, number> = {};
  for (const r of taskRows) counts[r.nodeId] = Number(r.n);
  return toGraphData(nodeRows, relationRows, counts);
}
