"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";

import {
  exportNodesAction,
  importNodesAction,
  previewImportAction,
} from "@/app/(app)/settings/node-transfer-actions";
import type { ImportPreview } from "@/lib/nodes/transfer";

const buttonClass = "rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

/** ダウンロードのファイル名 (nodes-YYYYMMDD.json、日本時間) */
function downloadFileName(now: Date): string {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `nodes-${key.replaceAll("-", "")}.json`;
}

export function NodeTransferSection() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function run(action: () => Promise<void>) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await action();
      } catch {
        setError("通信に失敗しました");
      }
    });
  }

  function handleExport() {
    if (pending) return;
    run(async () => {
      const result = await exportNodesAction();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const url = URL.createObjectURL(new Blob([result.value], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadFileName(new Date());
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`${link.download} を書き出しました。`);
    });
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPreview(null);
    setText(null);
    setFileName(null);
    setError(null);
    setNotice(null);
    if (file === null) return;
    const content = await file.text();
    setText(content);
    setFileName(file.name);
    startTransition(async () => {
      try {
        setPreview(await previewImportAction(content));
      } catch {
        setError("通信に失敗しました");
      }
    });
  }

  function handleImport() {
    if (pending || text === null || preview === null || !preview.ok) return;
    run(async () => {
      const result = await importNodesAction(text);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNotice(`追加 ${result.value.added} 件・更新 ${result.value.updated} 件を読み込みました。`);
      setPreview(null);
      setText(null);
      setFileName(null);
      if (fileInputRef.current !== null) fileInputRef.current.value = "";
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-sm font-medium">書き出す</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          すべての Node と関係を 1 つの JSON ファイルとして保存します。
        </p>
        <button type="button" disabled={pending} className={buttonClass} onClick={handleExport}>
          書き出す
        </button>
      </div>
      <div className="space-y-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-sm font-medium">読み込む</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          JSON を選ぶと、読み込む前に何が変わるかを確認できます。JSON に無い Node は消えません。
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          disabled={pending}
          onChange={handleFileChange}
          className="block text-sm"
        />
        {fileName !== null && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">選択中: {fileName}</p>
        )}
        {preview !== null && preview.ok && (
          <div className="space-y-2">
            <p className="text-sm">追加 {preview.added} 件・更新 {preview.updated} 件</p>
            <button type="button" disabled={pending} className={buttonClass} onClick={handleImport}>
              この内容で読み込む
            </button>
          </div>
        )}
        {preview !== null && !preview.ok && (
          <div className="space-y-2 rounded border border-red-300 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950">
            <p className="font-medium">読み込めません</p>
            <ul className="list-disc space-y-1 pl-5">
              {preview.errors.map((message, index) => (
                <li key={index} className="break-all">{message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {pending && <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">処理中...</p>}
      {notice && <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
