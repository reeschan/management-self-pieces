// `GET /api/nodes/<id>/devloop` の応答。Date は JSON で ISO 8601 の文字列になる。

export type DevloopViewItem = {
  id: string;
  name: string;
  tags: string[];
  meta: { value?: number; effort?: number } | null;
  metaError: string | null;
  url: string | null;
  completed: boolean;
};

export type DevloopViewData = {
  linked: boolean;
  asanaUrl: string | null;
  columns: { section: string; items: DevloopViewItem[] }[];
  settings: {
    nodeId: string;
    enabled: boolean;
    paused: boolean;
    pauseReason: string | null;
    autonomy: number;
    maxIterationsPerDay: number;
    maxPbisPerIteration: number;
    sprintLimit: number;
    updatedAt: string | null;
  };
  stopped: boolean;
  pauseReason: string | null;
  globalStop: { on: boolean; reason: string | null };
  runs: {
    id: string;
    phase: string;
    status: string;
    summary: string;
    startedAt: string;
    finishedAt: string | null;
  }[];
  iterations: {
    number: number;
    goal: string;
    phase: string;
    result: string | null;
    prUrl: string | null;
    stories: unknown[];
  }[];
};

export type DevloopStory = { id: string; title: string; status: string };

/** 日時を日本時間で出す */
export function formatJst(value: string | null): string {
  if (value === null) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
