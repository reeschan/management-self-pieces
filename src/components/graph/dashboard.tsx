"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { kindColors, type GraphData } from "@/lib/dashboard/graph";

const Graph3D = dynamic(() => import("./graph-3d"), { ssr: false });

export function Dashboard({ data }: { data: GraphData }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (data.nodes.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#05060a] p-8 text-zinc-300">
        <p>
          Node がありません。<code>pnpm db:seed</code>{" "}
          でサンプルを入れるか、GitHub App を入れたリポジトリに node.yaml
          を置いてください
        </p>
      </div>
    );
  }

  const counts = new Map<string, number>();
  for (const n of data.nodes) {
    const key = n.kind in kindColors ? n.kind : "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return (
    <div className="relative flex flex-1 bg-[#05060a]">
      <div className="relative min-h-[70vh] flex-1">
        <div className="absolute inset-0">
          <Graph3D
            data={data}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
        <ul className="absolute top-3 left-3 z-10 space-y-1 rounded bg-black/50 p-3 text-xs text-zinc-200">
          {[...counts.entries()].map(([kind, n]) => (
            <li key={kind} className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: kindColors[kind] }}
              />
              {kind} {n}
            </li>
          ))}
        </ul>
      </div>
      {selectedId && (
        <aside
          data-testid="node-panel-slot"
          className="w-80 shrink-0 border-l border-zinc-800 bg-[#0b0d14]"
        />
      )}
    </div>
  );
}
