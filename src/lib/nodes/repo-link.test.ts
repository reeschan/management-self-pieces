import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type NewNodeRow, nodes } from "@/db/schema";
import { createFakeRepoSource } from "@/test/fake-repo-source";
import { createTestDb } from "@/test/pglite";

import { createRepoLinkService, type RepoKey } from "./repo-link";

const NOW = new Date("2026-10-14T01:00:00.000Z");
const EARLIER = new Date("2026-10-01T00:00:00.000Z");

describe("createRepoLinkService", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    await testDb.db.delete(nodes);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  type FakeRepos = Parameters<typeof createFakeRepoSource>[0];

  function makeService(repos: FakeRepos) {
    return createRepoLinkService({
      db: testDb.db,
      source: () => createFakeRepoSource(repos),
      now: () => NOW,
    });
  }

  async function insertNode(id: string, overrides: Partial<NewNodeRow> = {}) {
    await testDb.db.insert(nodes).values({
      id,
      kind: "app",
      title: id,
      summary: "概要",
      status: "active",
      createdAt: EARLIER,
      updatedAt: EARLIER,
      ...overrides,
    });
  }

  async function getNode(id: string) {
    const [row] = await testDb.db.select().from(nodes).where(eq(nodes.id, id));
    return row;
  }

  async function countNodes(): Promise<number> {
    const rows = await testDb.db.select({ id: nodes.id }).from(nodes);
    return rows.length;
  }

  describe("refreshAll", () => {
    it("リポジトリの名前の変更を、id で引いて反映する", async () => {
      await insertNode("a", { sourceRepo: "owner/old", repoId: 7 });
      // 名前 "owner/old" では引けないので、id で引けていなければ届かない印になる
      const service = makeService([{ id: 7, fullName: "owner/new" }]);

      const summary = await service.refreshAll();

      expect(summary).toEqual({
        checked: 1,
        updated: 1,
        unreachable: 0,
        failed: 0,
      });
      expect(await getNode("a")).toMatchObject({
        sourceRepo: "owner/new",
        repoId: 7,
        repoReachable: true,
      });
      expect((await getNode("a")).updatedAt).toEqual(NOW);
    });

    it("repoId が無い既存の Node に、名前で引いた id を埋める", async () => {
      await insertNode("a", { sourceRepo: "Owner/Repo", repoId: null });
      const service = makeService([{ id: 42, fullName: "owner/repo" }]);

      const summary = await service.refreshAll();

      expect(summary).toEqual({
        checked: 1,
        updated: 1,
        unreachable: 0,
        failed: 0,
      });
      expect(await getNode("a")).toMatchObject({
        sourceRepo: "owner/repo",
        repoId: 42,
        repoReachable: true,
      });
    });

    it("リポジトリが見つからなければ、届かない印を付ける", async () => {
      await insertNode("a", { sourceRepo: "owner/gone", repoId: 7 });
      await insertNode("b", { sourceRepo: "owner/gone2", repoId: null });
      const service = makeService([]);

      const summary = await service.refreshAll();

      expect(summary).toEqual({
        checked: 2,
        updated: 0,
        unreachable: 2,
        failed: 0,
      });
      expect(await getNode("a")).toMatchObject({
        sourceRepo: "owner/gone",
        repoId: 7,
        repoReachable: false,
      });
      expect(await getNode("b")).toMatchObject({
        sourceRepo: "owner/gone2",
        repoId: null,
        repoReachable: false,
      });
    });

    it("GitHub が例外なら、Node を変えず failed に数える", async () => {
      await insertNode("a", { sourceRepo: "owner/broken", repoId: 7 });
      const service = makeService([
        { id: 7, fullName: "owner/broken", throws: true },
      ]);

      const summary = await service.refreshAll();

      expect(summary).toEqual({
        checked: 1,
        updated: 0,
        unreachable: 0,
        failed: 1,
      });
      expect(await getNode("a")).toMatchObject({
        sourceRepo: "owner/broken",
        repoId: 7,
        repoReachable: true,
        updatedAt: EARLIER,
      });
    });

    it("届かない印の付いた Node が再び見つかれば、届く印に戻す", async () => {
      await insertNode("a", {
        sourceRepo: "owner/old",
        repoId: 7,
        repoReachable: false,
      });
      const service = makeService([{ id: 7, fullName: "owner/renamed" }]);

      const summary = await service.refreshAll();

      expect(summary).toEqual({
        checked: 1,
        updated: 1,
        unreachable: 0,
        failed: 0,
      });
      expect(await getNode("a")).toMatchObject({
        sourceRepo: "owner/renamed",
        repoId: 7,
        repoReachable: true,
      });
    });

    it("何も変わらなければ updated に数えず、updatedAt も変えない", async () => {
      await insertNode("a", { sourceRepo: "owner/repo", repoId: 7 });
      const service = makeService([{ id: 7, fullName: "owner/repo" }]);

      const summary = await service.refreshAll();

      expect(summary).toEqual({
        checked: 1,
        updated: 0,
        unreachable: 0,
        failed: 0,
      });
      expect((await getNode("a")).updatedAt).toEqual(EARLIER);
    });

    it("名前の変更が別の Node と重なるなら、更新せず failed に数える", async () => {
      await insertNode("a", { sourceRepo: "owner/old", repoId: 7 });
      await insertNode("b", { sourceRepo: "owner/b", repoId: 8 });
      const service = makeService([
        { id: 7, fullName: "owner/b" },
        { id: 8, fullName: "owner/b" },
      ]);

      const summary = await service.refreshAll();

      expect(summary).toEqual({
        checked: 2,
        updated: 0,
        unreachable: 0,
        failed: 1,
      });
      expect(await getNode("a")).toMatchObject({
        sourceRepo: "owner/old",
        repoId: 7,
        repoReachable: true,
        updatedAt: EARLIER,
      });
      expect(await getNode("b")).toMatchObject({
        sourceRepo: "owner/b",
        repoId: 8,
        repoReachable: true,
      });
    });

    it("埋めた repoId が別の Node と重なるなら、更新せず failed に数える", async () => {
      await insertNode("a", { sourceRepo: "owner/old", repoId: null });
      await insertNode("b", { sourceRepo: "owner/other", repoId: 8 });
      const service = makeService([{ id: 8, fullName: "owner/old" }]);

      const summary = await service.refreshAll();

      expect(summary).toEqual({
        checked: 2,
        updated: 0,
        unreachable: 0,
        failed: 2,
      });
      expect(await getNode("a")).toMatchObject({
        sourceRepo: "owner/old",
        repoId: null,
        updatedAt: EARLIER,
      });
      expect(await getNode("b")).toMatchObject({
        sourceRepo: "owner/other",
        repoId: 8,
        updatedAt: EARLIER,
      });
    });

    it("リポジトリの無い Node は確かめない", async () => {
      await insertNode("a", { sourceRepo: null, repoId: null });
      await insertNode("b", { sourceRepo: "owner/repo", repoId: 7 });
      const service = makeService([{ id: 7, fullName: "owner/repo" }]);

      const summary = await service.refreshAll();

      expect(summary).toEqual({
        checked: 1,
        updated: 0,
        unreachable: 0,
        failed: 0,
      });
      expect(await getNode("a")).toMatchObject({
        sourceRepo: null,
        repoId: null,
        repoReachable: true,
        updatedAt: EARLIER,
      });
    });
  });

  describe("refreshRepos", () => {
    it("指定したリポジトリの Node だけを確かめる", async () => {
      await insertNode("a", { sourceRepo: "owner/old", repoId: 7 });
      await insertNode("b", { sourceRepo: "other/repo", repoId: 8 });
      const service = makeService([{ id: 7, fullName: "owner/new" }]);
      const repos: RepoKey[] = [{ id: 7, fullName: "owner/new" }];

      const summary = await service.refreshRepos(repos);

      expect(summary).toEqual({
        checked: 1,
        updated: 1,
        unreachable: 0,
        failed: 0,
      });
      expect(await getNode("a")).toMatchObject({ sourceRepo: "owner/new" });
      // b は fake に無いので、確かめていれば届かない印が付いてしまう
      expect(await getNode("b")).toMatchObject({
        sourceRepo: "other/repo",
        repoReachable: true,
      });
    });

    it("repoId の無い Node は、名前の大文字小文字を無視して照合する", async () => {
      await insertNode("a", { sourceRepo: "Owner/Repo", repoId: null });
      await insertNode("b", { sourceRepo: "owner/other", repoId: null });
      const service = makeService([{ id: 42, fullName: "owner/repo" }]);
      const repos: RepoKey[] = [{ id: 42, fullName: "owner/repo" }];

      const summary = await service.refreshRepos(repos);

      expect(summary).toEqual({
        checked: 1,
        updated: 1,
        unreachable: 0,
        failed: 0,
      });
      expect(await getNode("a")).toMatchObject({
        sourceRepo: "owner/repo",
        repoId: 42,
      });
      expect(await getNode("b")).toMatchObject({
        sourceRepo: "owner/other",
        repoId: null,
      });
    });
  });

  describe("markUnreachable", () => {
    // markUnreachable は GitHub を呼んではいけないので、呼んだら例外になる source を渡す
    function makeThrowingService() {
      return createRepoLinkService({
        db: testDb.db,
        source: () => {
          throw new Error("GitHub を呼んではいけない");
        },
        now: () => NOW,
      });
    }

    it("id で一致する Node と、repoId の無い Node を名前で一致させて印を付ける", async () => {
      await insertNode("a", { sourceRepo: "owner/a", repoId: 1 });
      await insertNode("b", { sourceRepo: "Owner/B", repoId: null });
      await insertNode("c", { sourceRepo: "owner/c", repoId: 2 });
      const service = makeThrowingService();

      const marked = await service.markUnreachable([
        { id: 1, fullName: "irrelevant" },
        { id: 99, fullName: "owner/b" },
      ]);

      expect(marked).toBe(2);
      expect(await getNode("a")).toMatchObject({ repoReachable: false });
      expect(await getNode("b")).toMatchObject({ repoReachable: false });
      expect(await getNode("c")).toMatchObject({ repoReachable: true });
    });

    it("リポジトリの無い Node には印を付けない", async () => {
      await insertNode("a", { sourceRepo: null, repoId: null });
      await insertNode("b", { sourceRepo: "owner/repo", repoId: 7 });
      const service = makeThrowingService();

      const marked = await service.markUnreachable([
        { id: 7, fullName: "owner/repo" },
      ]);

      expect(marked).toBe(1);
      expect(await getNode("a")).toMatchObject({
        sourceRepo: null,
        repoId: null,
        repoReachable: true,
        updatedAt: EARLIER,
      });
      expect(await getNode("b")).toMatchObject({ repoReachable: false });
    });
  });

  it("どの操作でも Node の数が減らない", async () => {
    await insertNode("a", { sourceRepo: "owner/old", repoId: 7 });
    await insertNode("b", { sourceRepo: "owner/gone", repoId: null });
    await insertNode("c", { sourceRepo: null, repoId: null });
    await insertNode("d", { sourceRepo: "owner/broken", repoId: 9 });
    const service = makeService([
      { id: 7, fullName: "owner/new" },
      { id: 9, fullName: "owner/broken", throws: true },
    ]);

    await service.refreshAll();
    await service.refreshRepos([{ id: 7, fullName: "owner/new" }]);
    await service.markUnreachable([{ id: 7, fullName: "owner/new" }]);

    expect(await countNodes()).toBe(4);
    expect(await getNode("a")).toMatchObject({ repoReachable: false });
    expect(await getNode("b")).toMatchObject({ repoReachable: false });
    expect(await getNode("c")).toMatchObject({ repoReachable: true });
    expect(await getNode("d")).toMatchObject({ repoReachable: true });
  });
});
