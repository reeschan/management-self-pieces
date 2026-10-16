import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { nodes, relations, type NewNodeRow } from "@/db/schema";
import { createTestDb } from "@/test/pglite";

import { NodeServiceError } from "./service";
import { exportNodes, importNodes, previewImport } from "./transfer";

const now = new Date("2026-10-14T00:00:00.000Z");
const later = new Date("2026-10-15T09:30:00.000Z");
const originalCreatedAt = new Date("2026-01-01T00:00:00.000Z");

describe("transfer", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    // nodes を消せば relations も cascade で消える
    await testDb.db.delete(relations);
    await testDb.db.delete(nodes);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  /** DB に直接 Node を 1 件入れる */
  async function insertNode(overrides: { id: string } & Partial<NewNodeRow>) {
    await testDb.db.insert(nodes).values({
      kind: "doc",
      title: `タイトル ${overrides.id}`,
      summary: "",
      status: "active",
      ...overrides,
    });
  }

  async function allNodes() {
    return testDb.db.select().from(nodes);
  }

  async function allRelations() {
    return testDb.db.select().from(relations);
  }

  /** 書き出し JSON の 1 Node。既定はリポジトリ無しの最小形 */
  function fileNode(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id,
      kind: "doc",
      title: `タイトル ${id}`,
      summary: "",
      status: "active",
      tags: [],
      links: {},
      meta: {},
      detailPath: null,
      diagrams: [],
      repo: null,
      ...extra,
    };
  }

  /** 書き出し JSON のファイル */
  function file(
    nodeList: Record<string, unknown>[],
    relationList: { from: string; to: string; type: string }[] = [],
  ): Record<string, unknown> {
    return {
      version: 1,
      exportedAt: now.toISOString(),
      nodes: nodeList,
      relations: relationList,
    };
  }

  async function expectInvalid(promise: Promise<unknown>): Promise<void> {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(NodeServiceError);
    expect((error as NodeServiceError).code).toBe("invalid");
    // 利用者向けの日本語の message が入っている
    expect((error as NodeServiceError).message).not.toBe("");
  }

  describe("exportNodes", () => {
    it("Node は id の昇順、関係は from・to・type の昇順で返し、repo は sourceRepo から作る", async () => {
      await insertNode({ id: "b", sourceRepo: "me/b", repoId: 2 });
      await insertNode({ id: "a" });
      await insertNode({ id: "c", sourceRepo: "me/c", repoId: null });
      await testDb.db.insert(relations).values([
        { fromId: "b", toId: "c", type: "related" },
        { fromId: "a", toId: "c", type: "depends-on" },
        { fromId: "b", toId: "a", type: "uses" },
      ]);

      const exported = await exportNodes(testDb.db, () => now);

      expect(exported).toEqual({
        version: 1,
        exportedAt: now.toISOString(),
        nodes: [
          fileNode("a"),
          { ...fileNode("b"), repo: { id: 2, fullName: "me/b" } },
          { ...fileNode("c"), repo: { id: null, fullName: "me/c" } },
        ],
        relations: [
          { from: "a", to: "c", type: "depends-on" },
          { from: "b", to: "a", type: "uses" },
          { from: "b", to: "c", type: "related" },
        ],
      });
    });

    it("空の DB なら空のファイルを返す", async () => {
      expect(await exportNodes(testDb.db, () => now)).toEqual({
        version: 1,
        exportedAt: now.toISOString(),
        nodes: [],
        relations: [],
      });
    });
  });

  describe("previewImport", () => {
    it("DB に無い id を added、ある id を updated として数え、DB を変えない", async () => {
      await insertNode({ id: "a", title: "古いタイトル" });

      const preview = await previewImport(
        testDb.db,
        file([fileNode("a", { title: "新しいタイトル" }), fileNode("b")]),
      );

      expect(preview).toEqual({ ok: true, added: 1, updated: 1 });
      expect((await allNodes()).map((row) => row.id)).toEqual(["a"]);
    });

    it("壊れたファイルは ok: false とエラーの一覧を返す (パス: 理由)", async () => {
      const brokenShape = await previewImport(testDb.db, {
        version: 2,
        exportedAt: now.toISOString(),
        nodes: [],
        relations: [],
      });
      if (brokenShape.ok) throw new Error("エラーになるはずが通った");
      expect(brokenShape.errors.some((error) => error.startsWith("version: "))).toBe(true);

      const brokenRelation = await previewImport(
        testDb.db,
        file([fileNode("a")], [{ from: "a", to: "ghost", type: "uses" }]),
      );
      if (brokenRelation.ok) throw new Error("エラーになるはずが通った");
      expect(brokenRelation.errors.some((error) => error.startsWith("relations.0.to: "))).toBe(
        true,
      );

      expect((await previewImport(testDb.db, null)).ok).toBe(false);
    });
  });

  describe("importNodes", () => {
    it("書き出しを空の DB に読み込むと、同じ Node と関係が戻る (往復)", async () => {
      await insertNode({ id: "a" });
      await insertNode({ id: "b", sourceRepo: "me/b", repoId: 2 });
      await testDb.db.insert(relations).values([
        { fromId: "a", toId: "b", type: "uses" },
        { fromId: "b", toId: "a", type: "related" },
      ]);
      const first = await exportNodes(testDb.db, () => now);

      await testDb.db.delete(relations);
      await testDb.db.delete(nodes);
      expect(await importNodes(testDb.db, first, () => later)).toEqual({ added: 2, updated: 0 });

      const second = await exportNodes(testDb.db, () => later);
      expect(second).toEqual({ ...first, exportedAt: later.toISOString() });

      // 同じファイルをもう一度読み込んでも増えない
      expect(await importNodes(testDb.db, first, () => later)).toEqual({ added: 0, updated: 2 });
      expect(await exportNodes(testDb.db, () => later)).toEqual(second);
    });

    it("形が違うファイルは invalid で、何も書かない", async () => {
      await insertNode({ id: "keep" });

      await expectInvalid(
        importNodes(
          testDb.db,
          { version: 1, exportedAt: now.toISOString(), nodes: [{ id: "x" }], relations: [] },
          () => later,
        ),
      );
      await expectInvalid(
        importNodes(testDb.db, file([fileNode("dup")], [{ from: "dup", to: "dup", type: "nope" }]), () => later),
      );

      expect((await allNodes()).map((row) => row.id)).toEqual(["keep"]);
    });

    it("各 Node が NodeCreateInput の決まりに合わなければ invalid で、何も書かない", async () => {
      // リポジトリの無い Node は detailPath を持てない
      await expectInvalid(
        importNodes(testDb.db, file([fileNode("a", { detailPath: "README.md" })]), () => later),
      );
      // kind の meta の型が違う
      await expectInvalid(
        importNodes(
          testDb.db,
          file([fileNode("b", { kind: "app", meta: { url: "not a url" } })]),
          () => later,
        ),
      );

      expect(await allNodes()).toEqual([]);
    });

    it("関係の先か元がファイルにも DB にも無ければ invalid で、何も書かない", async () => {
      await expectInvalid(
        importNodes(
          testDb.db,
          file([fileNode("a")], [{ from: "a", to: "ghost", type: "uses" }]),
          () => later,
        ),
      );
      await expectInvalid(
        importNodes(
          testDb.db,
          file([fileNode("a")], [{ from: "ghost", to: "a", type: "uses" }]),
          () => later,
        ),
      );

      expect(await allNodes()).toEqual([]);
    });

    it("関係の先が DB にあれば読み込める", async () => {
      await insertNode({ id: "base" });

      const result = await importNodes(
        testDb.db,
        file([fileNode("app")], [{ from: "app", to: "base", type: "uses" }]),
        () => later,
      );

      expect(result).toEqual({ added: 1, updated: 0 });
      expect(await allRelations()).toEqual([{ fromId: "app", toId: "base", type: "uses" }]);
    });

    it("ファイルの中で id が重なれば invalid で、何も書かない", async () => {
      await expectInvalid(
        importNodes(testDb.db, file([fileNode("dup"), fileNode("dup")]), () => later),
      );
      expect(await allNodes()).toEqual([]);
    });

    it("ファイルの中でリポジトリが重なれば invalid (名前の大文字小文字は区別しない)", async () => {
      await expectInvalid(
        importNodes(
          testDb.db,
          file([
            fileNode("a", { repo: { id: 1, fullName: "me/Alpha" } }),
            fileNode("b", { repo: { id: null, fullName: "me/alpha" } }),
          ]),
          () => later,
        ),
      );
      await expectInvalid(
        importNodes(
          testDb.db,
          file([
            fileNode("a", { repo: { id: 1, fullName: "me/a" } }),
            fileNode("b", { repo: { id: 1, fullName: "me/b" } }),
          ]),
          () => later,
        ),
      );

      expect(await allNodes()).toEqual([]);
    });

    it("DB の別の Node が結び付いているリポジトリは invalid で、何も変えない", async () => {
      await insertNode({ id: "owner", sourceRepo: "me/x", repoId: 1 });

      // 名前が同じ (大文字小文字違い)
      await expectInvalid(
        importNodes(
          testDb.db,
          file([fileNode("thief", { repo: { id: 2, fullName: "ME/X" } })]),
          () => later,
        ),
      );
      // id が同じ (名前は違う)
      await expectInvalid(
        importNodes(
          testDb.db,
          file([fileNode("thief", { repo: { id: 1, fullName: "me/y" } })]),
          () => later,
        ),
      );

      expect((await allNodes()).map((row) => row.id)).toEqual(["owner"]);
    });

    it("同じ id の Node が同じリポジトリを持ち続けるのは読み込める", async () => {
      await insertNode({ id: "owner", sourceRepo: "me/x", repoId: 1 });

      const result = await importNodes(
        testDb.db,
        file([fileNode("owner", { repo: { id: 1, fullName: "me/x" } })]),
        () => later,
      );

      expect(result).toEqual({ added: 0, updated: 1 });
    });

    it("新規は repoReachable true・createdAt now、既存は repoReachable と createdAt を変えない", async () => {
      await insertNode({
        id: "old",
        title: "古いタイトル",
        sourceRepo: "me/old",
        repoId: 1,
        repoReachable: false,
        createdAt: originalCreatedAt,
        updatedAt: originalCreatedAt,
      });

      const result = await importNodes(
        testDb.db,
        file([
          fileNode("old", { title: "新しいタイトル", repo: { id: 1, fullName: "me/old" } }),
          fileNode("new", { repo: { id: 2, fullName: "me/new" } }),
        ]),
        () => later,
      );

      expect(result).toEqual({ added: 1, updated: 1 });
      const rows = await allNodes();
      expect(rows.find((row) => row.id === "old")).toMatchObject({
        title: "新しいタイトル",
        repoReachable: false,
        createdAt: originalCreatedAt,
        updatedAt: later,
      });
      expect(rows.find((row) => row.id === "new")).toMatchObject({
        repoReachable: true,
        createdAt: later,
        updatedAt: later,
        sourceRepo: "me/new",
        repoId: 2,
      });
    });

    it("ファイルに無い Node と関係は消さない", async () => {
      await insertNode({ id: "a", title: "古いタイトル" });
      await insertNode({ id: "b" });
      await testDb.db.insert(relations).values({ fromId: "a", toId: "b", type: "uses" });

      await importNodes(
        testDb.db,
        file([fileNode("a", { title: "新しいタイトル" })]),
        () => later,
      );

      expect((await allNodes()).map((row) => row.id).sort()).toEqual(["a", "b"]);
      expect(await allRelations()).toEqual([{ fromId: "a", toId: "b", type: "uses" }]);
      expect((await allNodes()).find((row) => row.id === "a")?.title).toBe("新しいタイトル");
    });
  });
});
