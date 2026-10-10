import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { externalRefs, nodes, syncState, taskCache } from "@/db/schema";
import { asanaEnv } from "@/lib/env";
import { createAsanaProvider } from "./asana";
import type { ExternalRef, TaskInput, TrackerProvider, TrackerTask } from "./types";

const PROVIDER = "asana";

/** Webhook 作成前に置く「ハンドシェイク待ち」の印の key */
export function webhookPendingKey(projectId: string): string {
  return `asana:webhook-pending:${projectId}`;
}

/** ハンドシェイクで受け取った secret の key */
export function webhookSecretKey(projectId: string): string {
  return `asana:webhook-secret:${projectId}`;
}

export function getTracker(): TrackerProvider {
  const env = asanaEnv();
  return createAsanaProvider({
    pat: env.pat,
    workspaceGid: env.workspaceGid,
    teamGid: env.teamGid,
  });
}

async function findRef(nodeId: string): Promise<ExternalRef | null> {
  const rows = await getDb()
    .select({
      provider: externalRefs.provider,
      externalId: externalRefs.externalId,
      url: externalRefs.url,
    })
    .from(externalRefs)
    .where(
      and(eq(externalRefs.nodeId, nodeId), eq(externalRefs.provider, PROVIDER)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function linkNodeToAsana(nodeId: string): Promise<ExternalRef> {
  const existing = await findRef(nodeId);
  if (existing) return existing;

  const db = getDb();
  const [node] = await db
    .select({ id: nodes.id, title: nodes.title, summary: nodes.summary })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .limit(1);
  if (!node) throw new Error("node not found");

  const tracker = getTracker();
  const ref =
    (await tracker.findProjectByNodeId(nodeId)) ??
    (await tracker.createProject(node));

  await db.insert(externalRefs).values({
    nodeId,
    provider: PROVIDER,
    externalId: ref.externalId,
    url: ref.url,
  });

  // ハンドシェイクは createWebhook の処理中に別リクエストで届くので、先に pending を置く
  const now = new Date().toISOString();
  await db
    .insert(syncState)
    .values({ key: webhookPendingKey(ref.externalId), value: now })
    .onConflictDoUpdate({
      target: syncState.key,
      set: { value: now, updatedAt: new Date() },
    });
  const { appUrl } = asanaEnv();
  const target = `${appUrl}/api/webhooks/asana?project=${encodeURIComponent(ref.externalId)}`;
  try {
    await tracker.createWebhook(ref.externalId, target);
  } catch (error) {
    // 既に Webhook がある等。プロジェクトのリンク自体は続ける
    console.warn(
      `[tracker:asana] webhook の作成に失敗しました (project ${ref.externalId})`,
      error instanceof Error ? error.message : error,
    );
  }

  await refreshTasks(nodeId);
  return ref;
}

export async function refreshTasks(nodeId: string): Promise<number> {
  const ref = await findRef(nodeId);
  if (!ref) return 0;

  const tasks = await getTracker().listTasks(ref.externalId);
  const db = getDb();
  const del = db
    .delete(taskCache)
    .where(
      and(
        eq(taskCache.provider, PROVIDER),
        eq(taskCache.projectExternalId, ref.externalId),
      ),
    );
  if (tasks.length === 0) {
    await db.batch([del]);
    return 0;
  }
  const now = new Date();
  await db.batch([
    del,
    db.insert(taskCache).values(
      tasks.map((t) => ({
        provider: PROVIDER,
        externalId: t.externalId,
        projectExternalId: ref.externalId,
        nodeId,
        name: t.name,
        completed: t.completed,
        dueOn: t.dueOn,
        url: t.url,
        updatedAt: now,
      })),
    ),
  ]);
  return tasks.length;
}

export async function refreshTasksByProject(projectId: string): Promise<number> {
  const [row] = await getDb()
    .select({ nodeId: externalRefs.nodeId })
    .from(externalRefs)
    .where(
      and(
        eq(externalRefs.provider, PROVIDER),
        eq(externalRefs.externalId, projectId),
      ),
    )
    .limit(1);
  if (!row) return 0;
  return refreshTasks(row.nodeId);
}

export async function createTaskForNode(
  nodeId: string,
  input: TaskInput,
): Promise<TrackerTask> {
  const ref = await findRef(nodeId);
  if (!ref) throw new Error("not linked");
  const task = await getTracker().createTask(ref.externalId, input);
  await refreshTasks(nodeId);
  return task;
}
