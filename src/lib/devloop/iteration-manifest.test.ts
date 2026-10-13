import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { iterations, nodes } from "@/db/schema";
import { createTestDb } from "@/test/pglite";

import { IterationManifestSchema, listIterations, upsertIteration } from "./iteration-manifest";

const startedAt = "2026-10-13T09:00:00+09:00";
const finishedAt = "2026-10-13T10:00:00+09:00";
const story = { id: "S-0042", title: "記録を保存する", status: "planned" };

function validInput() {
  return {
    number: 1,
    goal: "イテレーションの記録を保存する",
    phase: "plan",
    stories: [story],
    biz_scores: {},
    started_at: startedAt,
  };
}

describe("IterationManifestSchema", () => {
  it("雛形を埋めた値を受け取り、未知のキーを捨てる", () => {
    expect(IterationManifestSchema.parse({
      ...validInput(),
      rework_count: 0,
      sourceSha: "無視する値",
      stories: [{ ...story, unknown: true }],
      biz_scores: { unknown: 5 },
    })).toEqual(validInput());
  });

  it("採点は省略すると空になり、任意の項目も省略できる", () => {
    expect(IterationManifestSchema.parse({ ...validInput(), biz_scores: undefined }))
      .toEqual(validInput());
    expect(IterationManifestSchema.safeParse({ ...validInput(), stories: [] }).success).toBe(true);
  });

  it("任意の項目と入れ子の統計を受け取る", () => {
    const input = {
      ...validInput(),
      stories: [{ ...story, status: "done", biz: "accepted" }],
      biz_scores: { value: 1, usability: 3, coherence: 5 },
      result: "accepted",
      finished_at: finishedAt,
      pr_url: "https://github.com/example/repo/pull/1",
      stats: { tokens: 42, details: { costs: [1, 2], complete: true, pending: null } },
    };
    expect(IterationManifestSchema.parse(input)).toEqual(input);
  });

  it("文字数と件数の上限ちょうどは受け取る", () => {
    const stats = { text: "あ".repeat(9_989) };
    expect(JSON.stringify(stats)).toHaveLength(10_000);
    expect(IterationManifestSchema.safeParse({
      ...validInput(), goal: "あ".repeat(300),
      stories: Array.from({ length: 50 }, () => ({ ...story, title: "あ".repeat(200) })),
      stats,
    }).success).toBe(true);
  });

  it.each([
    ["番号が 0", { number: 0 }],
    ["番号が負数", { number: -1 }],
    ["番号が小数", { number: 1.5 }],
    ["番号が文字列", { number: "1" }],
    ["goal が空", { goal: "" }],
    ["goal が 301 文字", { goal: "あ".repeat(301) }],
    ["phase が不正", { phase: "unknown" }],
    ["stories がない", { stories: undefined }],
    ["stories が 51 件", { stories: Array.from({ length: 51 }, () => story) }],
    ["id の接頭辞が不正", { stories: [{ ...story, id: "X-0042" }] }],
    ["id の桁数が不正", { stories: [{ ...story, id: "S-42" }] }],
    ["title が空", { stories: [{ ...story, title: "" }] }],
    ["title が 201 文字", { stories: [{ ...story, title: "あ".repeat(201) }] }],
    ["status が不正", { stories: [{ ...story, status: "unknown" }] }],
    ["biz が不正", { stories: [{ ...story, biz: "unknown" }] }],
    ["開始日時がない", { started_at: undefined }],
    ["開始日時が空", { started_at: "" }],
    ["開始日時が null", { started_at: null }],
    ["開始日時が日付だけ", { started_at: "2026-10-13" }],
    ["開始日時が存在しない日", { started_at: "2026-02-30T00:00:00Z" }],
    ["終了日時が不正", { finished_at: "不正な日時" }],
    ["result が不正", { result: "done" }],
    ["pr_url が http", { pr_url: "http://example.com/pr/1" }],
    ["pr_url が ftp", { pr_url: "ftp://example.com/pr/1" }],
    ["pr_url が URL ではない", { pr_url: "https://" }],
    ["stats が 10,001 文字", { stats: { text: "あ".repeat(9_990) } }],
    ["stats が配列", { stats: [] }],
    ["stats が null", { stats: null }],
    ["stats が文字列", { stats: "統計" }],
    ["stats を JSON にできない", { stats: { tokens: BigInt(1) } }],
  ])("%s なら拒否する", (_name, invalid) => {
    expect(IterationManifestSchema.safeParse({ ...validInput(), ...invalid }).success).toBe(false);
  });

  it.each(["value", "usability", "coherence"])("%s は 1〜5 の整数に限る", (key) => {
    for (const value of [0, 6, 1.5, "3", null]) {
      expect(IterationManifestSchema.safeParse({
        ...validInput(), biz_scores: { [key]: value },
      }).success).toBe(false);
    }
  });

  it.each(["plan", "build", "verify", "review", "retro", "groom", "release", "done", "owner_wait"])(
    "フェーズ %s を受け取る", (phase) => {
      expect(IterationManifestSchema.safeParse({ ...validInput(), phase }).success).toBe(true);
    },
  );

  it.each(["S", "B", "D", "E", "C"])("項目の接頭辞 %s を受け取る", (prefix) => {
    expect(IterationManifestSchema.safeParse({
      ...validInput(), stories: [{ ...story, id: `${prefix}-0001` }],
    }).success).toBe(true);
  });

  it.each(["planned", "done", "carried_over", "owner", "rejected"])(
    "ストーリーの状態 %s を受け取る", (status) => {
      expect(IterationManifestSchema.safeParse({
        ...validInput(), stories: [{ ...story, status, biz: "changes_requested" }],
      }).success).toBe(true);
    },
  );

  it.each(["accepted", "partially_accepted", "rejected", "aborted"])(
    "結果 %s を受け取る", (result) => {
      expect(IterationManifestSchema.safeParse({ ...validInput(), result }).success).toBe(true);
    },
  );
});

