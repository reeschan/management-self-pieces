import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  devloopControl,
  devloopRuns,
  devProjects,
  iterations,
  nodes,
} from "@/db/schema";
import { createTestDb } from "@/test/pglite";

import {
  createControlService,
  defaultSettings,
  parseDailyLimit,
  parseGlobalStop,
  pickNextProject,
  resolveStop,
  SettingsPatchSchema,
  shouldAutoPause,
  tokyoDateKey,
  tokyoDayStart,
  type ProjectCandidate,
  type RunForCount,
} from "./control";

// 2026-10-13 12:00 (Asia/Tokyo)
const NOW = new Date("2026-10-13T03:00:00.000Z");
// Asia/Tokyo の 2026-10-12 23:59:59.999 (前日の最後)
const YESTERDAY_LAST = new Date("2026-10-12T14:59:59.999Z");
// Asia/Tokyo の 2026-10-13 00:00:00 (今日の最初)
const TODAY_FIRST = new Date("2026-10-12T15:00:00.000Z");

const NO_STOP = { on: false, reason: null };

function candidate(
  nodeId: string,
  overrides: Partial<ProjectCandidate> = {},
): ProjectCandidate {
  return {
    nodeId,
    sourceRepo: `owner/${nodeId}`,
    autonomy: 1,
    maxPbisPerIteration: 10,
    sprintLimit: 6,
    openIteration: null,
    enabled: true,
    paused: false,
    pauseReason: null,
    maxIterationsPerDay: 1,
    lastSelectedAt: null,
    lastRunAt: null,
    ...overrides,
  };
}

function releaseRun(
  nodeId: string,
  finishedAt: Date | null,
  overrides: Partial<RunForCount> = {},
): RunForCount {
  return { nodeId, phase: "release", status: "succeeded", finishedAt, ...overrides };
}

// ---------------------------------------------------------------- 純粋関数

describe("tokyoDateKey / tokyoDayStart", () => {
  it("Asia/Tokyo の日付で区切る", () => {
    expect(tokyoDateKey(YESTERDAY_LAST)).toBe("2026-10-12");
    expect(tokyoDateKey(TODAY_FIRST)).toBe("2026-10-13");
    expect(tokyoDayStart(NOW)).toEqual(TODAY_FIRST);
  });
});

describe("resolveStop", () => {
  const running = { enabled: true, paused: false, pauseReason: null };

  it("全体停止なら止まっている (理由が無ければ「全体停止」)", () => {
    expect(resolveStop({ on: true, reason: "点検" }, running)).toEqual({
      stopped: true,
      reason: "点検",
    });
    expect(resolveStop({ on: true, reason: null }, running)).toEqual({
      stopped: true,
      reason: "全体停止",
    });
  });

  it("無効・一時停止なら止まっている", () => {
    expect(resolveStop(NO_STOP, { ...running, enabled: false })).toEqual({
      stopped: true,
      reason: "無効",
    });
    expect(
      resolveStop(NO_STOP, { ...running, paused: true, pauseReason: "手で止めた" }),
    ).toEqual({ stopped: true, reason: "手で止めた" });
    expect(resolveStop(NO_STOP, { ...running, paused: true })).toEqual({
      stopped: true,
      reason: "一時停止",
    });
  });

  it("どれでもなければ止まっていない", () => {
    expect(resolveStop(NO_STOP, running)).toEqual({ stopped: false, reason: null });
  });
});

