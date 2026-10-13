import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { externalRefs, nodes, taskCache } from "@/db/schema";
import { createRepoSource } from "@/lib/github/app";
import { assetKindOf, isGithubSource, type AssetKind } from "./asset";

export type NodeDetail = {
  node: {
    id: string;
    kind: string;
    title: string;
    summary: string;
    status: string;
    tags: string[];
    links: Record<string, string>;
    sourceRepo: string | null;
    updatedAt: Date;
  };
  detail: { path: string; markdown: string | null };
  diagrams: {
    path: string;
    title: string | null;
    kind: AssetKind;
    url: string;
  }[];
  asana: { projectId: string; url: string | null } | null;
  tasks: {
    externalId: string;
    name: string;
    completed: boolean;
    dueOn: string | null;
    url: string | null;
  }[];
};

export function assetUrl(id: string, path: string): string {
  return `/api/nodes/${encodeURIComponent(id)}/asset?path=${encodeURIComponent(path)}`;
}

/** 詳細の Markdown を default branch から読む。読めなければ null (例外は外に出さない) */
async function readMarkdown(
  sourceRepo: string,
  path: string,
): Promise<string | null> {
  if (!isGithubSource(sourceRepo)) return null;
  try {
    const source = createRepoSource();
    const repo = await source.getRepo(sourceRepo);
    if (repo === null) return null;
    const file = await source.getFile(sourceRepo, path, repo.defaultBranch);
    return file?.content ?? null;
  } catch (error) {
    console.error("[nodes:detail] failed to read markdown", error);
    return null;
  }
}

type TaskItem = NodeDetail["tasks"][number];

/** 未完了を先に、その中は dueOn の早い順 (null は後) */
function compareTasks(a: TaskItem, b: TaskItem): number {
  if (a.completed !== b.completed) return a.completed ? 1 : -1;
  if (a.dueOn === b.dueOn) return 0;
  if (a.dueOn === null) return 1;
  if (b.dueOn === null) return -1;
  return a.dueOn < b.dueOn ? -1 : 1;
}

export async function loadNodeDetail(id: string): Promise<NodeDetail | null> {
  const db = getDb();
  const [row] = await db.select().from(nodes).where(eq(nodes.id, id)).limit(1);
  if (!row) return null;

  const [refRows, taskRows, markdown] = await Promise.all([
    db
      .select({ externalId: externalRefs.externalId, url: externalRefs.url })
      .from(externalRefs)
      .where(
        and(eq(externalRefs.nodeId, id), eq(externalRefs.provider, "asana")),
      )
      .limit(1),
    db
      .select({
        externalId: taskCache.externalId,
        name: taskCache.name,
        completed: taskCache.completed,
        dueOn: taskCache.dueOn,
        url: taskCache.url,
      })
      .from(taskCache)
      .where(eq(taskCache.nodeId, id)),
    readMarkdown(row.sourceRepo, row.detailPath),
  ]);

  const diagrams: NodeDetail["diagrams"] = [];
  for (const d of row.diagrams) {
    const kind = assetKindOf(d.path);
    if (kind === null) continue;
    diagrams.push({
      path: d.path,
      title: d.title ?? null,
      kind,
      url: assetUrl(row.id, d.path),
    });
  }

  const ref = refRows[0];
  return {
    node: {
      id: row.id,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      status: row.status,
      tags: row.tags,
      links: row.links,
      sourceRepo: row.sourceRepo,
      updatedAt: row.updatedAt,
    },
    detail: { path: row.detailPath, markdown },
    diagrams,
    asana: ref ? { projectId: ref.externalId, url: ref.url } : null,
    tasks: [...taskRows].sort(compareTasks),
  };
}
