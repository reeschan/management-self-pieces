"use client";

import { useEffect, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";

import type { GraphData, GraphNode } from "@/lib/dashboard/graph";

type Props = {
  data: GraphData;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

export default function Graph3D({ data, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [size, setSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () =>
      setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full">
      <ForceGraph3D
        ref={graphRef}
        graphData={data}
        width={size.width}
        height={size.height}
        backgroundColor="#05060a"
        nodeLabel={(n) =>
          `${escapeHtml(String(n.title))} (${escapeHtml(String(n.kind))})`
        }
        nodeColor={(n) =>
          n.id === selectedId ? "#ffffff" : (n as GraphNode).color
        }
        nodeVal={(n) =>
          n.id === selectedId ? (n as GraphNode).val * 1.6 : (n as GraphNode).val
        }
        linkWidth={0.5}
        linkColor={() => "#6b7280"}
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={1.5}
        onNodeClick={(node) => {
          const dist = 120;
          const x = node.x ?? 0;
          const y = node.y ?? 0;
          const z = node.z ?? 0;
          const r = Math.hypot(x, y, z);
          const ratio = r > 0 ? 1 + dist / r : 1;
          graphRef.current?.cameraPosition(
            r > 0
              ? { x: x * ratio, y: y * ratio, z: z * ratio }
              : { x, y, z: z + dist },
            { x, y, z },
            1000,
          );
          onSelect(String(node.id));
        }}
        onBackgroundClick={() => onSelect(null)}
      />
    </div>
  );
}
