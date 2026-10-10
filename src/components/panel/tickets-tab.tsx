"use client";

import { useState, useTransition, type FormEvent } from "react";

import {
  createTask,
  linkAsanaProject,
  refreshNodeTasks,
} from "@/app/(app)/actions";

export type PanelTask = {
  externalId: string;
  name: string;
  completed: boolean;
  dueOn: string | null;
  url: string | null;
};

type Props = {
  nodeId: string;
  asana: { projectId: string; url: string | null } | null;
  tasks: PanelTask[];
  onChanged: () => void;
};

export function TicketsTab({ nodeId, asana, tasks, onChanged }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [dueOn, setDueOn] = useState("");

  function run(action: () => Promise<unknown>, onSuccess?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        onSuccess?.();
        onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : "失敗しました");
      }
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return;
    run(
      () =>
        createTask(nodeId, {
          name: trimmed,
          ...(dueOn !== "" ? { dueOn } : {}),
        }),
      () => {
        setName("");
        setDueOn("");
      },
    );
  }

  const errorView = error && (
    <p role="alert" className="text-sm text-red-400">
      {error}
    </p>
  );

  if (asana === null) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-zinc-400">
          Asana プロジェクトはまだつながっていません
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => linkAsanaProject(nodeId))}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {pending ? "処理中..." : "Asana プロジェクトを作成してつなぐ"}
        </button>
        {errorView}
      </div>
    );
  }

  const open = tasks.filter((t) => !t.completed).length;
  const done = tasks.length - open;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 text-sm">
        {asana.url ? (
          <a
            href={asana.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-300 underline"
          >
            Asana のプロジェクトを開く
          </a>
        ) : (
          <span className="text-zinc-400">Asana: {asana.projectId}</span>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => refreshNodeTasks(nodeId))}
          className="rounded border border-zinc-600 px-2 py-1 text-xs disabled:opacity-50"
        >
          取り直す
        </button>
      </div>
      <p className="text-xs text-zinc-400">
        未完了 {open} 件 / 完了済み {done} 件
      </p>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.externalId} className="text-sm">
            <span className={t.completed ? "text-zinc-500 line-through" : ""}>
              {t.name}
            </span>
            {t.dueOn && (
              <span className="ml-2 text-xs text-zinc-400">
                期限 {t.dueOn}
              </span>
            )}
            {t.url && (
              <a
                href={t.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-xs text-indigo-300 underline"
              >
                Asana
              </a>
            )}
          </li>
        ))}
      </ul>
      <form
        onSubmit={submit}
        className="space-y-2 border-t border-zinc-800 pt-3"
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新しいタスクの名前"
          maxLength={200}
          aria-label="タスク名"
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
        />
        <div className="flex gap-2">
          <input
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            aria-label="期限"
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={pending || name.trim() === ""}
            className="rounded bg-indigo-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            タスクを作る
          </button>
        </div>
      </form>
      {errorView}
    </div>
  );
}
