import { eq, ne } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { NodeForm } from "@/components/nodes/node-form";
import { getDb } from "@/db/client";
import { nodes, relations } from "@/db/schema";
import type { KindId } from "@/lib/manifest/kinds";
import type { NodeCreateInput } from "@/lib/nodes/input";
import { getNodeService } from "@/lib/nodes/server";

export default async function EditNodePage({ params }: PageProps<"/nodes/[id]/edit">) {
  // DB と GitHub を読むのでリクエスト時に動かす
  await connection();
  const { id } = await params;
  const db = getDb();
  const [rows, edgeRows] = await Promise.all([
    db.select().from(nodes).where(eq(nodes.id, id)).limit(1),
    db
      .select({ type: relations.type, to: relations.toId })
      .from(relations)
      .where(eq(relations.fromId, id)),
  ]);
  const node = rows[0];
  if (node === undefined) notFound();

  const [targets, deletionBlockers] = await Promise.all([
    db
      .select({ id: nodes.id, title: nodes.title })
      .from(nodes)
      .where(ne(nodes.id, id))
      .orderBy(nodes.id),
    getNodeService().deletionBlockers(id),
  ]);

  const initial: NodeCreateInput = {
    id: node.id,
    kind: node.kind as KindId,
    title: node.title,
    summary: node.summary,
    status: node.status as NodeCreateInput["status"],
    tags: node.tags,
    links: node.links,
    meta: node.meta,
    detailPath: node.detailPath,
    diagrams: node.diagrams,
    relations: edgeRows.map((row) => ({
      type: row.type as NodeCreateInput["relations"][number]["type"],
      to: row.to,
    })),
    repo: node.sourceRepo === null ? null : { id: node.repoId, fullName: node.sourceRepo },
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 text-zinc-900 sm:p-6 dark:text-zinc-100">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Node を編集</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-mono">{node.id}</span> を直します。
        </p>
        <p>
          <Link
            href="/nodes"
            className="inline-block rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            一覧に戻る
          </Link>
        </p>
      </div>
      <NodeForm
        mode="edit"
        initial={initial}
        targets={targets}
        deletionBlockers={deletionBlockers}
      />
    </div>
  );
}
