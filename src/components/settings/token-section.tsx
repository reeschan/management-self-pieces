"use client";

import { useState, useTransition, type FormEvent } from "react";

import { issueAgentToken, revokeAgentToken } from "@/app/(app)/settings/actions";
import type { ActionResult } from "@/lib/action-result";
import type { listTokens, Scope } from "@/lib/mcp/tokens";

type Props = {
  tokens: Awaited<ReturnType<typeof listTokens>>;
  now: number;
};

const scopes: Scope[] = ["read", "board", "loop"];
const inputClass = "w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const buttonClass = "rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

function dateLabel(date: Date | null) {
  return date?.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) ?? "-";
}

export function TokenSection({ tokens, now }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<Scope[]>(["read"]);
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [issued, setIssued] = useState<{ id: string; raw: string } | null>(null);
  const [command, setCommand] = useState("");
  const [copied, setCopied] = useState(false);

  function run<T>(action: () => Promise<ActionResult<T>>, onSuccess: (value: T) => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.message);
          return;
        }
        onSuccess(result.value);
      } catch {
        setError("通信に失敗しました");
      }
    });
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || issued || name.trim() === "" || selectedScopes.length === 0) return;
    run(() => issueAgentToken({
      name: name.trim(),
      scopes: selectedScopes,
      expiresInDays: expiresInDays === "none" ? null : Number(expiresInDays),
    }), (value) => {
      setIssued(value);
      setCopied(false);
      setCommand(`claude mcp add --scope user --transport http pieces ${window.location.origin}/api/mcp --header 'Authorization: Bearer \${PIECES_AGENT_TOKEN}'`);
      setName("");
    });
  }

  async function copyToken() {
    if (!issued) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(issued.raw);
      setCopied(true);
    } catch {
      setError("コピーできませんでした。トークンの欄を選択してコピーしてください。");
    }
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="whitespace-nowrap bg-zinc-100 dark:bg-zinc-900">
            <tr>
              {["名前", "権限", "期限", "最終使用", "状態", "操作"].map((heading) => (
                <th key={heading} scope="col" className="px-3 py-2">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {tokens.map((token) => {
              const status = token.revokedAt !== null ? "失効" : token.expiresAt !== null && token.expiresAt.getTime() <= now ? "期限切れ" : "有効";
              return (
                <tr key={token.id}>
                  <td className="px-3 py-2">{token.name}</td>
                  <td className="px-3 py-2">{token.scopes.join(" / ")}</td>
                  <td className="whitespace-nowrap px-3 py-2">{token.expiresAt === null ? "なし" : dateLabel(token.expiresAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{dateLabel(token.lastUsedAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{status}</td>
                  <td className="px-3 py-2">
                    {status === "有効" && (
                      <button
                        type="button"
                        disabled={pending}
                        className={buttonClass}
                        aria-label={`${token.name} を失効`}
                        onClick={() => {
                          if (!window.confirm(`「${token.name}」を失効させますか？このトークンは使えなくなります。`)) return;
                          run(() => revokeAgentToken(token.id), () => {
                            if (issued?.id === token.id) setIssued(null);
                          });
                        }}
                      >
                        失効
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {tokens.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">トークンはまだありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {issued && (
        <div className="space-y-3 rounded border border-amber-400 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
          <p role="status" className="font-medium">発行しました。この値は二度と表示されないので、閉じる前にコピーしてください。</p>
          <label className="block space-y-1 text-sm">
            <span>発行したトークン</span>
            <input readOnly value={issued.raw} autoComplete="off" spellCheck={false} onFocus={(e) => e.target.select()} className={`${inputClass} font-mono`} />
          </label>
          <div className="flex gap-2">
            <button type="button" className={buttonClass} onClick={copyToken}>{copied ? "コピーしました" : "コピー"}</button>
            <button type="button" className={buttonClass} onClick={() => { setIssued(null); setCopied(false); }}>閉じる</button>
          </div>
          <p className="text-sm">Claude Code への登録例</p>
          <p className="text-sm">環境変数 PIECES_AGENT_TOKEN にコピーした値を設定して実行してください。</p>
          <pre className="overflow-x-auto rounded bg-zinc-100 p-3 text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"><code>{command}</code></pre>
          <p className="text-sm">ヘッダーは単一引用符のまま実行する (シェルにトークンを展開させず、Claude Code が接続するときに環境変数から読む)。登録後に <code>claude mcp get pieces</code> で <code>{"${PIECES_AGENT_TOKEN}"}</code> のまま保存されていることを確かめる。</p>
        </div>
      )}

      <form onSubmit={submit}>
        <fieldset disabled={pending || issued !== null} className="space-y-3 rounded border border-zinc-200 p-4 disabled:opacity-60 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium">トークンを発行</legend>
          <label className="block space-y-1 text-sm">
            <span>名前</span>
            <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </label>
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-1 text-sm">権限 (1 つ以上)</legend>
            {scopes.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedScopes.includes(scope)} onChange={(e) => setSelectedScopes((current) => e.target.checked ? [...current, scope] : current.filter((value) => value !== scope))} />
                {scope}
              </label>
            ))}
          </fieldset>
          <label className="block space-y-1 text-sm">
            <span>期限</span>
            <select value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} className={inputClass}>
              <option value="30">30 日</option>
              <option value="90">90 日</option>
              <option value="365">365 日</option>
              <option value="none">なし</option>
            </select>
          </label>
          <button type="submit" disabled={pending || issued !== null || name.trim() === "" || selectedScopes.length === 0} className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {pending ? "処理中..." : "発行"}
          </button>
        </fieldset>
      </form>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
