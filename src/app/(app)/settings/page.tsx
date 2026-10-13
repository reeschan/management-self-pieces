import Link from "next/link";
import { connection } from "next/server";

import { IpSection } from "@/components/settings/ip-section";
import { TokenSection } from "@/components/settings/token-section";
import { getDb } from "@/db/client";
import { runtimeMode } from "@/lib/env";
import { listAudit } from "@/lib/mcp/audit";
import { listAllowlist } from "@/lib/mcp/ip-allowlist";
import { listTokens } from "@/lib/mcp/tokens";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await connection();
  const onlyRejected = (await searchParams).rejected === "1";
  const db = getDb();
  const mode = runtimeMode();
  const [tokens, allowlist, audit] = await Promise.all([
    listTokens(db),
    listAllowlist(db),
    listAudit(db, { onlyRejected, limit: 100 }),
  ]);
  const tokenNames = new Map(tokens.map((token) => [token.id, token.name]));
  const now = new Date().getTime();
  const cellClass = "px-3 py-2 align-top";

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 p-4 text-zinc-900 sm:p-6 dark:text-zinc-100">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">設定</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          動作モード: {mode === "local" ? "ローカル (local)" : "ホスト (host)"}
        </p>
        {mode === "local" && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            ローカルで動いているので、MCP の口はトークンと IP 許可リストを使わない
          </p>
        )}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">日時は日本時間で表示します。</p>
      </div>

      <section aria-labelledby="tokens-heading" className="space-y-4">
        <h2 id="tokens-heading" className="text-lg font-semibold">エージェント用トークン</h2>
        <TokenSection tokens={tokens} now={now} />
      </section>

      <section aria-labelledby="ip-heading" className="space-y-4">
        <h2 id="ip-heading" className="text-lg font-semibold">IP 許可リスト</h2>
        <IpSection entries={allowlist} />
      </section>

      <section aria-labelledby="audit-heading" className="space-y-4">
        <h2 id="audit-heading" className="text-lg font-semibold">監査ログ</h2>
        <nav aria-label="監査ログの絞り込み" className="flex gap-2 text-sm">
          <Link href="/settings" aria-current={!onlyRejected ? "page" : undefined} className={!onlyRejected ? "font-semibold underline" : "hover:underline"}>
            すべて
          </Link>
          <span aria-hidden="true">/</span>
          <Link href="/settings?rejected=1" aria-current={onlyRejected ? "page" : undefined} className={onlyRejected ? "font-semibold underline" : "hover:underline"}>
            拒否だけ
          </Link>
        </nav>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">新しい順に最大 100 件を表示します。</p>
        <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="whitespace-nowrap bg-zinc-100 dark:bg-zinc-900">
              <tr>
                {["時刻", "モード", "トークン名", "IP", "ツール", "結果", "理由", "所要時間", "引数の要約"].map((heading) => (
                  <th key={heading} scope="col" className={cellClass}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {audit.map((entry) => (
                <tr key={entry.id}>
                  <td className={`${cellClass} whitespace-nowrap`}>
                    <time dateTime={entry.createdAt.toISOString()}>
                      {entry.createdAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                    </time>
                  </td>
                  <td className={cellClass}>{entry.mode === "local" ? "ローカル" : "ホスト"}</td>
                  <td className={cellClass}>{entry.tokenId ? tokenNames.get(entry.tokenId) ?? "-" : "-"}</td>
                  <td className={cellClass}>{entry.ip ?? "-"}</td>
                  <td className={cellClass}>{entry.tool ?? "-"}</td>
                  <td className={`${cellClass} whitespace-nowrap`}>
                    {entry.outcome === "ok" ? "成功" : entry.outcome === "rejected" ? "拒否" : entry.outcome === "tool_error" ? "ツールエラー" : entry.outcome}
                  </td>
                  <td className={`${cellClass} break-words`}>{entry.reason ?? "-"}</td>
                  <td className={`${cellClass} whitespace-nowrap`}>{entry.durationMs === null ? "-" : `${entry.durationMs} ms`}</td>
                  <td className={`${cellClass} min-w-48 break-all whitespace-pre-wrap`}>{entry.argsSummary ?? "-"}</td>
                </tr>
              ))}
              {audit.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">該当する監査ログはありません。</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
