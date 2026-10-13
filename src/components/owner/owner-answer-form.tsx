"use client";

import { useState, useTransition, type FormEvent } from "react";

import { answerOwnerDecision } from "@/app/(app)/devloop/actions";

const inputClass =
  "w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const buttonClass =
  "rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function OwnerAnswerForm({
  nodeId,
  itemId,
}: {
  nodeId: string;
  itemId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputId = `owner-answer-${itemId}`;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = text.trim();
    if (pending || body === "") return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await answerOwnerDecision(nodeId, itemId, body);
        setNotice("送りました");
        setText("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "失敗しました");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium">
        回答
      </label>
      <textarea
        id={inputId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={5000}
        disabled={pending}
        className={inputClass}
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || text.trim() === ""}
          className={buttonClass}
        >
          {pending ? "送信中..." : "答える"}
        </button>
        {notice && (
          <p role="status" className="text-sm text-green-700 dark:text-green-400">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
