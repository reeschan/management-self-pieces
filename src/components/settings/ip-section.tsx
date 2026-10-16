"use client";

import { useState, useTransition, type FormEvent } from "react";

import { addIpAllowlist, allowCurrentIp, removeIpAllowlist } from "@/app/(app)/settings/actions";
import type { ActionResult } from "@/lib/action-result";
import type { listAllowlist } from "@/lib/mcp/ip-allowlist";

const inputClass = "w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const buttonClass = "rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function IpSection({ entries }: { entries: Awaited<ReturnType<typeof listAllowlist>> }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cidr, setCidr] = useState("");
  const [label, setLabel] = useState("");
  const [currentLabel, setCurrentLabel] = useState("今の IP");

  function run<T>(action: () => Promise<ActionResult<T>>, onSuccess: (value: T) => void) {
    setError(null);
    setNotice(null);
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
    if (pending || cidr.trim() === "" || label.trim() === "") return;
    run(() => addIpAllowlist({ cidr: cidr.trim(), label: label.trim() }), (added) => {
      setNotice(`${added} を許可しました。`);
      setCidr("");
      setLabel("");
    });
  }

  function submitCurrentIp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || currentLabel.trim() === "") return;
    run(() => allowCurrentIp(currentLabel.trim()), (added) => {
      setNotice(`${added} を許可しました。`);
    });
  }

  return (
    <div className="space-y-4">
      {entries.length === 0 && (
        <p className="rounded border border-amber-400 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
          空のあいだ、ホストの MCP の口はすべての呼び出しを拒否する
        </p>
      )}
      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="whitespace-nowrap bg-zinc-100 dark:bg-zinc-900">
            <tr>
              {["CIDR", "名前", "登録日時", "操作"].map((heading) => (
                <th key={heading} scope="col" className="px-3 py-2">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="px-3 py-2 font-mono">{entry.cidr}</td>
                <td className="px-3 py-2">{entry.label}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <time dateTime={entry.createdAt.toISOString()}>{entry.createdAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</time>
                </td>
                <td className="px-3 py-2">
                  <button type="button" disabled={pending} className={buttonClass} aria-label={`${entry.cidr} を削除`} onClick={() => run(() => removeIpAllowlist(entry.id), () => {
                    setNotice(`${entry.cidr} を削除しました。`);
                  })}>
                    削除
                  </button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">許可された IP はありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <form onSubmit={submit}>
        <fieldset disabled={pending} className="space-y-3 rounded border border-zinc-200 p-4 disabled:opacity-60 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium">IP を追加</legend>
          <label className="block space-y-1 text-sm">
            <span>CIDR</span>
            <input required value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="例: 203.0.113.10/32" className={inputClass} />
          </label>
          <label className="block space-y-1 text-sm">
            <span>名前</span>
            <input required maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
          </label>
          <button type="submit" disabled={pending || cidr.trim() === "" || label.trim() === ""} className={buttonClass}>追加</button>
        </fieldset>
      </form>
      <form onSubmit={submitCurrentIp}>
        <fieldset disabled={pending} className="space-y-3 rounded border border-zinc-200 p-4 disabled:opacity-60 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium">今の IP</legend>
          <label className="block space-y-1 text-sm">
            <span>名前</span>
            <input required maxLength={60} value={currentLabel} onChange={(e) => setCurrentLabel(e.target.value)} className={inputClass} />
          </label>
          <button type="submit" disabled={pending || currentLabel.trim() === ""} className={buttonClass}>今の IP を許可</button>
        </fieldset>
      </form>
      {pending && <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">処理中...</p>}
      {notice && <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
