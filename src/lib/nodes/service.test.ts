import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  devProjects,
  devloopRuns,
  externalRefs,
  iterations,
  nodes,
  relations,
} from "@/db/schema";
import type { RepoSource } from "@/lib/github/types";
import { createFakeRepoSource, type FakeRepoInput } from "@/test/fake-repo-source";
import { createTestDb } from "@/test/pglite";

import { type NodeCreateInput } from "./input";
import { createNodeService, NodeServiceError, type NodeErrorCode } from "./service";

const now = new Date("2026-10-14T00:00:00.000Z");
const later = new Date("2026-10-15T09:30:00.000Z");

describe("createNodeService", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    // nodes を消せば relations・externalRefs・devProjects・devloopRuns・iterations も cascade で消える
    await testDb.db.delete(relations);
    await testDb.db.delete(nodes);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  function serviceWith(repos: FakeRepoInput[], clock: () => Date = () => now) {
    const source = createFakeRepoSource(repos);
    return createNodeService({ db: testDb.db, source: () => source, now: clock });
  }

  /** 最小限の入力。リポジトリの無い Node を作る */
  function repoLessInput(
    id: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id,
      kind: "doc",
      title: `タイトル ${id}`,
      summary: "概要",
      repo: null,
      ...extra,
    };
  }

  function repoInput(
    id: string,
    repo: { id: number | null; fullName: string },
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return { ...repoLessInput(id, extra), repo };
  }

  async function expectCode(promise: Promise<unknown>, code: NodeErrorCode) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(NodeServiceError);
    expect((error as NodeServiceError).code).toBe(code);
    // 利用者向けの日本語の message が入っている
    expect((error as NodeServiceError).message).not.toBe("");
  }

  async function nodeRow(id: string) {
    const rows = await testDb.db.select().from(nodes);
    return rows.find((row) => row.id === id);
  }

  describe("listCandidates", () => {
    it("どの Node にも結び付いていないリポジトリだけを返す", async () => {
      const service = serviceWith([
        { id: 1, fullName: "me/alpha" },
        { id: 2, fullName: "me/beta" },
        { id: 3, fullName: "me/gamma" },
      ]);
      await service.create(repoInput("alpha", { id: 1, fullName: "me/alpha" }));

      const candidates = await service.listCandidates();
      expect(candidates.map((repo) => repo.fullName)).toEqual(["me/beta", "me/gamma"]);
    });

    it("名前が大文字小文字だけ違っても、結び付き済みとして除く", async () => {
      // GitHub 側で repo id が変わった (作り直した) 想定: 名前だけが一致する
      const service = serviceWith([
        { id: 10, fullName: "Me/Alpha" },
        { id: 11, fullName: "me/other" },
      ]);
      await testDb.db.insert(nodes).values({
        id: "alpha",
        kind: "app",
        title: "alpha",
        summary: "",
        status: "active",
        sourceRepo: "me/alpha",
        repoId: 99,
      });

      const candidates = await service.listCandidates();
      expect(candidates.map((repo) => repo.fullName)).toEqual(["me/other"]);
    });

    it("名前が変わっていても repoId が一致すれば除く", async () => {
      const service = serviceWith([{ id: 5, fullName: "me/renamed" }]);
      await testDb.db.insert(nodes).values({
        id: "old",
        kind: "app",
        title: "old",
        summary: "",
        status: "active",
        sourceRepo: "me/old-name",
        repoId: 5,
      });

      expect(await service.listCandidates()).toEqual([]);
    });

    it("GitHub に届かなければ github_unavailable", async () => {
      const failing: RepoSource = {
        ...createFakeRepoSource([]),
        listRepos: () => Promise.reject(new Error("boom")),
      };
      const service = createNodeService({
        db: testDb.db,
        source: () => failing,
        now: () => now,
      });
      await expectCode(service.listCandidates(), "github_unavailable");
    });
  });

  describe("draftFromRepo", () => {
    it("リポジトリの情報から登録の初期値を作る", async () => {
      const service = serviceWith([
        {
          id: 42,
          fullName: "me/My_Cool.App",
          description: "説明文です",
          topics: ["nextjs", "tool"],
          homepage: "https://example.com/app",
          htmlUrl: "https://github.com/me/My_Cool.App",
          files: { "README.md": "# hello" },
        },
      ]);

      const draft = await service.draftFromRepo("me/My_Cool.App");
      expect(draft).toEqual({
        id: "my-cool-app",
        kind: "app",
        title: "My_Cool.App",
        summary: "説明文です",
        status: "active",
        tags: ["nextjs", "tool"],
        links: {
          repo: "https://github.com/me/My_Cool.App",
          homepage: "https://example.com/app",
        },
        meta: {},
        detailPath: "README.md",
        diagrams: [],
        relations: [],
        repo: { id: 42, fullName: "me/My_Cool.App" },
      } satisfies NodeCreateInput);
    });

    it("README が無ければ detailPath は null、description が無ければ summary は空、homepage が無ければ links は repo だけ", async () => {
      const service = serviceWith([{ id: 1, fullName: "me/plain" }]);
      const draft = await service.draftFromRepo("me/plain");
      expect(draft.detailPath).toBeNull();
      expect(draft.summary).toBe("");
      expect(draft.links).toEqual({ repo: "https://github.com/me/plain" });
    });

    it("summary は 200 文字で切り、id は 63 文字で切って前後のハイフンを除く", async () => {
      const longName = `__${"a".repeat(70)}__`;
      const service = serviceWith([
        { id: 1, fullName: `me/${longName}`, description: "あ".repeat(250) },
        { id: 2, fullName: "me/---" },
      ]);
      const draft = await service.draftFromRepo(`me/${longName}`);
      expect(draft.summary).toHaveLength(200);
      expect(draft.id).toBe("a".repeat(63));

      const empty = await service.draftFromRepo("me/---");
      expect(empty.id).toBe("node");
    });

    it("リポジトリが無ければ not_found", async () => {
      const service = serviceWith([]);
      await expectCode(service.draftFromRepo("me/missing"), "not_found");
    });

    it("GitHub に届かなければ github_unavailable", async () => {
      const service = serviceWith([{ id: 1, fullName: "me/down", throws: true }]);
      await expectCode(service.draftFromRepo("me/down"), "github_unavailable");
    });

    it("初期値はそのまま create に渡せる", async () => {
      const service = serviceWith([
        { id: 7, fullName: "me/ready", files: { "README.md": "x" } },
      ]);
      const draft = await service.draftFromRepo("me/ready");
      await expect(service.create(draft)).resolves.toEqual({ id: "ready" });
    });
  });

  describe("create", () => {
    it("リポジトリの無い Node を登録し、source を呼ばない", async () => {
      const spy = vi.fn(() => createFakeRepoSource([]));
      const service = createNodeService({ db: testDb.db, source: spy, now: () => now });

      await expect(service.create(repoLessInput("memo"))).resolves.toEqual({ id: "memo" });
      expect(spy).not.toHaveBeenCalled();

      const row = await nodeRow("memo");
      expect(row).toMatchObject({
        id: "memo",
        kind: "doc",
        title: "タイトル memo",
        status: "active",
        detailPath: null,
        sourceRepo: null,
        repoId: null,
        repoReachable: true,
        tags: [],
        links: {},
        diagrams: [],
        meta: {},
      });
      expect(row?.createdAt).toEqual(now);
      expect(row?.updatedAt).toEqual(now);
    });

    it("リポジトリのある Node と、その関係を登録する", async () => {
      const service = serviceWith([]);
      await service.create(repoLessInput("base"));
      await service.create(
        repoInput(
          "app-one",
          { id: 3, fullName: "me/app-one" },
          {
            kind: "app",
            detailPath: "README.md",
            diagrams: [{ path: "docs/a.svg", title: "構成" }],
            relations: [{ type: "uses", to: "base" }],
          },
        ),
      );

      const row = await nodeRow("app-one");
      expect(row).toMatchObject({
        sourceRepo: "me/app-one",
        repoId: 3,
        repoReachable: true,
        detailPath: "README.md",
        diagrams: [{ path: "docs/a.svg", title: "構成" }],
      });
      const edges = await testDb.db.select().from(relations);
      expect(edges).toEqual([{ fromId: "app-one", toId: "base", type: "uses" }]);
    });

    it("入力の形が誤っていれば invalid で、何も書かない", async () => {
      const service = serviceWith([]);
      await expectCode(service.create({ id: "Bad ID", kind: "doc" }), "invalid");
      await expectCode(service.create(repoLessInput("x", { kind: "nope" })), "invalid");
      await expectCode(service.create(repoLessInput("x", { title: "" })), "invalid");
      expect(await testDb.db.select().from(nodes)).toEqual([]);
    });

    it("自分自身への関係は invalid", async () => {
      const service = serviceWith([]);
      await expectCode(
        service.create(repoLessInput("self", { relations: [{ type: "related", to: "self" }] })),
        "invalid",
      );
    });

    it("リポジトリの無い Node に detailPath や diagrams があれば invalid", async () => {
      const service = serviceWith([]);
      await expectCode(
        service.create(repoLessInput("a", { detailPath: "README.md" })),
        "invalid",
      );
      await expectCode(
        service.create(repoLessInput("b", { diagrams: [{ path: "d.svg" }] })),
        "invalid",
      );
    });

    it("kind の meta の型が違えば invalid", async () => {
      const service = serviceWith([]);
      await expectCode(
        service.create(repoLessInput("app-bad", { kind: "app", meta: { url: "not a url" } })),
        "invalid",
      );
      await expectCode(
        service.create(repoLessInput("lib-bad", { kind: "library", meta: { packageName: 1 } })),
        "invalid",
      );
      // 未知のキーは許す
      await expect(
        service.create(repoLessInput("lib-ok", { kind: "library", meta: { extra: true } })),
      ).resolves.toEqual({ id: "lib-ok" });
    });

    it("同じ id があれば id_taken", async () => {
      const service = serviceWith([]);
      await service.create(repoLessInput("dup"));
      await expectCode(service.create(repoLessInput("dup")), "id_taken");
    });

    it("同じ repoId の Node があれば repo_taken", async () => {
      const service = serviceWith([]);
      await service.create(repoInput("first", { id: 1, fullName: "me/first" }));
      await expectCode(
        service.create(repoInput("second", { id: 1, fullName: "me/renamed" })),
        "repo_taken",
      );
    });

    it("名前が大文字小文字だけ違う Node があれば repo_taken", async () => {
      const service = serviceWith([]);
      await service.create(repoInput("first", { id: 1, fullName: "me/First" }));
      await expectCode(
        service.create(repoInput("second", { id: 2, fullName: "ME/first" })),
        "repo_taken",
      );
      await expectCode(
        service.create(repoInput("third", { id: null, fullName: "me/FIRST" })),
        "repo_taken",
      );
    });

    it("関係の先が無ければ relation_target_missing で、何も書かない", async () => {
      const service = serviceWith([]);
      await expectCode(
        service.create(repoLessInput("lonely", { relations: [{ type: "uses", to: "ghost" }] })),
        "relation_target_missing",
      );
      expect(await testDb.db.select().from(nodes)).toEqual([]);
    });
  });

  describe("update", () => {
    it("項目を更新し、関係を置き換え、id とリポジトリと createdAt は変えない", async () => {
      const created = serviceWith([]);
      await created.create(repoLessInput("a"));
      await created.create(repoLessInput("b"));
      await created.create(
        repoInput(
          "target",
          { id: 9, fullName: "me/target" },
          { relations: [{ type: "uses", to: "a" }] },
        ),
      );

      const service = serviceWith([], () => later);
      await service.update("target", {
        kind: "library",
        title: "新しいタイトル",
        summary: "新しい概要",
        status: "maintenance",
        tags: ["x"],
        links: { site: "https://example.com" },
        meta: { packageName: "pkg" },
        detailPath: "docs/index.md",
        diagrams: [{ path: "docs/d.svg" }],
        relations: [{ type: "depends-on", to: "b" }],
        // id とリポジトリを渡しても変わらない
        id: "other",
        repo: { id: 1, fullName: "me/other" },
      });

      const row = await nodeRow("target");
      expect(row).toMatchObject({
        id: "target",
        kind: "library",
        title: "新しいタイトル",
        summary: "新しい概要",
        status: "maintenance",
        tags: ["x"],
        links: { site: "https://example.com" },
        meta: { packageName: "pkg" },
        detailPath: "docs/index.md",
        diagrams: [{ path: "docs/d.svg" }],
        sourceRepo: "me/target",
        repoId: 9,
        repoReachable: true,
      });
      expect(row?.createdAt).toEqual(now);
      expect(row?.updatedAt).toEqual(later);
      expect(await nodeRow("other")).toBeUndefined();

      const edges = await testDb.db.select().from(relations);
      expect(edges).toEqual([{ fromId: "target", toId: "b", type: "depends-on" }]);
    });

    it("無い id なら not_found", async () => {
      const service = serviceWith([]);
      await expectCode(
        service.update("ghost", { kind: "doc", title: "t", summary: "" }),
        "not_found",
      );
    });

    it("不正な入力は invalid で、元の Node を変えない", async () => {
      const service = serviceWith([]);
      await service.create(repoLessInput("keep"));

      await expectCode(service.update("keep", { kind: "doc", title: "" }), "invalid");
      await expectCode(
        service.update("keep", {
          kind: "doc",
          title: "t",
          relations: [{ type: "related", to: "keep" }],
        }),
        "invalid",
      );
      // リポジトリの無い Node には詳細のファイルを足せない
      await expectCode(
        service.update("keep", { kind: "doc", title: "t", detailPath: "README.md" }),
        "invalid",
      );
      expect((await nodeRow("keep"))?.title).toBe("タイトル keep");
    });

    it("関係の先が無ければ relation_target_missing で、元の関係を残す", async () => {
      const service = serviceWith([]);
      await service.create(repoLessInput("a"));
      await service.create(
        repoLessInput("b", { relations: [{ type: "uses", to: "a" }] }),
      );

      await expectCode(
        service.update("b", {
          kind: "doc",
          title: "t",
          relations: [{ type: "uses", to: "ghost" }],
        }),
        "relation_target_missing",
      );
      const edges = await testDb.db.select().from(relations);
      expect(edges).toEqual([{ fromId: "b", toId: "a", type: "uses" }]);
    });

    it("向いた関係は消さない", async () => {
      const service = serviceWith([]);
      await service.create(repoLessInput("a"));
      await service.create(
        repoLessInput("b", { relations: [{ type: "uses", to: "a" }] }),
      );

      await service.update("a", { kind: "doc", title: "更新", summary: "" });
      const edges = await testDb.db.select().from(relations);
      expect(edges).toEqual([{ fromId: "b", toId: "a", type: "uses" }]);
    });
  });

  describe("deletionBlockers / remove", () => {
    it("記録が無ければ blockers は空", async () => {
      const service = serviceWith([]);
      await service.create(repoLessInput("clean"));
      expect(await service.deletionBlockers("clean")).toEqual([]);
    });

    it("Asana との対応があれば asana", async () => {
      const service = serviceWith([]);
      await service.create(repoLessInput("with-asana"));
      await testDb.db.insert(externalRefs).values({
        nodeId: "with-asana",
        provider: "asana",
        externalId: "123",
      });
      expect(await service.deletionBlockers("with-asana")).toEqual(["asana"]);
    });

    it("devloop の記録があれば devloop (dev_projects・devloop_runs・iterations のどれでも)", async () => {
      const service = serviceWith([]);
      await service.create(repoLessInput("proj"));
      await service.create(repoLessInput("run"));
      await service.create(repoLessInput("iter"));
      await testDb.db.insert(devProjects).values({ nodeId: "proj" });
      await testDb.db.insert(devloopRuns).values({
        id: "run-1",
        nodeId: "run",
        phase: "plan",
        status: "succeeded",
      });
      await testDb.db.insert(iterations).values({
        nodeId: "iter",
        number: 1,
        goal: "g",
        phase: "done",
      });

      expect(await service.deletionBlockers("proj")).toEqual(["devloop"]);
      expect(await service.deletionBlockers("run")).toEqual(["devloop"]);
      expect(await service.deletionBlockers("iter")).toEqual(["devloop"]);
    });

    it("両方あれば asana と devloop の両方", async () => {
      const service = serviceWith([]);
      await service.create(repoLessInput("both"));
      await testDb.db.insert(externalRefs).values({
        nodeId: "both",
        provider: "asana",
        externalId: "9",
      });
      await testDb.db.insert(devProjects).values({ nodeId: "both" });
      expect(await service.deletionBlockers("both")).toEqual(["asana", "devloop"]);
    });

    it("blockers があれば remove は has_records で、Node を残す", async () => {
      const service = serviceWith([]);
      await service.create(repoLessInput("guarded"));
      await testDb.db.insert(devProjects).values({ nodeId: "guarded" });

      await expectCode(service.remove("guarded"), "has_records");
      expect(await nodeRow("guarded")).toBeDefined();
    });

    it("無い id の remove は not_found", async () => {
      const service = serviceWith([]);
      await expectCode(service.remove("ghost"), "not_found");
    });

    it("remove は Node を消し、出る関係も向いた関係も消す", async () => {
      const service = serviceWith([]);
      await service.create(repoLessInput("a"));
      await service.create(repoLessInput("b", { relations: [{ type: "uses", to: "a" }] }));
      await service.create(
        repoLessInput("c", {
          relations: [
            { type: "related", to: "b" },
            { type: "part-of", to: "a" },
          ],
        }),
      );

      await service.remove("b");
      expect(await nodeRow("b")).toBeUndefined();
      const edges = await testDb.db.select().from(relations);
      expect(edges).toEqual([{ fromId: "c", toId: "a", type: "part-of" }]);
    });
  });
});
