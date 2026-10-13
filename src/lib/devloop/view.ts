import { and, eq } from "drizzle-orm";

import {
  externalRefs,
  nodes,
  taskCache,
  type DevloopRunRow,
  type IterationRow,
} from "@/db/schema";
import type { AppDb } from "@/db/types";

import { SECTIONS } from "./board";
import type { ControlService, ControlSettings, GlobalStop } from "./control";
import { type ItemMeta, ItemMetaSchema } from "./item-meta";
import { listIterations } from "./iteration-manifest";

// Node のパネルの「看板」「開発ループ」「イテレーション」タブが表示するデータを 1 回でまとめて読む。
// 画面を速くするため、看板は Asana を呼ばずに写し (task_cache) から組み立てる。

const PROVIDER = "asana";

/** 写しに列が無い行をまとめる列の名前 */
export const UNSORTED_SECTION = "未分類";

const RUNS_LIMIT = 20;

export type DevloopViewItem = {
  id: string;
  name: string;
  tags: string[];
  meta: ItemMeta | null;
  metaError: string | null;
  url: string | null;
  completed: boolean;
};

export type DevloopViewColumn = { section: string; items: DevloopViewItem[] };

export type DevloopView = {
  /** Asana のプロジェクトにつながっているか */
  linked: boolean;
  asanaUrl: string | null;
  /**
   * SECTIONS の順に 8 列 (項目が無い列も出す)。看板に無い名前の列はその後ろ、
   * 列が無い行は最後の「未分類」にまとめる。つながっていなければ空配列。
   */
  columns: DevloopViewColumn[];
  settings: ControlSettings;
  stopped: boolean;
  /** 止まっている理由 (全体停止・無効・一時停止の理由)。動いていれば null */
  pauseReason: string | null;
  globalStop: GlobalStop;
  /** 新しい順に 20 件まで */
  runs: DevloopRunRow[];
  /** 番号の大きい順 */
  iterations: IterationRow[];
};

type CacheRow = {
  externalId: string;
  name: string;
  completed: boolean;
  url: string | null;
  section: string | null;
  tags: string[];
  meta: Record<string, unknown> | null;
};

/** 写しの meta を検証する。壊れていれば meta は null、理由を metaError に入れる */
function toViewItem(row: CacheRow): DevloopViewItem {
  let meta: ItemMeta | null = null;
  let metaError: string | null = null;
  if (row.meta !== null) {
    const parsed = ItemMetaSchema.safeParse(row.meta);
    if (parsed.success) {
      meta = parsed.data;
    } else {
      // 利用者に返すので、検証の詳細は入れない
      metaError = "meta の形が正しくない";
    }
  }
  return {
    id: row.externalId,
    name: row.name,
    tags: row.tags,
    meta,
    metaError,
    url: row.url,
    completed: row.completed,
  };
}

/** 項目の並び: 未完了を先に、その中は id (Asana の gid は作った順に増える) の順 */
function compareItems(a: DevloopViewItem, b: DevloopViewItem): number {
  if (a.completed !== b.completed) return a.completed ? 1 : -1;
  return a.id.localeCompare(b.id, "en", { numeric: true });
}

function groupColumns(rows: CacheRow[]): DevloopViewColumn[] {
  const known = new Map<string, DevloopViewItem[]>(SECTIONS.map((s) => [s, []]));
  const others = new Map<string, DevloopViewItem[]>();
  const unsorted: DevloopViewItem[] = [];

  for (const row of rows) {
    const item = toViewItem(row);
    if (row.section === null || row.section === "") {
      unsorted.push(item);
      continue;
    }
    const list = known.get(row.section) ?? others.get(row.section);
    if (list) {
      list.push(item);
    } else {
      others.set(row.section, [item]);
    }
  }

  const columns = [...known, ...others].map(([section, items]) => ({
    section,
    items: items.sort(compareItems),
  }));
  if (unsorted.length > 0) {
    columns.push({ section: UNSORTED_SECTION, items: unsorted.sort(compareItems) });
  }
  return columns;
}

/** Node の devloop の表示データを読む。Node が無ければ null */
export async function loadDevloopView(
  db: AppDb,
  nodeId: string,
  deps: { control: ControlService },
): Promise<DevloopView | null> {
  const { control } = deps;

  const [node] = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
    .limit(1);
  if (!node) return null;

  const [refRows, settings, stop, globalStop, runs, iterationRows] =
    await Promise.all([
      db
        .select({ externalId: externalRefs.externalId, url: externalRefs.url })
        .from(externalRefs)
        .where(
          and(eq(externalRefs.nodeId, nodeId), eq(externalRefs.provider, PROVIDER)),
        )
        .limit(1),
      control.getSettings(nodeId),
      control.isStopped(nodeId),
      control.getGlobalStop(),
      control.listRuns(nodeId, RUNS_LIMIT),
      listIterations(db, nodeId),
    ]);

  const ref = refRows[0];
  let columns: DevloopViewColumn[] = [];
  if (ref) {
    // 今つながっているプロジェクトの写しだけを使う (前のプロジェクトの行が残っていても出さない)
    const rows = await db
      .select({
        externalId: taskCache.externalId,
        name: taskCache.name,
        completed: taskCache.completed,
        url: taskCache.url,
        section: taskCache.section,
        tags: taskCache.tags,
        meta: taskCache.meta,
      })
      .from(taskCache)
      .where(
        and(
          eq(taskCache.provider, PROVIDER),
          eq(taskCache.nodeId, nodeId),
          eq(taskCache.projectExternalId, ref.externalId),
        ),
      );
    columns = groupColumns(rows);
  }

  return {
    linked: ref !== undefined,
    asanaUrl: ref?.url ?? null,
    columns,
    settings,
    stopped: stop.stopped,
    pauseReason: stop.reason,
    globalStop,
    runs,
    iterations: iterationRows,
  };
}
