"use client";

import { useState, useTransition, type FormEvent } from "react";

import { setDailyLimit, setGlobalStop } from "@/app/(app)/devloop/actions";
import type { GlobalStop } from "@/lib/devloop/control";

const inputClass = "w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const buttonClass = "rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";
const dangerButtonClass = "rounded border border-red-600 bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50 dark:border-red-500 dark:bg-red-700 dark:hover:bg-red-600";

const LIMIT_MIN = 1;
const LIMIT_MAX = 20;

export function DevloopSection({
  globalStop,
  dailyLimit,
}: {
  globalStop: GlobalStop;
  dailyLimit: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [limitText, setLimitText] = useState(String(dailyLimit));

  const limitValue = Number(limitText);
  const limitValid =
    limitText.trim() !== "" &&
    Number.isInteger(limitValue) &&
    limitValue >= LIMIT_MIN &&
    limitValue <= LIMIT_MAX;

  function run(action: () => Promise<void>) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : "失敗しました");
      }
    });
  }

  function submitStop(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    run(async () => {
      await setGlobalStop(true, reason.trim() === "" ? null : reason.trim());
      setReason("");
      setNotice("すべての Node の devloop を止めました。");
    });
  }

  function submitLimit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || !limitValid) return;
    run(async () => {
      await setDailyLimit(limitValue);
      setNotice(`1 日の上限を ${limitValue} 回にしました。`);
    });
  }

  return (
    <div className="space-y-4">
      {globalStop.on ? (
        <div role="alert" className="space-y-3 rounded border border-red-600 bg-red-50 p-4 text-sm text-red-900 dark:border-red-500 dark:bg-red-950 dark:text-red-100">
          <p className="font-semibold">すべての Node の devloop が止まっている</p>
          <p>理由: {globalStop.reason ?? "(理由なし)"}</p>
          <button
            type="button"
            disabled={pending}
            className={buttonClass}
            onClick={() => run(async () => {
              await setGlobalStop(false, null);
              setNotice("全体停止を解きました。");
            })}
          >
            再開する
          </button>
        </div>
      ) : (
        <form onSubmit={submitStop}>
          <fieldset disabled={pending} className="space-y-3 rounded border border-zinc-200 p-4 disabled:opacity-60 dark:border-zinc-800">
            <legend className="px-1 text-sm font-medium">全体停止</legend>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              すべての Node の devloop をまとめて止めます。いまは止めていません。
            </p>
            <label className="block space-y-1 text-sm">
              <span>理由 (省略できます)</span>
              <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
            </label>
            <button type="submit" disabled={pending} className={dangerButtonClass}>全体を止める</button>
          </fieldset>
        </form>
      )}
      <form onSubmit={submitLimit}>
        <fieldset disabled={pending} className="space-y-3 rounded border border-zinc-200 p-4 disabled:opacity-60 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium">1 日あたりの上限</legend>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            全 Node を合わせて、1 日 (日本時間) に回すイテレーションの上限です。現在: {dailyLimit} 回
          </p>
          <label className="block space-y-1 text-sm">
            <span>上限 ({LIMIT_MIN}〜{LIMIT_MAX})</span>
            <input
              type="number"
              required
              min={LIMIT_MIN}
              max={LIMIT_MAX}
              step={1}
              value={limitText}
              onChange={(e) => setLimitText(e.target.value)}
              className={inputClass}
            />
          </label>
          <button type="submit" disabled={pending || !limitValid} className={buttonClass}>保存</button>
        </fieldset>
      </form>
      {pending && <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">処理中...</p>}
      {notice && <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