describe("イテレーションの保存と一覧", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    await testDb.db.delete(iterations);
    await testDb.db.delete(nodes);
    await testDb.db.insert(nodes).values(["node-a", "node-b"].map((id) => ({
      id, kind: "app", title: id, summary: "テスト用の Node", status: "active",
      detailPath: "README.md", sourceRepo: `example/${id}`, sourceSha: "node-sha",
    })));
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("1 行作り、同じ Node と番号への保存では全ての対応列を更新する", async () => {
    await upsertIteration(testDb.db, "node-a", IterationManifestSchema.parse(validInput()));
    expect(await listIterations(testDb.db, "node-a")).toEqual([{
      nodeId: "node-a", number: 1, goal: validInput().goal, phase: "plan",
      stories: [story], bizScores: {}, result: null, prUrl: null, stats: {},
      startedAt: new Date(startedAt), finishedAt: null, sourceSha: null,
    }]);

    const manifest = IterationManifestSchema.parse({
      ...validInput(), goal: "保存を完了する", phase: "done",
      stories: [{ ...story, status: "done", biz: "accepted" }],
      biz_scores: { value: 4, usability: 3, coherence: 5 },
      result: "accepted", pr_url: "https://github.com/example/repo/pull/1",
      stats: { tokens: 120 }, started_at: "2026-10-13T00:10:00Z", finished_at: finishedAt,
    });
    await upsertIteration(testDb.db, "node-a", manifest);
    expect(await testDb.db.select().from(iterations)).toEqual([{
      nodeId: "node-a", number: 1, goal: manifest.goal, phase: manifest.phase,
      stories: manifest.stories, bizScores: manifest.biz_scores, result: manifest.result,
      prUrl: manifest.pr_url, stats: manifest.stats, startedAt: new Date(manifest.started_at),
      finishedAt: new Date(finishedAt), sourceSha: null,
    }]);
  });

  it("任意値の省略を反映し、既存の sourceSha には触らない", async () => {
    await upsertIteration(testDb.db, "node-a", IterationManifestSchema.parse({
      ...validInput(), result: "accepted", finished_at: finishedAt,
      pr_url: "https://example.com/pr/1", stats: { tokens: 1 }, biz_scores: { value: 5 },
    }));
    await testDb.db.update(iterations).set({ sourceSha: "existing-sha" })
      .where(eq(iterations.nodeId, "node-a"));
    await upsertIteration(testDb.db, "node-a", IterationManifestSchema.parse(validInput()));
    expect(await listIterations(testDb.db, "node-a")).toMatchObject([{
      result: null, finishedAt: null, prUrl: null, stats: {}, bizScores: {},
      sourceSha: "existing-sha",
    }]);
  });

  it("別の Node の同じ番号は別の行になり、指定した Node だけ番号の降順に並ぶ", async () => {
    for (const number of [2, 10, 1]) {
      await upsertIteration(testDb.db, "node-a", IterationManifestSchema.parse({ ...validInput(), number }));
    }
    await upsertIteration(testDb.db, "node-b", IterationManifestSchema.parse({ ...validInput(), goal: "別の Node" }));
    expect(await testDb.db.select().from(iterations)).toHaveLength(4);
    expect((await listIterations(testDb.db, "node-a")).map((row) => row.number)).toEqual([10, 2, 1]);
    expect(await listIterations(testDb.db, "node-b")).toMatchObject([{
      nodeId: "node-b", number: 1, goal: "別の Node",
    }]);
    expect(await listIterations(testDb.db, "unknown-node")).toEqual([]);
  });
});
