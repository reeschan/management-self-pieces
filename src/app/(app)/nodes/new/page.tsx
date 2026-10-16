import Link from "next/link";
import { connection } from "next/server";

import { NodeForm } from "@/components/nodes/node-form";
import { getDb } from "@/db/client";
import { nodes } from "@/db/schema";
import type { NodeCreateInput } from "@/lib/nodes/input";
import { getNodeService } from "@/lib/nodes/server";

/** リポジトリ無しで作るときの初期値 */
function emptyInitial(): NodeCreateInput {
  return {
    id: "",
    kind: "app",
    title: "",
    summary: "",
    status: "active",
    tags: [],
    links: {},
    meta: {},
    detailPath: null,
    diagrams: [],
    relations: [],
    repo: null,
  };
}

export default async function NewNodePage({ searchParams }: PageProps<"/nodes/new">) {
  // DB と GitHub を読むのでリクエスト時に動かす
  await connection();
  const params = await searchParams;
  const repo = typeof params.repo === "string" ? params.repo : undefined;

  let initial = emptyInitial();
  let warning: string | null = null;
  if (repo !== undefined) {
    try {
      initial = await getNodeService().draftFromRepo(repo);
    } catch {
      warning = "リポジトリの情報を読めませんでした";
    }
  }

  const targets = await getDb()
    .select({ id: nodes.id, title: nodes.title })
    .from(nodes)
    .orderBy(nodes.id);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 text-zinc-900 sm:p-6 dark:text-zinc-100">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Node を登録</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          候補のリポジトリから、またはリポジトリ無しで Node を登録します。
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
      {warning !== null && (
        <p
          role="alert"
          className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        >
          {warning}
        </p>
      )}
      <NodeForm mode="create" initial={initial} targets={targets} />
    </div>
  );
}
