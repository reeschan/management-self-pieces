import type { NodeSummary } from "./types";

const MARKER_KEY = "piece-node-id";
const MARKER_LINE = /^\s*piece-node-id:\s*([a-z0-9-]+)\s*$/;

/** プロジェクトの説明 (notes) を作る。末尾に Node id の marker 行を置く */
export function buildProjectNotes(node: NodeSummary): string {
  return `${node.summary}\n\n${MARKER_KEY}: ${node.id}`;
}

/** notes の中の `piece-node-id: <id>` の行から id を取り出す。無ければ null */
export function extractNodeId(notes: string | null | undefined): string | null {
  if (!notes) return null;
  for (const line of notes.split(/\r?\n/)) {
    const m = MARKER_LINE.exec(line);
    if (m) return m[1];
  }
  return null;
}
