import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { externalRefs, nodes, taskCache } from "@/db/schema";
import { createTestDb } from "@/test/pglite";

import { listOwnerDecisions } from "./owner-inbox";
import { countOwnerDecisions } from "./task-cache";

function makeNode(id: string, title: string) {
  return {
    id,
    kind: "project",
    title,
    summary: "",
    status: "active",
    detailPath: `${id}.md`,
    sourceRepo: "owner/repo",
    sourceSha: "abc",
  };
}

function makeRow(
  nodeId: string,
  externalId: string,
  overrides: Partial<typeof taskCache.$inferInsert> = {},
): typeof taskCache.$inferInsert {
  return {
    provider: "asana",
    externalId,
    projectExternalId: `p-${nodeId}`,
    nodeId,
    name: `項目 ${externalId}`,
    completed: false,
    dueOn: null,
    url: `https://app.asana.com/0/0/${externalId}`,
    section: "Owner 判断",
    tags: [],
    meta: null,
    ...overrides,
  };
}

describe("listOwnerDecisions", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    await testDb.db.delete(taskCache);
    await testDb.db.delete(externalRefs);
    await testDb.db.delete(nodes);
    await testDb.db
      .insert(nodes)
      .values([makeNode("n1", "ベータ"), makeNode("n2", "アルファ")]);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("行が無ければ空配列を返す", async () => {
    expect(await listOwnerDecisions(testDb.db)).toEqual([]);
  });

  it("「Owner 判断」で未完了の行だけを返し、完了済みと他の列は返さない", async () => {
    await testDb.db.insert(taskCache).values([
      makeRow("n1", "a1"),
      makeRow("n1", "a2", { completed: true }),
      makeRow("n1", "a3", { section: "Sprint" }),
      makeRow("n1", "a4", { section: null }),
    ]);
    const result = await listOwnerDecisions(testDb.db);
    expect(result.map((r) => r.itemId)).toEqual(["a1"]);
  });

  it("Node の名前・項目の名前・URL・meta を付けて返す", async () => {
    await testDb.db
      .insert(taskCache)
      .values(
        makeRow("n1", "a1", { name: "どちらにする?", meta: { id: "S-1" } }),
      );
    expect(await listOwnerDecisions(testDb.db)).toEqual([
      {
        nodeId: "n1",
        nodeTitle: "ベータ",
        itemId: "a1",
        name: "どちらにする?",
        url: "https://app.asana.com/0/0/a1",
        meta: { id: "S-1" },
      },
    ]);
  });

  it("Node の名前順、次に項目の名前順に並べる", async () => {
    await testDb.db.insert(taskCache).values([
      makeRow("n1", "b1", { name: "い" }),
      makeRow("n2", "c1", { name: "ろ" }),
      makeRow("n1", "b2", { name: "あ" }),
      makeRow("n2", "c2", { name: "は" }),
    ]);
    const result = await listOwnerDecisions(testDb.db);
    expect(result.map((r) => [r.nodeTitle, r.name])).toEqual([
      ["アルファ", "は"],
      ["アルファ", "ろ"],
      ["ベータ", "あ"],
      ["ベータ", "い"],
    ]);
  });

  it("Node が見つからない行も落とさず、Node の ID を名前にする (件数と揃う)", async () => {
    await testDb.db
      .insert(taskCache)
      .values([makeRow("gone", "x1"), makeRow("n1", "a1")]);
    const result = await listOwnerDecisions(testDb.db);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.nodeId === "gone")?.nodeTitle).toBe("gone");
    expect(result).toHaveLength(await countOwnerDecisions(testDb.db));
  });
});
