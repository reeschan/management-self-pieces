import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  devloopControl,
  devloopRuns,
  devProjects,
  externalRefs,
  iterations,
  nodes,
  taskCache,
} from "@/db/schema";
import { createTestDb } from "@/test/pglite";

import { SECTIONS } from "./board";
import { createControlService } from "./control";
import { loadDevloopView, UNSORTED_SECTION } from "./view";

const NOW = new Date("2026-10-13T03:00:00.000Z");

function makeNode(id: string) {
  return {
    id,
    kind: "project",
    title: id,
    summary: "",
    status: "active",
    detailPath: `${id}.md`,
    sourceRepo: `owner/${id}`,
  };
}

function cacheRow(
  externalId: string,
  section: string | null,
  overrides: Partial<typeof taskCache.$inferInsert> = {},
): typeof taskCache.$inferInsert {
  return {
    provider: "asana",
    externalId,
    projectExternalId: "p1",
    nodeId: "n1",
    name: `項目 ${externalId}`,
    completed: false,
    dueOn: null,
    url: `https://app.asana.com/0/p1/${externalId}`,
    section,
    tags: [],
    meta: null,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("loadDevloopView", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    await testDb.db.delete(taskCache);
    await testDb.db.delete(devloopControl);
    await testDb.db.delete(devloopRuns);
    await testDb.db.delete(devProjects);
    await testDb.db.delete(iterations);
    await testDb.db.delete(externalRefs);
    await testDb.db.delete(nodes);
    await testDb.db.insert(nodes).values([makeNode("n1"), makeNode("n2")]);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  function load(nodeId: string) {
    const control = createControlService({ db: testDb.db, now: () => NOW });
    return loadDevloopView(testDb.db, nodeId, { control });
  }

  async function link(nodeId: string, projectId: string) {
    await testDb.db.insert(externalRefs).values({
      nodeId,
      provider: "asana",
      externalId: projectId,
      url: `https://app.asana.com/0/${projectId}`,
    });
  }

  it("存在しない Node なら null", async () => {
    expect(await load("missing")).toBeNull();
  });

  it("Asana につながっていない Node は linked: false で列が空", async () => {
    // 前につながっていたときの写しが残っていても出さない
    await testDb.db.insert(taskCache).values(cacheRow("t1", "Inbox"));

    const view = await load("n1");
    expect(view).not.toBeNull();
    expect(view?.linked).toBe(false);
    expect(view?.asanaUrl).toBeNull();
    expect(view?.columns).toEqual([]);
    // 設定は既定値 (無効・一時停止)
    expect(view?.settings.enabled).toBe(false);
    expect(view?.runs).toEqual([]);
    expect(view?.iterations).toEqual([]);
  });

  it("写しの行を列ごと・SECTIONS の順にまとめ、列の無い行は「未分類」にする", async () => {
    await link("n1", "p1");
    await testDb.db.insert(taskCache).values([
      cacheRow("1203", "Sprint", {
        tags: ["story", "from:pm"],
        meta: { id: "S-0001", value: 3 },
      }),
      cacheRow("1201", "Inbox"),
      cacheRow("1205", "Done", { completed: true }),
      cacheRow("1202", "Inbox", { meta: { id: "not-an-id" } }),
      cacheRow("1204", "Untitled section"),
      cacheRow("1206", null),
      // 別のプロジェクトの写し・別の Node の写しは入れない
      cacheRow("9001", "Inbox", { projectExternalId: "old-project" }),
      cacheRow("9002", "Inbox", { nodeId: "n2", projectExternalId: "p2" }),
    ]);

    const view = await load("n1");
    expect(view?.linked).toBe(true);
    expect(view?.asanaUrl).toBe("https://app.asana.com/0/p1");
    expect(view?.columns.map((c) => c.section)).toEqual([
      ...SECTIONS,
      "Untitled section",
      UNSORTED_SECTION,
    ]);

    const byName = new Map(view?.columns.map((c) => [c.section, c.items]));
    expect(byName.get("Inbox")?.map((i) => i.id)).toEqual(["1201", "1202"]);
    expect(byName.get("Sprint")).toEqual([
      {
        id: "1203",
        name: "項目 1203",
        tags: ["story", "from:pm"],
        meta: { id: "S-0001", value: 3 },
        metaError: null,
        url: "https://app.asana.com/0/p1/1203",
        completed: false,
      },
    ]);
    expect(byName.get("Done")?.[0]?.completed).toBe(true);
    expect(byName.get("Backlog")).toEqual([]);
    expect(byName.get("Untitled section")?.map((i) => i.id)).toEqual(["1204"]);
    expect(byName.get(UNSORTED_SECTION)?.map((i) => i.id)).toEqual(["1206"]);

    // 壊れた meta は null にして理由を入れる
    const broken = byName.get("Inbox")?.find((i) => i.id === "1202");
    expect(broken?.meta).toBeNull();
    expect(broken?.metaError).toEqual(expect.any(String));
  });

  it("列の無い行が無ければ「未分類」は出さない", async () => {
    await link("n1", "p1");
    await testDb.db.insert(taskCache).values(cacheRow("1201", "Inbox"));

    const view = await load("n1");
    expect(view?.columns.map((c) => c.section)).toEqual([...SECTIONS]);
  });

  it("実行は新しい順に 20 件まで", async () => {
    await testDb.db.insert(devloopRuns).values(
      Array.from({ length: 25 }, (_, i) => ({
        id: `run-${String(i).padStart(2, "0")}`,
        nodeId: "n1",
        phase: "build",
        status: "succeeded" as const,
        startedAt: new Date(NOW.getTime() - (25 - i) * 60_000),
      })),
    );
    await testDb.db.insert(devloopRuns).values({
      id: "other-node",
      nodeId: "n2",
      phase: "build",
      status: "running",
      startedAt: NOW,
    });

    const view = await load("n1");
    expect(view?.runs).toHaveLength(20);
    expect(view?.runs[0]?.id).toBe("run-24");
    expect(view?.runs[19]?.id).toBe("run-05");
    expect(view?.runs.every((r) => r.nodeId === "n1")).toBe(true);
  });

  it("イテレーションを番号の大きい順に入れる", async () => {
    await testDb.db.insert(iterations).values([
      { nodeId: "n1", number: 1, goal: "最初", phase: "done" },
      { nodeId: "n1", number: 2, goal: "次", phase: "build" },
      { nodeId: "n2", number: 1, goal: "別の Node", phase: "plan" },
    ]);

    const view = await load("n1");
    expect(view?.iterations.map((i) => [i.number, i.goal])).toEqual([
      [2, "次"],
      [1, "最初"],
    ]);
  });

  describe("停止の状態", () => {
    it("設定の行が無ければ「無効」で止まっている", async () => {
      const view = await load("n1");
      expect(view?.stopped).toBe(true);
      expect(view?.pauseReason).toBe("無効");
      expect(view?.globalStop).toEqual({ on: false, reason: null });
    });

    it("一時停止中は理由を返す", async () => {
      const control = createControlService({ db: testDb.db, now: () => NOW });
      await control.updateSettings("n1", { enabled: true, paused: false });
      await control.pause("n1", "3 回続けて失敗");

      const view = await load("n1");
      expect(view?.settings.enabled).toBe(true);
      expect(view?.settings.paused).toBe(true);
      expect(view?.stopped).toBe(true);
      expect(view?.pauseReason).toBe("3 回続けて失敗");
    });

    it("動いていれば stopped: false で理由は null", async () => {
      const control = createControlService({ db: testDb.db, now: () => NOW });
      await control.updateSettings("n1", { enabled: true, paused: false });

      const view = await load("n1");
      expect(view?.stopped).toBe(false);
      expect(view?.pauseReason).toBeNull();
    });

    it("全体停止中は全体停止の理由を返す", async () => {
      const control = createControlService({ db: testDb.db, now: () => NOW });
      await control.updateSettings("n1", { enabled: true, paused: false });
      await control.setGlobalStop(true, "点検");

      const view = await load("n1");
      expect(view?.stopped).toBe(true);
      expect(view?.pauseReason).toBe("点検");
      expect(view?.globalStop).toEqual({ on: true, reason: "点検" });
    });
  });
});