describe("pickNextProject", () => {
  it("全体停止なら null", () => {
    expect(
      pickNextProject([candidate("a")], [], NOW, { on: true, reason: null }, 5),
    ).toBeNull();
  });

  it("全体の今日の件数 (全 Node の合計) が全体の上限以上なら null", () => {
    const runs = [releaseRun("a", NOW)];
    const list = [candidate("a", { maxIterationsPerDay: 5 }), candidate("b")];
    expect(pickNextProject(list, runs, NOW, NO_STOP, 1)).toBeNull();
    // 上限を上げると、まだ回せる Node が選ばれる
    expect(pickNextProject(list, runs, NOW, NO_STOP, 2)?.nodeId).toBe("a");
  });

  it("その Node の今日の件数が maxIterationsPerDay に達していれば外れる", () => {
    const runs = [releaseRun("a", NOW)];
    const list = [candidate("a", { maxIterationsPerDay: 1 }), candidate("b")];
    expect(pickNextProject(list, runs, NOW, NO_STOP, 5)?.nodeId).toBe("b");
    expect(pickNextProject([candidate("a")], runs, NOW, NO_STOP, 5)).toBeNull();
  });

  it("今日の件数は release で succeeded の実行を Asia/Tokyo の日付で数える (日付の境目)", () => {
    const list = [candidate("a")];
    // 前日の 23:59:59.999 に終わった実行は数えない
    expect(
      pickNextProject(list, [releaseRun("a", YESTERDAY_LAST)], NOW, NO_STOP, 1)
        ?.nodeId,
    ).toBe("a");
    // 今日の 0:00 に終わった実行は数える
    expect(
      pickNextProject(list, [releaseRun("a", TODAY_FIRST)], NOW, NO_STOP, 1),
    ).toBeNull();
    // release 以外・succeeded 以外・終わっていないものは数えない
    const notCounted = [
      releaseRun("a", NOW, { phase: "implement" }),
      releaseRun("a", NOW, { status: "failed" }),
      releaseRun("a", NOW, { status: "noop" }),
      releaseRun("a", null),
    ];
    expect(pickNextProject(list, notCounted, NOW, NO_STOP, 1)?.nodeId).toBe("a");
  });

  it("止まっている Node (無効・一時停止) は候補にしない", () => {
    const list = [
      candidate("a", { enabled: false }),
      candidate("b", { paused: true }),
    ];
    expect(pickNextProject(list, [], NOW, NO_STOP, 5)).toBeNull();
  });

  it("進行中のイテレーションがある Node を先にする", () => {
    const list = [
      candidate("a"),
      candidate("b", {
        openIteration: 3,
        lastSelectedAt: new Date("2026-10-13T02:00:00Z"),
      }),
    ];
    expect(pickNextProject(list, [], NOW, NO_STOP, 5)).toEqual({
      nodeId: "b",
      sourceRepo: "owner/b",
      autonomy: 1,
      maxPbisPerIteration: 10,
      sprintLimit: 6,
      openIteration: 3,
    });
  });

  it("最後に選ばれた時刻 (無ければ最後の実行の時刻) が古い順。どちらも無いものが最初、同じなら nodeId 順", () => {
    const old = new Date("2026-10-10T00:00:00Z");
    const mid = new Date("2026-10-11T00:00:00Z");
    const recent = new Date("2026-10-12T00:00:00Z");
    // lastSelectedAt が lastRunAt より優先される
    const byTime = [
      candidate("a", { lastSelectedAt: recent, lastRunAt: old }),
      candidate("b", { lastRunAt: mid }),
    ];
    expect(pickNextProject(byTime, [], NOW, NO_STOP, 5)?.nodeId).toBe("b");

    const withNever = [...byTime, candidate("c")];
    expect(pickNextProject(withNever, [], NOW, NO_STOP, 5)?.nodeId).toBe("c");

    const tie = [
      candidate("z", { lastSelectedAt: mid }),
      candidate("y", { lastSelectedAt: mid }),
    ];
    expect(pickNextProject(tie, [], NOW, NO_STOP, 5)?.nodeId).toBe("y");
  });
});

describe("shouldAutoPause", () => {
  it("直近 3 件がすべて failed のときだけ true", () => {
    expect(shouldAutoPause(["failed", "failed", "failed"])).toBe(true);
    expect(shouldAutoPause(["failed", "failed", "failed", "succeeded"])).toBe(true);
    expect(shouldAutoPause(["failed", "failed"])).toBe(false);
    expect(shouldAutoPause(["failed", "succeeded", "failed"])).toBe(false);
  });
});

describe("parseGlobalStop", () => {
  it("行が無ければ止まっていない", () => {
    expect(parseGlobalStop(undefined)).toEqual({ on: false, reason: null });
  });

  it("JSON {on, reason} を読む", () => {
    expect(parseGlobalStop('{"on":true,"reason":"点検"}')).toEqual({
      on: true,
      reason: "点検",
    });
    expect(parseGlobalStop('{"on":false}')).toEqual({ on: false, reason: null });
  });

  it("読めない値は停止扱い", () => {
    expect(parseGlobalStop("on").on).toBe(true);
    expect(parseGlobalStop('{"on":"yes"}').on).toBe(true);
    expect(parseGlobalStop("").on).toBe(true);
  });
});

