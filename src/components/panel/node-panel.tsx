"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { BoardTab } from "./devloop/board-tab";
import { IterationsTab } from "./devloop/iterations-tab";
import { LoopTab } from "./devloop/loop-tab";
import type { DevloopViewData } from "./devloop/types";
import { DiagramView } from "./diagram-view";
import { TicketsTab, type PanelTask } from "./tickets-tab";

type PanelDetail = {
  node: {
    id: string;
    kind: string;
    title: string;
    summary: string;
    status: string;
    tags: string[];
    links: Record<string, string>;
    sourceRepo: string | null;
    repoReachable: boolean;
    updatedAt: string;
  };
  detail: { path: string; markdown: string | null };
  diagrams: {
    path: string;
    title: string | null;
    kind: string;
    url: string;
  }[];
  asana: { projectId: string; url: string | null } | null;
  tasks: PanelTask[];
};

type Result =
  | { nodeId: string; status: "ok"; data: PanelDetail }
  | { nodeId: string; status: "notFound" }
  | { nodeId: string; status: "error"; message: string };

type DevloopResult =
  | { nodeId: string; status: "ok"; data: DevloopViewData }
  | { nodeId: string; status: "error"; message: string };

const TABS = [
  "概要",
  "詳細",
  "アーキ図",
  "チケット",
  "リンク",
  "看板",
  "開発ループ",
  "イテレーション",
] as const;
type Tab = (typeof TABS)[number];

const DEVLOOP_TABS: readonly Tab[] = ["看板", "開発ループ", "イテレーション"];

