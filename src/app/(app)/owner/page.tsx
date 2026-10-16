import { connection } from "next/server";

import { OwnerAnswerForm } from "@/components/owner/owner-answer-form";
import { getDb } from "@/db/client";
import { listOwnerDecisions } from "@/lib/devloop/owner-inbox";

export default async function OwnerPage() {
  await connection();
  const decisions = await listOwnerDecisions(getDb());

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 text-zinc-900 sm:p-6 dark:text-zinc-100">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Owner 判断</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          答えを待っている判断: {decisions.length} 件
        </p>
      </div>

      {decisions.length === 0 ? (
        <p className="rounded border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          答えを待っている判断はありません
        </p>
      ) : (
        <ul className="space-y-4">
          {decisions.map((decision) => (
            <li
              key={decision.itemId}
              className="space-y-3 rounded border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="space-y-1">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {decision.nodeTitle}
                </p>
                <h2 className="text-base font-semibold break-words">
                  {decision.name}
                </h2>
                {decision.url && (
                  <a
                    href={decision.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm underline"
                  >
                    Asana で開く
                  </a>
                )}
              </div>
              <OwnerAnswerForm
                nodeId={decision.nodeId}
                itemId={decision.itemId}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