describe("parseDailyLimit", () => {
  it("行が無ければ 1", () => {
    expect(parseDailyLimit(undefined)).toBe(1);
  });

  it("読めた値は 1〜20 に丸める", () => {
    expect(parseDailyLimit("3")).toBe(3);
    expect(parseDailyLimit(" 7 ")).toBe(7);
    expect(parseDailyLimit("0")).toBe(1);
    expect(parseDailyLimit("-4")).toBe(1);
    expect(parseDailyLimit("100")).toBe(20);
  });

  it("読めない値は 0 (止める側に倒す)", () => {
    expect(parseDailyLimit("abc")).toBe(0);
    expect(parseDailyLimit("")).toBe(0);
    expect(parseDailyLimit("2.5")).toBe(0);
    expect(parseDailyLimit('{"limit":3}')).toBe(0);
  });
});

describe("defaultSettings / SettingsPatchSchema", () => {
  it("既定値は無効・一時停止・L1、1 日 1 回、sprintLimit 6", () => {
    expect(defaultSettings("n")).toMatchObject({
      enabled: false,
      paused: true,
      autonomy: 1,
      maxIterationsPerDay: 1,
      maxPbisPerIteration: 10,
      sprintLimit: 6,
      lastSelectedAt: null,
    });
  });

  it("sprintLimit は 1〜20", () => {
    expect(SettingsPatchSchema.safeParse({ sprintLimit: 1 }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ sprintLimit: 20 }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ sprintLimit: 0 }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ sprintLimit: 21 }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------- サービス

describe("createControlService", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let clock: Date;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    clock = NOW;
    await testDb.db.delete(devloopRuns);
    await testDb.db.delete(iterations);
    await testDb.db.delete(devloopControl);
    await testDb.db.delete(devProjects);
    await testDb.db.delete(nodes);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  function service() {
    return createControlService({ db: testDb.db, now: () => clock });
  }

  async function addNode(id: string) {
    await testDb.db.insert(nodes).values({
      id,
      kind: "project",
      title: id,
      summary: "",
      status: "active",
      detailPath: `docs/${id}.md`,
      sourceRepo: `owner/${id}`,
    });
  }

  /** Node を作り、有効・一時停止なしにする */
  async function addRunnableNode(id: string, patch = {}) {
    await addNode(id);
    await service().updateSettings(id, { enabled: true, paused: false, ...patch });
  }

  async function addFinishedRun(
    id: string,
    nodeId: string,
    finishedAt: Date,
    phase = "release",
    status: "succeeded" | "failed" = "succeeded",
  ) {
    await testDb.db.insert(devloopRuns).values({
      id,
      nodeId,
      phase,
      status,
      startedAt: finishedAt,
      heartbeatAt: finishedAt,
      finishedAt,
    });
  }

  describe("設定", () => {
    it("行が無い Node は既定値を返す", async () => {
      expect(await service().getSettings("none")).toEqual(defaultSettings("none"));
    });

    it("updateSettings は既定値で upsert し、patch の列だけ上書きする", async () => {
      await addNode("a");
      const created = await service().updateSettings("a", { sprintLimit: 4 });
      expect(created).toMatchObject({
        enabled: false,
        paused: true,
        maxIterationsPerDay: 1,
        sprintLimit: 4,
        updatedAt: NOW,
      });
      const updated = await service().updateSettings("a", { autonomy: 2 });
      expect(updated).toMatchObject({ autonomy: 2, sprintLimit: 4 });
    });

    it("範囲外の値は断る", async () => {
      await addNode("a");
      await expect(
        service().updateSettings("a", { sprintLimit: 21 }),
      ).rejects.toThrow();
    });
  });

  describe("全体停止と 1 日の上限", () => {
    it("行が無ければ全体停止は off、1 日の上限は 1", async () => {
      expect(await service().getGlobalStop()).toEqual({ on: false, reason: null });
      expect(await service().getDailyLimit()).toBe(1);
    });

    it("setGlobalStop / setDailyLimit で書いた値を読める", async () => {
      const svc = service();
      await svc.setGlobalStop(true, "点検");
      expect(await svc.getGlobalStop()).toEqual({ on: true, reason: "点検" });
      await svc.setGlobalStop(false, "無視される");
      expect(await svc.getGlobalStop()).toEqual({ on: false, reason: null });

      await svc.setDailyLimit(5);
      expect(await svc.getDailyLimit()).toBe(5);
      await expect(svc.setDailyLimit(0)).rejects.toThrow();
      await expect(svc.setDailyLimit(21)).rejects.toThrow();
    });

    it("daily_limit が読めない値なら 0 (= 回さない)", async () => {
      await addRunnableNode("a");
      await testDb.db
        .insert(devloopControl)
        .values({ key: "daily_limit", value: "たくさん" });
      expect(await service().getDailyLimit()).toBe(0);
      expect(await service().nextProject()).toBeNull();
    });
  });

  describe("isStopped / pause / resume", () => {
    it("行が無い Node は無効なので止まっている", async () => {
      expect(await service().isStopped("none")).toEqual({
        stopped: true,
        reason: "無効",
      });
    });

    it("有効で一時停止でなければ止まっていない。pause で止まり、resume で戻る", async () => {
      await addRunnableNode("a");
      const svc = service();
      expect((await svc.isStopped("a")).stopped).toBe(false);

      await svc.pause("a", "手で止めた");
      expect(await svc.isStopped("a")).toEqual({
        stopped: true,
        reason: "手で止めた",
      });

      await svc.resume("a");
      expect(await svc.isStopped("a")).toEqual({ stopped: false, reason: null });
    });

    it("無効にすると止まっている", async () => {
      await addRunnableNode("a");
      await service().updateSettings("a", { enabled: false });
      expect(await service().isStopped("a")).toEqual({
        stopped: true,
        reason: "無効",
      });
    });

    it("全体停止なら止まっている", async () => {
      await addRunnableNode("a");
      await service().setGlobalStop(true, "点検");
      expect(await service().isStopped("a")).toEqual({
        stopped: true,
        reason: "点検",
      });
      expect(await service().nextProject()).toBeNull();
    });

    it("global_stop が読めない値なら停止扱い", async () => {
      await addRunnableNode("a");
      await testDb.db
        .insert(devloopControl)
        .values({ key: "global_stop", value: "{broken" });
      expect((await service().isStopped("a")).stopped).toBe(true);
      expect(await service().nextProject()).toBeNull();
    });
  });

  describe("nextProject", () => {
    it("止まっていない Node が無ければ null", async () => {
      await addNode("a");
      expect(await service().nextProject()).toBeNull();
    });

    it("全体の 1 日の上限 (既定 1) に達すると null。上限を上げても Node ごとの上限で外れる", async () => {
      await addRunnableNode("a");
      await addRunnableNode("b");
      await addFinishedRun("r1", "a", new Date("2026-10-13T01:00:00Z"));
      const svc = service();
      expect(await svc.nextProject()).toBeNull();

      await svc.setDailyLimit(2);
      // a は Node ごとの上限 (1) に達しているので b
      expect((await svc.nextProject())?.nodeId).toBe("b");
    });

    it("今日の件数は Asia/Tokyo の日付で数える (日付の境目)", async () => {
      await addRunnableNode("a");
      await addFinishedRun("r1", "a", YESTERDAY_LAST);
      expect((await service().nextProject())?.nodeId).toBe("a");

      await addFinishedRun("r2", "a", TODAY_FIRST);
      expect(await service().nextProject()).toBeNull();
    });

    it("release 以外や failed の実行は数えない", async () => {
      await addRunnableNode("a");
      await addFinishedRun("r1", "a", NOW, "implement");
      await addFinishedRun("r2", "a", NOW, "release", "failed");
      expect((await service().nextProject())?.nodeId).toBe("a");
    });

    it("進行中のイテレーションの Node を先にし、返す形に sprintLimit と進行中の番号を含める", async () => {
      await addRunnableNode("a");
      await addRunnableNode("b", { sprintLimit: 3, autonomy: 2 });
      await testDb.db.insert(iterations).values([
        { nodeId: "b", number: 1, goal: "g1", phase: "done" },
        { nodeId: "b", number: 2, goal: "g2", phase: "implement" },
        { nodeId: "a", number: 1, goal: "g", phase: "done" },
      ]);
      expect(await service().nextProject()).toEqual({
        nodeId: "b",
        sourceRepo: "owner/b",
        autonomy: 2,
        maxPbisPerIteration: 10,
        sprintLimit: 3,
        openIteration: 2,
      });
    });

    it("選ぶと lastSelectedAt が更新され、続けて呼ぶと別の Node が選ばれる", async () => {
      await addRunnableNode("a");
      await addRunnableNode("b");
      const svc = service();

      const first = await svc.nextProject();
      expect(first?.nodeId).toBe("a");
      expect((await svc.getSettings("a")).lastSelectedAt).toEqual(NOW);
      expect((await svc.getSettings("b")).lastSelectedAt).toBeNull();

      clock = new Date(NOW.getTime() + 60_000);
      const second = await svc.nextProject();
      expect(second?.nodeId).toBe("b");
      expect((await svc.getSettings("b")).lastSelectedAt).toEqual(clock);

      clock = new Date(NOW.getTime() + 120_000);
      expect((await svc.nextProject())?.nodeId).toBe("a");
    });
  });

  describe("実行の記録", () => {
    it("startRun / heartbeat / finishRun で記録し、finishRun は lastRunAt を更新する", async () => {
      await addRunnableNode("a");
      const svc = service();
      const run = await svc.startRun({ id: "r1", nodeId: "a", iteration: 2, phase: "plan" });
      expect(run).toMatchObject({ status: "running", startedAt: NOW, heartbeatAt: NOW });

      clock = new Date(NOW.getTime() + 60_000);
      await svc.heartbeat("r1", "途中");

      clock = new Date(NOW.getTime() + 120_000);
      const result = await svc.finishRun("r1", {
        status: "succeeded",
        summary: "完了",
        tokens: { input: 10 },
      });
      expect(result.autoPaused).toBe(false);
      expect(result.run).toMatchObject({
        status: "succeeded",
        summary: "完了",
        tokens: { input: 10 },
        finishedAt: clock,
      });
      expect((await svc.getSettings("a")).lastRunAt).toEqual(clock);
    });

    it("finishRun は dev_projects の行が無い Node に行を作らない", async () => {
      await addNode("a");
      const svc = service();
      await svc.startRun({ id: "r1", nodeId: "a", phase: "plan" });
      await svc.finishRun("r1", { status: "succeeded", summary: "" });
      expect(await testDb.db.select().from(devProjects)).toHaveLength(0);
    });

    it("存在しない run は断る", async () => {
      await expect(
        service().finishRun("none", { status: "failed", summary: "" }),
      ).rejects.toThrow();
    });

    it("3 回続けて failed で自動で一時停止し、理由が入る", async () => {
      await addRunnableNode("a");
      const svc = service();
      for (let i = 1; i <= 3; i += 1) {
        clock = new Date(NOW.getTime() + i * 60_000);
        await svc.startRun({ id: `r${i}`, nodeId: "a", phase: "implement" });
        const result = await svc.finishRun(`r${i}`, {
          status: "failed",
          summary: "失敗",
        });
        if (i < 3) {
          expect(result.autoPaused).toBe(false);
        } else {
          expect(result).toMatchObject({ autoPaused: true, reason: "3 回続けて失敗" });
        }
      }
      expect(await svc.getSettings("a")).toMatchObject({
        paused: true,
        pauseReason: "3 回続けて失敗",
      });
      expect(await svc.isStopped("a")).toEqual({
        stopped: true,
        reason: "3 回続けて失敗",
      });
    });

    it("間に成功があれば自動で止めない", async () => {
      await addRunnableNode("a");
      const svc = service();
      const statuses = ["failed", "succeeded", "failed", "failed"] as const;
      for (const [i, status] of statuses.entries()) {
        clock = new Date(NOW.getTime() + (i + 1) * 60_000);
        await svc.startRun({ id: `r${i}`, nodeId: "a", phase: "implement" });
        const result = await svc.finishRun(`r${i}`, { status, summary: "" });
        expect(result.autoPaused).toBe(false);
      }
      expect((await svc.isStopped("a")).stopped).toBe(false);
    });

    it("staleRuns は heartbeat が古い running の実行を返す", async () => {
      await addRunnableNode("a");
      const svc = service();
      await svc.startRun({ id: "old", nodeId: "a", phase: "plan" });
      clock = new Date(NOW.getTime() + 50 * 60_000);
      await svc.startRun({ id: "new", nodeId: "a", phase: "plan" });
      clock = new Date(NOW.getTime() + 61 * 60_000);
      expect((await svc.staleRuns()).map((r) => r.id)).toEqual(["old"]);
    });

    it("listRuns は新しい順に limit 件まで返す", async () => {
      await addRunnableNode("a");
      await addRunnableNode("b");
      const svc = service();
      for (let i = 1; i <= 3; i += 1) {
        clock = new Date(NOW.getTime() + i * 60_000);
        await svc.startRun({ id: `a${i}`, nodeId: "a", phase: "plan" });
      }
      await svc.startRun({ id: "b1", nodeId: "b", phase: "plan" });
      expect((await svc.listRuns("a", 2)).map((r) => r.id)).toEqual(["a3", "a2"]);
      expect((await svc.listRuns("a", 10)).map((r) => r.id)).toEqual([
        "a3",
        "a2",
        "a1",
      ]);
    });
  });
});