export function NodePanel({
  nodeId,
  onClose,
}: {
  nodeId: string;
  onClose: () => void;
}) {
  const [reloadCount, setReloadCount] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [tab, setTab] = useState<Tab>("概要");
  const [prevNodeId, setPrevNodeId] = useState(nodeId);
  // devloop のタブを初めて開いた Node の id (開くまでは fetch しない)
  const [devloopRequestedFor, setDevloopRequestedFor] = useState<string | null>(
    null,
  );
  const [devloopReloadCount, setDevloopReloadCount] = useState(0);
  const [devloopResult, setDevloopResult] = useState<DevloopResult | null>(
    null,
  );

  if (prevNodeId !== nodeId) {
    setPrevNodeId(nodeId);
    setTab("概要");
  }

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}`, {
          signal: controller.signal,
        });
        if (res.status === 404) {
          setResult({ nodeId, status: "notFound" });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as PanelDetail;
        if (controller.signal.aborted) return;
        setResult({ nodeId, status: "ok", data });
      } catch (error) {
        if (controller.signal.aborted) return;
        setResult({
          nodeId,
          status: "error",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
    })();
    return () => controller.abort();
  }, [nodeId, reloadCount]);

  const devloopWanted = devloopRequestedFor === nodeId;
  useEffect(() => {
    if (!devloopWanted) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/nodes/${encodeURIComponent(nodeId)}/devloop`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as DevloopViewData;
        if (controller.signal.aborted) return;
        setDevloopResult({ nodeId, status: "ok", data });
      } catch (error) {
        if (controller.signal.aborted) return;
        setDevloopResult({
          nodeId,
          status: "error",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
    })();
    return () => controller.abort();
  }, [nodeId, devloopWanted, devloopReloadCount]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reload = useCallback(() => setReloadCount((n) => n + 1), []);
  const reloadDevloop = useCallback(
    () => setDevloopReloadCount((n) => n + 1),
    [],
  );

  function selectTab(t: Tab) {
    setTab(t);
    if (DEVLOOP_TABS.includes(t)) setDevloopRequestedFor(nodeId);
  }

  // 再取得中は直前の結果を残し、別 Node に切り替わったときだけ読み込み中にする
  const current = result !== null && result.nodeId === nodeId ? result : null;
  const data = current?.status === "ok" ? current.data : null;
  const devloopCurrent =
    devloopResult !== null && devloopResult.nodeId === nodeId
      ? devloopResult
      : null;

  return (
    <div className="flex h-full w-full flex-col text-zinc-100">
      <header className="flex items-start justify-between gap-2 border-b border-zinc-800 p-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">
            {data?.node.title ?? nodeId}
          </h2>
          {data && (
            <p className="text-xs text-zinc-400">
              {data.node.kind} / {data.node.status}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="rounded px-2 py-1 text-zinc-300 hover:bg-zinc-800"
        >
          ×
        </button>
      </header>

      {current === null && (
        <p className="p-4 text-sm text-zinc-400">読み込み中...</p>
      )}
      {current?.status === "notFound" && (
        <p className="p-4 text-sm text-zinc-300">Node が見つかりません</p>
      )}
      {current?.status === "error" && (
        <p role="alert" className="p-4 text-sm text-red-400">
          読み込みに失敗しました ({current.message})
        </p>
      )}

      {data && (
        <>
          <div
            role="tablist"
            className="flex overflow-x-auto border-b border-zinc-800 text-sm"
          >
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`tab-${t}`}
                aria-selected={tab === t}
                aria-controls="node-panel-tabpanel"
                onClick={() => selectTab(t)}
                className={`flex-1 whitespace-nowrap px-2 py-2 ${
                  tab === t
                    ? "border-b-2 border-indigo-400 text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id="node-panel-tabpanel"
            aria-labelledby={`tab-${tab}`}
            className="flex-1 overflow-y-auto p-4"
          >
            <TabBody
              tab={tab}
              data={data}
              onChanged={reload}
              devloop={devloopCurrent}
              onDevloopChanged={reloadDevloop}
            />
          </div>
        </>
      )}
    </div>
  );
}

function TabBody({
  tab,
  data,
  onChanged,
  devloop,
  onDevloopChanged,
}: {
  tab: Tab;
  data: PanelDetail;
  onChanged: () => void;
  devloop: DevloopResult | null;
  onDevloopChanged: () => void;
}) {
  switch (tab) {
    case "概要":
      return (
        <div className="space-y-3 text-sm">
          <p className="whitespace-pre-wrap">{data.node.summary}</p>
          {data.node.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1">
              {data.node.tags.map((t) => (
                <li
                  key={t}
                  className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
                >
                  {t}
                </li>
              ))}
            </ul>
          )}
          <dl className="space-y-1 text-xs text-zinc-400">
            <div>
              <dt className="inline">更新日時: </dt>
              <dd className="inline">{data.node.updatedAt}</dd>
            </div>
            <div>
              <dt className="inline">リポジトリ: </dt>
              <dd className="inline">{data.node.sourceRepo ?? "なし"}</dd>
              {data.node.sourceRepo !== null && !data.node.repoReachable && (
                <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white">
                  リポジトリに届きません
                </span>
              )}
            </div>
          </dl>
          <p>
            <Link
              href={`/nodes/${encodeURIComponent(data.node.id)}/edit`}
              className="text-indigo-300 underline"
            >
              編集
            </Link>
          </p>
        </div>
      );
    case "詳細":
      if (data.node.sourceRepo === null) {
        return (
          <p className="text-sm text-zinc-400">
            リポジトリの無い Node には詳細がありません
          </p>
        );
      }
      return data.detail.markdown === null ? (
        <p className="text-sm text-zinc-400">
          詳細を読み込めませんでした ({data.detail.path})
        </p>
      ) : (
        <div className="space-y-3 text-sm leading-relaxed [&_a]:text-indigo-300 [&_a]:underline [&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:bg-zinc-900 [&_pre]:p-2 [&_table]:border-collapse [&_td]:border [&_td]:border-zinc-700 [&_td]:px-2 [&_th]:border [&_th]:border-zinc-700 [&_th]:px-2 [&_ul]:list-disc">
          <Markdown remarkPlugins={[remarkGfm]}>{data.detail.markdown}</Markdown>
        </div>
      );
    case "アーキ図":
      return data.diagrams.length === 0 ? (
        <p className="text-sm text-zinc-400">
          Node の編集画面で図のパスを足すと表示されます
        </p>
      ) : (
        <div className="space-y-4">
          {data.diagrams.map((d) => (
            <figure key={d.path} className="space-y-1">
              {d.title && (
                <figcaption className="text-xs text-zinc-400">
                  {d.title}
                </figcaption>
              )}
              <DiagramView title={d.title} kind={d.kind} url={d.url} />
            </figure>
          ))}
        </div>
      );
    case "チケット":
      return (
        <TicketsTab
          nodeId={data.node.id}
          asana={data.asana}
          tasks={data.tasks}
          onChanged={onChanged}
        />
      );
    case "看板":
    case "開発ループ":
    case "イテレーション": {
      if (devloop === null) {
        return <p className="text-sm text-zinc-400">読み込み中...</p>;
      }
      if (devloop.status === "error") {
        return (
          <p role="alert" className="text-sm text-red-400">
            読み込みに失敗しました ({devloop.message})
          </p>
        );
      }
      if (tab === "看板") {
        return (
          <BoardTab
            nodeId={data.node.id}
            view={devloop.data}
            onChanged={onDevloopChanged}
          />
        );
      }
      if (tab === "開発ループ") {
        return (
          <LoopTab
            nodeId={data.node.id}
            view={devloop.data}
            onChanged={onDevloopChanged}
          />
        );
      }
      return <IterationsTab iterations={devloop.data.iterations} />;
    }
    case "リンク": {
      const entries = Object.entries(data.node.links);
      return entries.length === 0 ? (
        <p className="text-sm text-zinc-400">リンクはありません</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {entries.map(([name, url]) => (
            <li key={name}>
              {name}:{" "}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-indigo-300 underline"
              >
                {url}
              </a>
            </li>
          ))}
        </ul>
      );
    }
  }
}
