import { kindIds, type KindId } from "@/lib/manifest/kinds";

export type GraphNode = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  status: string;
  openTasks: number;
  color: string;
  val: number;
};
export type GraphLink = { source: string; target: string; type: string };
export type GraphData = { nodes: GraphNode[]; links: GraphLink[] };

const palette: Record<KindId, string> = {
  app: "#4f9dff",
  skill: "#b07cff",
  library: "#39d0a0",
  doc: "#ffc857",
  infra: "#ff7a59",
  other: "#9aa4b2",
};

/** kinds.ts の全 kind に色を割り当てる。未知の kind は other の色 */
export const kindColors: Record<string, string> = Object.fromEntries(
  kindIds.map((id) => [id, palette[id]]),
);

export function colorOf(kind: string): string {
  return kindColors[kind] ?? kindColors.other;
}

export function toGraphData(
  nodes: {
    id: string;
    kind: string;
    title: string;
    summary: string;
    status: string;
  }[],
  relations: { fromId: string; toId: string; type: string }[],
  openTaskCounts: Record<string, number>,
): GraphData {
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes: nodes.map((n) => {
      const openTasks = openTaskCounts[n.id] ?? 0;
      const base = colorOf(n.kind);
      return {
        id: n.id,
        kind: n.kind,
        title: n.title,
        summary: n.summary,
        status: n.status,
        openTasks,
        color: n.status === "archived" ? `${base}66` : base,
        val: 1 + Math.min(openTasks, 20) / 4,
      };
    }),
    links: relations
      .filter((r) => ids.has(r.fromId) && ids.has(r.toId))
      .map((r) => ({ source: r.fromId, target: r.toId, type: r.type })),
  };
}
