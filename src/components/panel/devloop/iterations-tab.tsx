"use client";

import type { DevloopStory, DevloopViewData } from "./types";

function isStory(value: unknown): value is DevloopStory {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.status === "string"
  );
}

export function IterationsTab({
  iterations,
}: {
  iterations: DevloopViewData["iterations"];
}) {
  if (iterations.length === 0) {
    return (
      <p className="text-sm text-zinc-400">イテレーションはまだありません</p>
    );
  }

  const sorted = [...iterations].sort((a, b) => b.number - a.number);

  return (
    <ul className="space-y-4">
      {sorted.map((it) => {
        const stories = it.stories.filter(isStory);
        return (
          <li
            key={it.number}
            className="space-y-1 rounded border border-zinc-800 p-3 text-sm"
          >
            <p className="font-semibold">
              #{it.number} {it.goal}
            </p>
            <p className="text-xs text-zinc-400">
              フェーズ: {it.phase} / 結果: {it.result ?? "未確定"}
              {it.prUrl && (
                <>
                  {" / "}
                  <a
                    href={it.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-300 underline"
                  >
                    PR
                  </a>
                </>
              )}
            </p>
            {stories.length > 0 && (
              <ul className="space-y-0.5 pt-1 text-xs">
                {stories.map((s) => (
                  <li key={s.id}>
                    <span className="text-zinc-400">{s.id}</span> {s.title}{" "}
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                      {s.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
