import { and, desc, eq, gte, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { z } from "zod";

import {
  devloopControl,
  devloopRuns,
  devProjects,
  iterations,
  nodes,
  type DevloopRunRow,
  type DevloopRunStatus,
} from "@/db/schema";
import type { AppDb } from "@/db/types";

// devloop の実行時の制御 (仕様「M2 devloop のアプリ側」の「制御」)。
// 判定の部分は純粋関数に切り出してテストする。DB の読み書きは AppDb を受け取るサービスで行う。

const TIME_ZONE = "Asia/Tokyo";
const GLOBAL_STOP_KEY = "global_stop";
const DAILY_LIMIT_KEY = "daily_limit";
const AUTO_PAUSE_REASON = "3 回続けて失敗";
const AUTO_PAUSE_COUNT = 3;
const DAILY_LIMIT_DEFAULT = 1;
const DAILY_LIMIT_MIN = 1;
const DAILY_LIMIT_MAX = 20;

// ---------------------------------------------------------------- 型

export type ControlSettings = {
  nodeId: string;
  enabled: boolean;
  paused: boolean;
  pauseReason: string | null;
  autonomy: number;
  maxIterationsPerDay: number;
  maxPbisPerIteration: number;
  sprintLimit: number;
  lastSelectedAt: Date | null;
  lastRunAt: Date | null;
  updatedAt: Date | null;
};

export const SettingsPatchSchema = z
  .object({
    enabled: z.boolean(),
    paused: z.boolean(),
    pauseReason: z.string().nullable(),
    autonomy: z.number().int().min(0).max(3),
    maxIterationsPerDay: z.number().int().min(1).max(20),
    maxPbisPerIteration: z.number().int().min(1).max(20),
    sprintLimit: z.number().int().min(1).max(20),
  })
  .partial()
  .strict();

export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export type GlobalStop = { on: boolean; reason: string | null };

export type StopState = { stopped: boolean; reason: string | null };

export type NextProject = {
  nodeId: string;
  sourceRepo: string;
  autonomy: number;
  maxPbisPerIteration: number;
  sprintLimit: number;
  openIteration: number | null;
};

export type ProjectCandidate = NextProject & {
  enabled: boolean;
  paused: boolean;
  pauseReason: string | null;
  maxIterationsPerDay: number;
  lastSelectedAt: Date | null;
  lastRunAt: Date | null;
};

export type RunForCount = {
  nodeId: string;
  phase: string;
  status: DevloopRunStatus;
  finishedAt: Date | null;
};

export type FinishStatus = Exclude<DevloopRunStatus, "running">;

export type FinishResult =
  | { run: DevloopRunRow; autoPaused: false }
  | { run: DevloopRunRow; autoPaused: true; reason: string };

// ---------------------------------------------------------------- 純粋関数

/** 既定値 (行が無い Node は「無効・一時停止・L1」として扱う) */
export function defaultSettings(nodeId: string): ControlSettings {
  return {
    nodeId,
    enabled: false,
    paused: true,
    pauseReason: null,
    autonomy: 1,
    maxIterationsPerDay: 1,
    maxPbisPerIteration: 10,
    sprintLimit: 6,
    lastSelectedAt: null,
    lastRunAt: null,
    updatedAt: null,
  };
}

/** Asia/Tokyo の日付 (YYYY-MM-DD) */
export function tokyoDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Asia/Tokyo の今日の 0 時 (Asia/Tokyo に夏時間は無いので +09:00 固定) */
export function tokyoDayStart(now: Date): Date {
  return new Date(`${tokyoDateKey(now)}T00:00:00+09:00`);
}

/** 全体停止と Node の設定から、止まっているかと理由を決める */
export function resolveStop(
  globalStop: GlobalStop,
  settings: Pick<ControlSettings, "enabled" | "paused" | "pauseReason">,
): StopState {
  if (globalStop.on) {
    return { stopped: true, reason: globalStop.reason ?? "全体停止" };
  }
  if (!settings.enabled) return { stopped: true, reason: "無効" };
  if (settings.paused) {
    return { stopped: true, reason: settings.pauseReason ?? "一時停止" };
  }
  return { stopped: false, reason: null };
}

/** 今日 (Asia/Tokyo) 終えたイテレーション (phase が release で succeeded の実行) を Node ごとに数える */
function countDoneToday(runs: RunForCount[], now: Date): Map<string, number> {
  const today = tokyoDateKey(now);
  const done = new Map<string, number>();
  for (const run of runs) {
    if (run.phase !== "release" || run.status !== "succeeded") continue;
    if (!run.finishedAt || tokyoDateKey(run.finishedAt) !== today) continue;
    done.set(run.nodeId, (done.get(run.nodeId) ?? 0) + 1);
  }
  return done;
}

/** 並びの基準の時刻 (最後に選ばれた時刻、無ければ最後の実行の時刻。どちらも無ければ一番先) */
function selectionTime(candidate: ProjectCandidate): number {
  const at = candidate.lastSelectedAt ?? candidate.lastRunAt;
  return at ? at.getTime() : -Infinity;
}

/**
 * 次に進める Node を選ぶ。
 * - 全体の今日の件数 (全 Node の合計) が globalDailyLimit 以上なら null
 * - 止まっていない (resolveStop で停止でない) かつ、その Node の今日の件数が maxIterationsPerDay 未満の Node が候補
 * - 進行中のイテレーションがある Node を先に、次に最後に選ばれた時刻 (無ければ最後の実行の時刻) が古い順
 *   (どちらも無いものが最初)、同じなら nodeId 順
 */
export function pickNextProject(
  candidates: ProjectCandidate[],
  runsToday: RunForCount[],
  now: Date,
  globalStop: GlobalStop,
  globalDailyLimit: number,
): NextProject | null {
  if (globalStop.on) return null;

  const doneToday = countDoneToday(runsToday, now);
  let totalToday = 0;
  for (const count of doneToday.values()) totalToday += count;
  if (totalToday >= globalDailyLimit) return null;

  const eligible = candidates.filter(
    (c) =>
      !resolveStop(globalStop, c).stopped &&
      (doneToday.get(c.nodeId) ?? 0) < c.maxIterationsPerDay,
  );
  if (eligible.length === 0) return null;

  const sorted = [...eligible].sort((a, b) => {
    const openA = a.openIteration !== null ? 0 : 1;
    const openB = b.openIteration !== null ? 0 : 1;
    if (openA !== openB) return openA - openB;
    const timeA = selectionTime(a);
    const timeB = selectionTime(b);
    if (timeA !== timeB) return timeA < timeB ? -1 : 1;
    return a.nodeId.localeCompare(b.nodeId);
  });

  const pick = sorted[0];
  return {
    nodeId: pick.nodeId,
    sourceRepo: pick.sourceRepo,
    autonomy: pick.autonomy,
    maxPbisPerIteration: pick.maxPbisPerIteration,
    sprintLimit: pick.sprintLimit,
    openIteration: pick.openIteration,
  };
}

/** 直近の終了 (新しい順) がすべて failed で 3 件そろっていれば自動停止 */
export function shouldAutoPause(lastStatuses: DevloopRunStatus[]): boolean {
  const recent = lastStatuses.slice(0, AUTO_PAUSE_COUNT);
  return (
    recent.length === AUTO_PAUSE_COUNT && recent.every((s) => s === "failed")
  );
}

/** devloop_control の global_stop の値を読む (壊れていたら安全側の「停止」) */
export function parseGlobalStop(value: string | undefined): GlobalStop {
  if (value === undefined) return { on: false, reason: null };
  try {
    const parsed = z
      .object({ on: z.boolean(), reason: z.string().nullable().optional() })
      .parse(JSON.parse(value));
    return { on: parsed.on, reason: parsed.reason ?? null };
  } catch {
    return { on: true, reason: "global_stop の値を読めない" };
  }
}

/**
 * devloop_control の daily_limit の値を読む。
 * 行が無ければ既定の 1、読めなければ 0 (= 回さない。止める側に倒す)、読めたら 1〜20 に丸める。
 */
export function parseDailyLimit(value: string | undefined): number {
  if (value === undefined) return DAILY_LIMIT_DEFAULT;
  const text = value.trim();
  if (!/^-?\d+$/.test(text)) return 0;
  const n = Number(text);
  if (!Number.isSafeInteger(n)) return 0;
  return Math.min(DAILY_LIMIT_MAX, Math.max(DAILY_LIMIT_MIN, n));
}

// ---------------------------------------------------------------- サービス

const FinishInputSchema = z.object({
  status: z.enum(["succeeded", "failed", "noop", "rate_limited"]),
  summary: z.string(),
  tokens: z.record(z.string(), z.unknown()).optional(),
});

const DailyLimitSchema = z.number().int().min(DAILY_LIMIT_MIN).max(DAILY_LIMIT_MAX);

const LIST_RUNS_DEFAULT = 20;
const LIST_RUNS_MAX = 100;

export function createControlService(deps: { db: AppDb; now?: () => Date }) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  async function readControlValue(key: string): Promise<string | undefined> {
    const rows = await db
      .select({ value: devloopControl.value })
      .from(devloopControl)
      .where(eq(devloopControl.key, key))
      .limit(1);
    return rows[0]?.value;
  }

  async function writeControlValue(key: string, value: string): Promise<void> {
    const updatedAt = now();
    await db
      .insert(devloopControl)
      .values({ key, value, updatedAt })
      .onConflictDoUpdate({
        target: devloopControl.key,
        set: { value, updatedAt },
      });
  }

  async function getGlobalStop(): Promise<GlobalStop> {
    return parseGlobalStop(await readControlValue(GLOBAL_STOP_KEY));
  }

  async function setGlobalStop(on: boolean, reason?: string): Promise<void> {
    const value = JSON.stringify({ on, reason: on ? (reason ?? null) : null });
    await writeControlValue(GLOBAL_STOP_KEY, value);
  }

  async function getDailyLimit(): Promise<number> {
    return parseDailyLimit(await readControlValue(DAILY_LIMIT_KEY));
  }

  async function setDailyLimit(n: number): Promise<void> {
    const limit = DailyLimitSchema.parse(n);
    await writeControlValue(DAILY_LIMIT_KEY, String(limit));
  }

  async function getSettings(nodeId: string): Promise<ControlSettings> {
    const rows = await db
      .select()
      .from(devProjects)
      .where(eq(devProjects.nodeId, nodeId))
      .limit(1);
    return rows[0] ?? defaultSettings(nodeId);
  }

  /** 行が無ければ既定値で作り、あれば patch の列だけ上書きする */
  async function upsertSettings(
    nodeId: string,
    patch: SettingsPatch,
  ): Promise<ControlSettings> {
    const updatedAt = now();
    const base = defaultSettings(nodeId);
    const rows = await db
      .insert(devProjects)
      .values({
        nodeId,
        enabled: base.enabled,
        paused: base.paused,
        pauseReason: base.pauseReason,
        autonomy: base.autonomy,
        maxIterationsPerDay: base.maxIterationsPerDay,
        maxPbisPerIteration: base.maxPbisPerIteration,
        sprintLimit: base.sprintLimit,
        ...patch,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: devProjects.nodeId,
        set: { ...patch, updatedAt },
      })
      .returning();
    return rows[0];
  }

  async function updateSettings(
    nodeId: string,
    patch: SettingsPatch,
  ): Promise<ControlSettings> {
    return upsertSettings(nodeId, SettingsPatchSchema.parse(patch));
  }

  async function isStopped(nodeId: string): Promise<StopState> {
    const [globalStop, settings] = await Promise.all([
      getGlobalStop(),
      getSettings(nodeId),
    ]);
    return resolveStop(globalStop, settings);
  }

  async function pause(nodeId: string, reason: string) {
    return upsertSettings(nodeId, { paused: true, pauseReason: reason });
  }

  async function resume(nodeId: string) {
    return upsertSettings(nodeId, { paused: false, pauseReason: null });
  }

  /** 次に進める Node を選び、その Node の lastSelectedAt を今にする */
  async function nextProject(): Promise<NextProject | null> {
    const current = now();
    const [globalStop, dailyLimit] = await Promise.all([
      getGlobalStop(),
      getDailyLimit(),
    ]);
    if (globalStop.on || dailyLimit <= 0) return null;

    const projects = await db
      .select({
        nodeId: devProjects.nodeId,
        sourceRepo: nodes.sourceRepo,
        enabled: devProjects.enabled,
        paused: devProjects.paused,
        pauseReason: devProjects.pauseReason,
        autonomy: devProjects.autonomy,
        maxIterationsPerDay: devProjects.maxIterationsPerDay,
        maxPbisPerIteration: devProjects.maxPbisPerIteration,
        sprintLimit: devProjects.sprintLimit,
        lastSelectedAt: devProjects.lastSelectedAt,
        lastRunAt: devProjects.lastRunAt,
      })
      .from(devProjects)
      .innerJoin(nodes, eq(nodes.id, devProjects.nodeId))
      .where(
        and(
          eq(devProjects.enabled, true),
          eq(devProjects.paused, false),
          // リポジトリが無い・届かない Node は回さない
          isNotNull(nodes.sourceRepo),
          eq(nodes.repoReachable, true),
        ),
      );
    if (projects.length === 0) return null;

    const nodeIds = projects.map((p) => p.nodeId);
    const [runsToday, openRows] = await Promise.all([
      // 全体の上限と比べるため、全 Node の今日の件数を読む
      db
        .select({
          nodeId: devloopRuns.nodeId,
          phase: devloopRuns.phase,
          status: devloopRuns.status,
          finishedAt: devloopRuns.finishedAt,
        })
        .from(devloopRuns)
        .where(
          and(
            eq(devloopRuns.phase, "release"),
            eq(devloopRuns.status, "succeeded"),
            gte(devloopRuns.finishedAt, tokyoDayStart(current)),
          ),
        ),
      db
        .select({ nodeId: iterations.nodeId, number: iterations.number })
        .from(iterations)
        .where(
          and(inArray(iterations.nodeId, nodeIds), ne(iterations.phase, "done")),
        ),
    ]);

    // 進行中のイテレーションが複数あれば番号の大きいもの
    const openIteration = new Map<string, number>();
    for (const row of openRows) {
      const prev = openIteration.get(row.nodeId);
      if (prev === undefined || row.number > prev) {
        openIteration.set(row.nodeId, row.number);
      }
    }

    const candidates: ProjectCandidate[] = [];
    for (const p of projects) {
      // 条件で絞っているので null は来ない (型を狭めるための確認)
      if (p.sourceRepo === null) continue;
      candidates.push({
        ...p,
        sourceRepo: p.sourceRepo,
        openIteration: openIteration.get(p.nodeId) ?? null,
      });
    }
    const pick = pickNextProject(
      candidates,
      runsToday,
      current,
      globalStop,
      dailyLimit,
    );
    if (!pick) return null;

    await db
      .update(devProjects)
      .set({ lastSelectedAt: current })
      .where(eq(devProjects.nodeId, pick.nodeId));
    return pick;
  }

  async function startRun(input: {
    id: string;
    nodeId: string;
    iteration?: number;
    phase: string;
  }): Promise<DevloopRunRow> {
    const at = now();
    const rows = await db
      .insert(devloopRuns)
      .values({
        id: input.id,
        nodeId: input.nodeId,
        iteration: input.iteration ?? null,
        phase: input.phase,
        status: "running",
        startedAt: at,
        heartbeatAt: at,
      })
      .returning();
    return rows[0];
  }

  async function heartbeat(id: string, summary?: string): Promise<void> {
    await db
      .update(devloopRuns)
      .set({
        heartbeatAt: now(),
        ...(summary !== undefined ? { summary } : {}),
      })
      .where(eq(devloopRuns.id, id));
  }

  async function finishRun(
    id: string,
    input: {
      status: FinishStatus;
      summary: string;
      tokens?: Record<string, unknown>;
    },
  ): Promise<FinishResult> {
    const parsed = FinishInputSchema.parse(input);
    const at = now();
    const rows = await db
      .update(devloopRuns)
      .set({
        status: parsed.status,
        summary: parsed.summary,
        ...(parsed.tokens !== undefined ? { tokens: parsed.tokens } : {}),
        heartbeatAt: at,
        finishedAt: at,
      })
      .where(eq(devloopRuns.id, id))
      .returning();
    const run = rows[0];
    if (!run) throw new Error(`devloop_runs に ${id} が無い`);

    // 行が無い Node には作らない (update のみ)
    await db
      .update(devProjects)
      .set({ lastRunAt: at, updatedAt: at })
      .where(eq(devProjects.nodeId, run.nodeId));

    const recent = await db
      .select({ status: devloopRuns.status })
      .from(devloopRuns)
      .where(
        and(
          eq(devloopRuns.nodeId, run.nodeId),
          isNotNull(devloopRuns.finishedAt),
        ),
      )
      .orderBy(desc(devloopRuns.finishedAt))
      .limit(AUTO_PAUSE_COUNT);

    if (shouldAutoPause(recent.map((r) => r.status))) {
      await pause(run.nodeId, AUTO_PAUSE_REASON);
      return { run, autoPaused: true, reason: AUTO_PAUSE_REASON };
    }
    return { run, autoPaused: false };
  }

  /** heartbeat が古いまま running の実行 (画面の表示用) */
  async function staleRuns(minutes = 60): Promise<DevloopRunRow[]> {
    const threshold = new Date(now().getTime() - minutes * 60_000);
    return db
      .select()
      .from(devloopRuns)
      .where(
        and(
          eq(devloopRuns.status, "running"),
          lt(devloopRuns.heartbeatAt, threshold),
        ),
      )
      .orderBy(devloopRuns.heartbeatAt);
  }

  /** Node の実行を新しい順に返す (画面の表示用) */
  async function listRuns(
    nodeId: string,
    limit = LIST_RUNS_DEFAULT,
  ): Promise<DevloopRunRow[]> {
    const size = Number.isFinite(limit)
      ? Math.min(LIST_RUNS_MAX, Math.max(1, Math.trunc(limit)))
      : LIST_RUNS_DEFAULT;
    return db
      .select()
      .from(devloopRuns)
      .where(eq(devloopRuns.nodeId, nodeId))
      .orderBy(desc(devloopRuns.startedAt), desc(devloopRuns.id))
      .limit(size);
  }

  return {
    getSettings,
    updateSettings,
    setGlobalStop,
    getGlobalStop,
    setDailyLimit,
    getDailyLimit,
    isStopped,
    pause,
    resume,
    nextProject,
    startRun,
    heartbeat,
    finishRun,
    staleRuns,
    listRuns,
  };
}

export type ControlService = ReturnType<typeof createControlService>;
