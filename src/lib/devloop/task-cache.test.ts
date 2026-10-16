import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { externalRefs, nodes, taskCache } from "@/db/schema";
import type { TrackerTaskDetail } from "@/lib/tracker/types";
import { createTestDb } from "@/test/pglite";

import { buildItemNotes } from "./item-meta";
import {
  countOwnerDecisions,
  findCachedItem,
  saveTaskCache,
} from "./task-cache";

const now = new Date("2026-10-13T00:30:00.000Z");

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

function makeDetail(
  externalId: string,
  overrides: Partial<TrackerTaskDetail> = {},
): TrackerTaskDetail {
  return {
    externalId,
    name: `タスク ${externalId}`,
    completed: false,
    dueOn: null,
    url: `https://app.asana.com/0/0/${externalId}`,
    notes: "",
    tags: [],
    sectionId: null,
    sectionName: null,
    assigneeId: null,
    ...overrides,
  };
}

describe("task-cache", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    await testDb.db.delete(taskCache);
    await testDb.db.delete(externalRefs);
    await testDb.db.delete(nodes);
    await testDb.db.insert(nodes).values([makeNode("n1"), makeNode("n2")]);
    await testDb.db.insert(externalRefs).values([
      { nodeId: "n1", provider: "asana", externalId: "p1" },
      { nodeId: "n2", provider: "asana", externalId: "p2" },
    ]);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  async function rowsOf(projectId: string) {
    const rows = await testDb.db.select().from(taskCache);
    return rows.filter((r) => r.projectExternalId === projectId);
  }

  describe("saveTaskCache", () => {
    it("列・タグ・meta を保存し、件数を返す", async () => {
      const notes = buildItemNotes("本文", { id: "S-0001", value: 3 });
      const count = await saveTaskCache(testDb.db, {
        nodeId: "n1",
        projectId: "p1",
        details: [
          makeDetail("t1", {
            sectionName: "Owner 判断",
            tags: ["story", "from:pm"],
            notes,
            dueOn: "2026-10-20",
          }),
          makeDetail("t2", { completed: true }),
        ],
        now,
      });
      expect(count).toBe(2);

      const rows = await rowsOf("p1");
      expect(rows).toHaveLength(2);
      const t1 = rows.find((r) => r.externalId === "t1");
      expect(t1).toMatchObject({
        provider: "asana",
        nodeId: "n1",
        name: "タスク t1",
        completed: false,
        dueOn: "2026-10-20",
        section: "Owner 判断",
        tags: ["story", "from:pm"],
        meta: { id: "S-0001", value: 3 },
      });
      expect(t1?.updatedAt?.toISOString()).toBe(now.toISOString());
      const t2 = rows.find((r) => r.externalId === "t2");
      expect(t2).toMatchObject({ completed: true, section: null, tags: [] });
    });

    it("同じプロジェクトの古い行は消え、別のプロジェクトの行は残る", async () => {
      await saveTaskCache(testDb.db, {
        nodeId: "n1",
        projectId: "p1",
        details: [makeDetail("old1"), makeDetail("old2")],
        now,
      });
      await saveTaskCache(testDb.db, {
        nodeId: "n2",
        projectId: "p2",
        details: [makeDetail("other")],
        now,
      });

      const count = await saveTaskCache(testDb.db, {
        nodeId: "n1",
        projectId: "p1",
        details: [makeDetail("new1", { sectionName: "Doing" })],
        now,
      });
      expect(count).toBe(1);

      const p1 = await rowsOf("p1");
      expect(p1.map((r) => r.externalId)).toEqual(["new1"]);
      const p2 = await rowsOf("p2");
      expect(p2.map((r) => r.externalId)).toEqual(["other"]);
    });

    it("details が空なら古い行を消して 0 を返す", async () => {
      await saveTaskCache(testDb.db, {
        nodeId: "n1",
        projectId: "p1",
        details: [makeDetail("old1")],
        now,
      });
      const count = await saveTaskCache(testDb.db, {
        nodeId: "n1",
        projectId: "p1",
        details: [],
        now,
      });
      expect(count).toBe(0);
      expect(await rowsOf("p1")).toHaveLength(0);
    });

    it("meta の印が無い notes では meta が null", async () => {
      await saveTaskCache(testDb.db, {
        nodeId: "n1",
        projectId: "p1",
        details: [makeDetail("t1", { notes: "ただの本文" })],
        now,
      });
      const [row] = await rowsOf("p1");
      expect(row.meta).toBeNull();
    });

    it("meta の印が壊れている notes では meta が null", async () => {
      await saveTaskCache(testDb.db, {
        nodeId: "n1",
        projectId: "p1",
        details: [
          makeDetail("yaml", { notes: "本文\n\n<!-- devloop\n: [bad\n-->" }),
          makeDetail("open", { notes: "本文\n\n<!-- devloop\nid: S-0001" }),
          makeDetail("invalid", { notes: "<!-- devloop\nid: xx\n-->" }),
        ],
        now,
      });
      const rows = await rowsOf("p1");
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(row.meta).toBeNull();
    });
  });

  describe("findCachedItem", () => {
    it("Node とプロジェクトと列を返す", async () => {
      await saveTaskCache(testDb.db, {
        nodeId: "n1",
        projectId: "p1",
        details: [
          makeDetail("t1", { sectionName: "Doing" }),
          makeDetail("t2"),
        ],
        now,
      });
      expect(await findCachedItem(testDb.db, "t1")).toEqual({
        nodeId: "n1",
        projectExternalId: "p1",
        section: "Doing",
      });
      expect(await findCachedItem(testDb.db, "t2")).toEqual({
        nodeId: "n1",
        projectExternalId: "p1",
        section: null,
      });
    });

    it("無い id では null を返す", async () => {
      expect(await findCachedItem(testDb.db, "nothing")).toBeNull();
    });

    it("Node との紐づけ (external_refs) が無くなったプロジェクトの項目は null", async () => {
      await saveTaskCache(testDb.db, {
        nodeId: "n1",
        projectId: "p1",
        details: [makeDetail("t1")],
        now,
      });
      await testDb.db.delete(externalRefs);
      expect(await findCachedItem(testDb.db, "t1")).toBeNull();
    });
  });

  describe("countOwnerDecisions", () => {
    beforeEach(async () => {
      await saveTaskCache(testDb.db, {
        nodeId: "n1",
        projectId: "p1",
        details: [
          makeDetail("a", { sectionName: "Owner 判断" }),
          makeDetail("b", { sectionName: "Owner 判断" }),
          makeDetail("c", { sectionName: "Owner 判断", completed: true }),
          makeDetail("d", { sectionName: "Doing" }),
          makeDetail("e"),
        ],
        now,
      });
      await saveTaskCache(testDb.db, {
        nodeId: "n2",
        projectId: "p2",
        details: [
          makeDetail("f", { sectionName: "Owner 判断" }),
          makeDetail("g", { sectionName: "Backlog" }),
        ],
        now,
      });
    });

    it("未完了の「Owner 判断」だけを全 Node で数える", async () => {
      expect(await countOwnerDecisions(testDb.db)).toBe(3);
    });

    it("nodeId で絞れる", async () => {
      expect(await countOwnerDecisions(testDb.db, "n1")).toBe(2);
      expect(await countOwnerDecisions(testDb.db, "n2")).toBe(1);
      expect(await countOwnerDecisions(testDb.db, "none")).toBe(0);
    });
  });
});
