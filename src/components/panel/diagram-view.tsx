"use client";

import { useEffect, useState } from "react";

type Props = { title: string | null; kind: string; url: string };

const IMAGE_KINDS = new Set(["svg", "png", "jpeg", "webp"]);

type MermaidState =
  | { url: string; status: "ok"; svg: string }
  | { url: string; status: "error"; message: string };

function MermaidView({ title, url }: { title: string | null; url: string }) {
  const [state, setState] = useState<MermaidState | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "dark",
        });
        const id = `mmd-${crypto.randomUUID()}`;
        const { svg } = await mermaid.render(id, text);
        if (!controller.signal.aborted) setState({ url, status: "ok", svg });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          url,
          status: "error",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
    })();
    return () => controller.abort();
  }, [url]);

  if (state === null || state.url !== url) {
    return <p className="text-xs text-zinc-400">図を読み込み中...</p>;
  }
  if (state.status === "error") {
    return (
      <p className="text-xs text-red-400">
        図を表示できませんでした ({state.message})
      </p>
    );
  }
  return (
    <div
      role="img"
      aria-label={title ?? "Mermaid diagram"}
      className="overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}

export function DiagramView({ title, kind, url }: Props) {
  if (IMAGE_KINDS.has(kind)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={title ?? url}
          className="max-w-full rounded border border-zinc-800 bg-white/5"
        />
      </a>
    );
  }
  if (kind === "mermaid") return <MermaidView title={title} url={url} />;
  return null;
}
