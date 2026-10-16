"use client";

import { useState, useTransition, type FormEvent } from "react";

import {
  pauseNode,
  resumeNode,
  updateDevloopSettings,
} from "@/app/(app)/devloop/actions";
import type { ActionResult } from "@/lib/action-result";

import { formatJst, type DevloopViewData } from "./types";

const AUTONOMY_DESCRIPTIONS = [
  "L0: plan と groom だけ行う",
  "L1: L0 より広く任せる",
  "L2: L1 よりさらに広く任せる",
  "L3: 最も広く任せる",
] as const;

type Props = {
  nodeId: string;
  view: DevloopViewData;
  onChanged: () => void;
};

type Run = (
  action: () => Promise<ActionResult<unknown>>,
  onSuccess?: () => void,
) => void;

const numberInputClass =
  "w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm";

export function LoopTab({ nodeId, view, onChanged }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run: Run = (action, onSuccess) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.message);
          return;
        }
        onSuccess?.();
        onChanged();
      } catch {
        setError("通信に失敗しました");
      }
    });
  };

  return (
    <div className="space-y-5 text-sm">
      {view.globalStop.on && (
        <div
          role="alert"
          className="rounded border border-red-600 bg-red-950/50 p-3 text-red-200"
        >
          <p className="font-semibold">全体停止中です</p>
          <p className="mt-1 text-xs">
            理由: {view.globalStop.reason ?? "(理由なし)"}
          </p>
          <p className="mt-1 text-xs">変更は設定画面で行ってください。</p>
        </div>
      )}

      <SettingsForm
        key={view.settings.updatedAt ?? "default"}
        nodeId={nodeId}
        settings={view.settings}
        pending={pending}
        run={run}
      />

      <PauseControl
        nodeId={nodeId}
        settings={view.settings}
        pending={pending}
        run={run}
      />

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <section aria-label="実行の記録" className="space-y-2">
        <h3 className="text-xs font-semibold text-zinc-300">実行の記録</h3>
        {view.runs.length === 0 ? (
          <p className="text-xs text-zinc-500">実行の記録はまだありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-left text-zinc-400">
                  <th className="border border-zinc-700 px-2 py-1">時刻</th>
                  <th className="border border-zinc-700 px-2 py-1">
                    フェーズ
                  </th>
                  <th className="border border-zinc-700 px-2 py-1">結果</th>
                  <th className="border border-zinc-700 px-2 py-1">要約</th>
                </tr>
              </thead>
              <tbody>
                {[...view.runs]
                  .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                  .map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="whitespace-nowrap border border-zinc-700 px-2 py-1">
                        {formatJst(r.startedAt)}
                      </td>
                      <td className="border border-zinc-700 px-2 py-1">
                        {r.phase}
                      </td>
                      <td className="border border-zinc-700 px-2 py-1">
                        {r.status}
                      </td>
                      <td className="border border-zinc-700 px-2 py-1">
                        {r.summary}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SettingsForm({
  nodeId,
  settings,
  pending,
  run,
}: {
  nodeId: string;
  settings: DevloopViewData["settings"];
  pending: boolean;
  run: Run;
}) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [autonomy, setAutonomy] = useState(settings.autonomy);
  const [daily, setDaily] = useState(String(settings.maxIterationsPerDay));
  const [pbis, setPbis] = useState(String(settings.maxPbisPerIteration));
  const [sprint, setSprint] = useState(String(settings.sprintLimit));

  const numbers = [daily, pbis, sprint].map((s) => Number(s));
  const valid = numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= 20);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    run(() =>
      updateDevloopSettings(nodeId, {
        enabled,
        autonomy,
        maxIterationsPerDay: numbers[0],
        maxPbisPerIteration: numbers[1],
        sprintLimit: numbers[2],
      }),
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>devloop を有効にする</span>
      </label>
      <div className="space-y-1">
        <label className="flex items-center gap-2">
          <span>自律度</span>
          <select
            value={autonomy}
            onChange={(e) => setAutonomy(Number(e.target.value))}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
          >
            {AUTONOMY_DESCRIPTIONS.map((_, level) => (
              <option key={level} value={level}>
                L{level}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-zinc-400">
          {AUTONOMY_DESCRIPTIONS[autonomy] ?? ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="space-y-1">
          <span className="block text-xs text-zinc-400">1 日の上限</span>
          <input
            type="number"
            min={1}
            max={20}
            value={daily}
            onChange={(e) => setDaily(e.target.value)}
            className={numberInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-zinc-400">1 周の PBI の上限</span>
          <input
            type="number"
            min={1}
            max={20}
            value={pbis}
            onChange={(e) => setPbis(e.target.value)}
            className={numberInputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-zinc-400">Sprint の上限</span>
          <input
            type="number"
            min={1}
            max={20}
            value={sprint}
            onChange={(e) => setSprint(e.target.value)}
            className={numberInputClass}
          />
        </label>
      </div>
      {!valid && (
        <p className="text-xs text-amber-300">
          上限は 1〜20 の整数にしてください
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !valid}
        className="rounded bg-indigo-600 px-3 py-1 text-sm text-white disabled:opacity-50"
      >
        {pending ? "処理中..." : "設定を保存"}
      </button>
    </form>
  );
}

function PauseControl({
  nodeId,
  settings,
  pending,
  run,
}: {
  nodeId: string;
  settings: DevloopViewData["settings"];
  pending: boolean;
  run: Run;
}) {
  const [reason, setReason] = useState("");

  if (settings.paused) {
    return (
      <div className="space-y-2 border-t border-zinc-800 pt-3">
        <p>一時停止中: {settings.pauseReason ?? "(理由なし)"}</p>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => resumeNode(nodeId))}
          className="rounded border border-zinc-600 px-3 py-1 text-sm disabled:opacity-50"
        >
          再開
        </button>
      </div>
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed === "") return;
    run(
      () => pauseNode(nodeId, trimmed),
      () => setReason(""),
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-zinc-800 pt-3">
      <p className="text-zinc-400">動いています</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="止める理由"
          maxLength={500}
          aria-label="一時停止の理由"
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending || reason.trim() === ""}
          className="rounded border border-zinc-600 px-3 py-1 text-sm disabled:opacity-50"
        >
          一時停止
        </button>
      </div>
    </form>
  );
}
