"use client";

import { useState, useTransition } from "react";

import { prepareBoard } from "@/app/(app)/devloop/actions";

import type { DevloopViewData } from "./types";

type Props = {
  nodeId: string;
  view: DevloopViewData;
  onChanged: () => void;
};

export function BoardTab({ nodeId, view, onChanged }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function prepare() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await prepareBoard(nodeId);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        onChanged();
      } catch {
        setError("通信に失敗しました");
      }
    });
  }

  const errorView = error && (
    <p role="alert" className="text-sm text-red-400">
      {error}
    </p>
  );

  if (!view.linked) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-zinc-400">
          看板 (Asana のプロジェクト) はまだ用意されていません
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={prepare}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {pending ? "処理中..." : "看板を用意する"}
        </button>
        {errorView}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 text-sm">
        {view.asanaUrl ? (
          <a
            href={view.asanaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-300 underline"
          >
            Asana のプロジェクトを開く
          </a>
        ) : (
          <span className="text-zinc-400">Asana につながっています</span>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={prepare}
          className="rounded border border-zinc-600 px-2 py-1 text-xs disabled:opacity-50"
        >
          {pending ? "処理中..." : "列を整える"}
        </button>
      </div>
      {errorView}
      <div className="space-y-4">
        {view.columns.map((column) => (
          <section key={column.section} aria-label={column.section}>
            <h3 className="border-b border-zinc-800 pb-1 text-xs font-semibold text-zinc-300">
              {column.section}{" "}
              <span className="font-normal text-zinc-500">
                ({column.items.length})
              </span>
            </h3>
            {column.items.length === 0 ? (
              <p className="pt-1 text-xs text-zinc-500">項目はありません</p>
            ) : (
              <ul className="space-y-2 pt-2">
                {column.items.map((item) => (
                  <li key={item.id} className="text-sm">
                    <span
                      className={
                        item.completed ? "text-zinc-500 line-through" : ""
                      }
                    >
                      {item.name}
                    </span>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-xs text-indigo-300 underline"
                      >
                        Asana
                      </a>
                    )}
                    {item.tags.length > 0 && (
                      <ul className="mt-1 flex flex-wrap gap-1">
                        {item.tags.map((t) => (
                          <li
                            key={t}
                            className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300"
                          >
                            {t}
                          </li>
                        ))}
                      </ul>
                    )}
                    {item.meta &&
                      (item.meta.value !== undefined ||
                        item.meta.effort !== undefined) && (
                        <p className="mt-1 text-xs text-zinc-400">
                          {item.meta.value !== undefined &&
                            `価値 ${item.meta.value}`}
                          {item.meta.value !== undefined &&
                            item.meta.effort !== undefined &&
                            " / "}
                          {item.meta.effort !== undefined &&
                            `工数 ${item.meta.effort}`}
                        </p>
                      )}
                    {item.metaError && (
                      <p className="mt-1 text-xs text-amber-300">
                        meta を読めません ({item.metaError})
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
