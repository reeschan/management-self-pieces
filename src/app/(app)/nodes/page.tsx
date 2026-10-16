import Link from "next/link";
import { connection } from "next/server";

import { getDb } from "@/db/client";
import { nodes } from "@/db/schema";
import { getNodeService } from "@/lib/nodes/server";

export default async function NodesPage() {
  // DB と GitHub を読むのでリクエスト時に動かす
  await connection();
  const [nodeRows, candidates] = await Promise.all([
    getDb()
      .select({
        id: nodes.id,
        title: nodes.title,
        kind: nodes.kind,
        status: nodes.status,
        sourceRepo: nodes.sourceRepo,
        repoReachable: nodes.repoReachable,
      })
      .from(nodes)
      .orderBy(nodes.id),
    // GitHub の設定が無い・読めないときは null にして、候補の表の代わりに案内を出す
    getNodeService()
      .listCandidates()
      .catch(() => null),
  ]);
  const cellClass = "px-3 py-2 align-top";

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 p-4 text-zinc-900 sm:p-6 dark:text-zinc-100">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Node</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          登録済みの Node と、まだ Node になっていないリポジトリ (Node の候補) を並べています。
        </p>
        <p>
          <Link
            href="/nodes/new"
            className="inline-block rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            リポジトリ無しで作る
          </Link>
        </p>
      </div>

      <section aria-labelledby="registered-heading" className="space-y-4">
        <h2 id="registered-heading" className="text-lg font-semibold">
          登録済みの Node
        </h2>
        <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="whitespace-nowrap bg-zinc-100 dark:bg-zinc-900">
              <tr>
                {["ID", "タイトル", "種類", "状態", "リポジトリ", "編集"].map((heading) => (
                  <th key={heading} scope="col" className={cellClass}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {nodeRows.map((row) => (
                <tr key={row.id}>
                  <td className={`${cellClass} whitespace-nowrap font-mono`}>{row.id}</td>
                  <td className={cellClass}>{row.title}</td>
                  <td className={`${cellClass} whitespace-nowrap`}>{row.kind}</td>
                  <td className={`${cellClass} whitespace-nowrap`}>{row.status}</td>
                  <td className={cellClass}>
                    {row.sourceRepo ?? "なし"}
                    {!row.repoReachable && (
                      <span className="ml-2 whitespace-nowrap rounded bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white">
                        届かない
                      </span>
                    )}
                  </td>
                  <td className={`${cellClass} whitespace-nowrap`}>
                    <Link
                      href={`/nodes/${row.id}/edit`}
                      className="underline hover:no-underline"
                    >
                      編集
                    </Link>
                  </td>
                </tr>
              ))}
              {nodeRows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400"
                  >
                    Node はまだありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="candidates-heading" className="space-y-4">
        <h2 id="candidates-heading" className="text-lg font-semibold">
          Node の候補
        </h2>
        {candidates === null ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            GitHub から候補を読めませんでした。
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="whitespace-nowrap bg-zinc-100 dark:bg-zinc-900">
                <tr>
                  {["リポジトリ", "説明", "登録"].map((heading) => (
                    <th key={heading} scope="col" className={cellClass}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {candidates.map((repo) => (
                  <tr key={repo.id}>
                    <td className={`${cellClass} break-all`}>{repo.fullName}</td>
                    <td className={cellClass}>{repo.description ?? "-"}</td>
                    <td className={`${cellClass} whitespace-nowrap`}>
                      <Link
                        href={`/nodes/new?repo=${encodeURIComponent(repo.fullName)}`}
                        className="underline hover:no-underline"
                      >
                        登録する
                      </Link>
                    </td>
                  </tr>
                ))}
                {candidates.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400"
                    >
                      登録できる候補はありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
