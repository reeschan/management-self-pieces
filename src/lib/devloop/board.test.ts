import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { externalRefs, nodes, taskCache } from "@/db/schema";
import { createFakeTracker, type FakeTracker } from "@/test/fake-tracker";
import { createTestDb } from "@/test/pglite";

import {
  BoardError,
  BoardLimitError,
  createBoardService,
  LIMITS,
  SECTIONS,
  type Section,
} from "./board";
import { buildItemNotes, parseItemNotes } from "./item-meta";
import { findCachedItem } from "./task-cache";

const now = new Date("2026-10-14T00:00:00.000Z");
const OWNER_GID = "owner-gid";

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

describe("board", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let tracker: FakeTracker;
  let board: ReturnType<typeof createBoardService>;
  /** Node ごとの Asana のプロジェクトの gid */
  let projects: Record<"n1" | "n2", string>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    await testDb.db.delete(taskCache);
    await testDb.db.delete(externalRefs);
    await testDb.db.delete(nodes);
    await testDb.db
      .insert(nodes)
      .values([makeNode("n1"), makeNode("n2"), makeNode("n3")]);

    tracker = createFakeTracker({ now: () => now });
    const p1 = await tracker.createProject({ id: "n1", title: "n1", summary: "" });
    const p2 = await tracker.createProject({ id: "n2", title: "n2", summary: "" });
    projects = { n1: p1.externalId, n2: p2.externalId };
    // n3 は Asana につながっていない
    await testDb.db.insert(externalRefs).values([
      { nodeId: "n1", provider: "asana", externalId: projects.n1 },
      { nodeId: "n2", provider: "asana", externalId: projects.n2 },
    ]);

    board = createBoardService({
      db: testDb.db,
      tracker,
      ownerAssigneeId: OWNER_GID,
      now: () => now,
    });
  });

  afterAll(async () => {
    await testDb?.close();
  });

  function sectionId(node: "n1" | "n2", section: Section): string {
    const found = tracker.state.sections
      .get(projects[node])
      ?.find((s) => s.name === section);
    if (!found) throw new Error(`列が無い: ${section}`);
    return found.externalId;
  }

  /** 写しを通さずに Asana (偽物) へ直接項目を入れる */
  async function seed(
    node: "n1" | "n2",
    section: Section,
    count: number,
    notes = "",
  ): Promise<string[]> {
    await board.ensureSections(node);
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const task = await tracker.createTask(projects[node], {
        name: `${section} ${i}`,
        notes,
        sectionId: sectionId(node, section),
      });
      ids.push(task.externalId);
    }
    return ids;
  }

  function codeOf(promise: Promise<unknown>) {
    return promise.then(
      () => "resolved",
      (error: unknown) =>
        error instanceof BoardError || error instanceof BoardLimitError
          ? error.code
          : `unexpected: ${String(error)}`,
    );
  }

  describe("ensureSections", () => {
    it("8 列を作り、2 回目は何も足さない", async () => {
      const first = await board.ensureSections("n1");
      expect(first.projectId).toBe(projects.n1);
      expect(first.created).toEqual([...SECTIONS]);
      expect(
        (await tracker.listSections(projects.n1)).map((s) => s.name),
      ).toEqual([...SECTIONS]);

      const second = await board.ensureSections("n1");
      expect(second.created).toEqual([]);
      expect(await tracker.listSections(projects.n1)).toHaveLength(8);
    });

    it("足りない列だけを作る", async () => {
      await tracker.createSection(projects.n1, "Inbox");
      await tracker.createSection(projects.n1, "Untitled section");
      const result = await board.ensureSections("n1");
      expect(result.created).toEqual(SECTIONS.filter((s) => s !== "Inbox"));
      expect(await tracker.listSections(projects.n1)).toHaveLength(9);
    });

    it("リンクが無い Node は not_linked", async () => {
      expect(await codeOf(board.ensureSections("n3"))).toBe("not_linked");
      expect(await codeOf(board.getBoard("n3"))).toBe("not_linked");
    });
  });

  describe("createItem", () => {
    it("ID を種類ごとに連番で振り、タグを付け、写しに入れる", async () => {
      const s1 = await board.createItem("n1", {
        section: "Inbox",
        name: "話 1",
        body: "本文",
        type: "story",
        origin: "pm",
        meta: { value: 3 },
      });
      const s2 = await board.createItem("n1", {
        section: "Backlog",
        name: "話 2",
        body: "",
        type: "story",
        origin: "tl",
      });
      const b1 = await board.createItem("n1", {
        section: "Inbox",
        name: "不具合",
        body: "",
        type: "bug",
        origin: "owner",
      });

      expect(s1.meta).toEqual({ id: "S-0001", value: 3 });
      expect(s1.body).toBe("本文");
      expect(s1.section).toBe("Inbox");
      expect(s1.tags).toEqual(["story", "from:pm"]);
      expect(s1.ownerComments).toEqual([]);
      expect(s2.meta?.id).toBe("S-0002");
      expect(s2.tags).toEqual(["story", "from:tl"]);
      expect(b1.meta?.id).toBe("B-0001");
      expect(b1.tags).toEqual(["bug", "from:owner"]);

      expect(await findCachedItem(testDb.db, s2.id)).toEqual({
        nodeId: "n1",
        projectExternalId: projects.n1,
        section: "Backlog",
      });
    });

    it("meta の id が渡されればそれを使う", async () => {
      const item = await board.createItem("n1", {
        section: "Backlog",
        name: "指定",
        body: "",
        type: "chore",
        origin: "pm",
        meta: { id: "C-0042" },
      });
      expect(item.meta?.id).toBe("C-0042");
    });

    it(`Inbox が ${LIMITS.inbox} 件なら inbox_full。owner の出どころは免れる`, async () => {
      await seed("n1", "Inbox", LIMITS.inbox);
      const input = {
        section: "Inbox" as const,
        name: "あふれ",
        body: "",
        type: "story" as const,
      };
      expect(
        await codeOf(board.createItem("n1", { ...input, origin: "pm" })),
      ).toBe("inbox_full");
      // Inbox 以外の列に作るときも、Inbox があふれていれば断る (R と同じ)
      expect(
        await codeOf(
          board.createItem("n1", { ...input, section: "Backlog", origin: "tl" }),
        ),
      ).toBe("inbox_full");
      const owned = await board.createItem("n1", { ...input, origin: "owner" });
      expect(owned.section).toBe("Inbox");
    });

    it("同じイテレーションの Biz の提案の 4 件目は biz_proposal_limit", async () => {
      const propose = (iteration: number) =>
        board.createItem("n1", {
          section: "Biz Review",
          name: `提案 ${iteration}`,
          body: "",
          type: "experiment",
          origin: "biz",
          meta: { iteration },
        });
      for (let i = 0; i < LIMITS.bizProposalsPerIteration; i++) {
        await propose(2);
      }
      expect(await codeOf(propose(2))).toBe("biz_proposal_limit");
      // 別のイテレーションなら作れる
      expect((await propose(3)).meta?.iteration).toBe(3);
    });

    it("Sprint の上限で sprint_full", async () => {
      await seed("n1", "Sprint", 2);
      const input = {
        section: "Sprint" as const,
        name: "追加",
        body: "",
        type: "story" as const,
        origin: "tl" as const,
      };
      expect(
        await codeOf(board.createItem("n1", { ...input, sprintLimit: 2 })),
      ).toBe("sprint_full");
      const ok = await board.createItem("n1", { ...input, sprintLimit: 3 });
      expect(ok.section).toBe("Sprint");
    });
  });

  describe("moveItem", () => {
    it("Sprint の上限を守り、移す項目自身は数えない", async () => {
      const [a, b] = await seed("n1", "Sprint", 2);
      const [c] = await seed("n1", "Backlog", 1);

      expect(
        await codeOf(board.moveItem("n1", c, "Sprint", { sprintLimit: 2 })),
      ).toBe("sprint_full");
      // すでに Sprint にある項目は自身を数えないので動かせる
      await board.moveItem("n1", a, "Sprint", { sprintLimit: 2 });
      // 1 件出せば入れられる
      await board.moveItem("n1", b, "In Progress", { sprintLimit: 2 });
      await board.moveItem("n1", c, "Sprint", { sprintLimit: 2 });

      expect((await findCachedItem(testDb.db, c))?.section).toBe("Sprint");
      expect((await findCachedItem(testDb.db, b))?.section).toBe("In Progress");
    });

    it("Done に移しても完了にしない", async () => {
      const [a] = await seed("n1", "In Progress", 1);
      await board.moveItem("n1", a, "Done");
      const task = await tracker.getTask(a);
      expect(task.sectionName).toBe("Done");
      expect(task.completed).toBe(false);
    });

    it("写しに無くても、Asana にあれば読み直して動かす", async () => {
      const [a] = await seed("n1", "Backlog", 1);
      expect(await findCachedItem(testDb.db, a)).toBeNull();
      await board.moveItem("n1", a, "Inbox");
      expect((await findCachedItem(testDb.db, a))?.section).toBe("Inbox");
    });

    it("別の Node の項目は node_mismatch", async () => {
      const [other] = await seed("n2", "Backlog", 1);
      await board.getBoard("n2");
      await board.ensureSections("n1");
      expect(await codeOf(board.moveItem("n1", other, "Sprint"))).toBe(
        "node_mismatch",
      );
      expect((await tracker.getTask(other)).sectionName).toBe("Backlog");
    });

    it("写しにも Asana にも無い項目は not_found", async () => {
      await board.ensureSections("n1");
      expect(await codeOf(board.moveItem("n1", "missing", "Sprint"))).toBe(
        "not_found",
      );
    });
  });

  describe("updateItem", () => {
    it("meta を丸ごと置き換え、本文は残す", async () => {
      const item = await board.createItem("n1", {
        section: "Backlog",
        name: "元",
        body: "元の本文",
        type: "story",
        origin: "pm",
        meta: { value: 3, hypothesis: "仮説", iteration: 1 },
      });

      const updated = await board.updateItem(item.id, {
        meta: { id: "S-0001", effort: 2 },
      });
      expect(updated.meta).toEqual({ id: "S-0001", effort: 2 });
      expect(updated.body).toBe("元の本文");

      const stored = parseItemNotes((await tracker.getTask(item.id)).notes);
      expect(stored.meta).toEqual({ id: "S-0001", effort: 2 });
      expect(stored.body).toBe("元の本文");

      const [row] = await testDb.db.select().from(taskCache);
      expect(row.meta).toEqual({ id: "S-0001", effort: 2 });
    });

    it("本文と名前だけを変えると meta は今のまま", async () => {
      const item = await board.createItem("n1", {
        section: "Backlog",
        name: "元",
        body: "元の本文",
        type: "bug",
        origin: "tl",
        meta: { value: 5 },
      });
      const updated = await board.updateItem(item.id, {
        nodeId: "n1",
        name: "新",
        body: "新しい本文",
      });
      expect(updated.name).toBe("新");
      expect(updated.body).toBe("新しい本文");
      expect(updated.meta).toEqual({ id: "B-0001", value: 5 });
    });

    it("nodeId が違えば node_mismatch、無い項目は not_found", async () => {
      const item = await board.createItem("n2", {
        section: "Backlog",
        name: "n2 の項目",
        body: "",
        type: "story",
        origin: "pm",
      });
      expect(
        await codeOf(board.updateItem(item.id, { nodeId: "n1", name: "x" })),
      ).toBe("node_mismatch");
      expect(await codeOf(board.updateItem("missing", { name: "x" }))).toBe(
        "not_found",
      );
    });
  });

  describe("commentItem", () => {
    it("コメントを付け、nodeId が違えば node_mismatch", async () => {
      const [a] = await seed("n1", "Backlog", 1);
      await board.commentItem(a, "進めます", { nodeId: "n1" });
      expect((await tracker.listComments(a)).map((c) => c.text)).toEqual([
        "[devloop] 進めます",
      ]);
      // 写しに入ったので nodeId なしでも引ける
      await board.commentItem(a, "続き");
      expect(await codeOf(board.commentItem(a, "x", { nodeId: "n2" }))).toBe(
        "node_mismatch",
      );
    });
  });

  describe("getBoard", () => {
    it("列ごとにまとめ、写しを保存する", async () => {
      const [inbox] = await seed("n1", "Inbox", 1, buildItemNotes("本文", { id: "S-0001" }));
      const [sprint1, sprint2] = await seed("n1", "Sprint", 2);
      await tracker.createSection(projects.n1, "Untitled section");
      await tracker.createTask(projects.n1, {
        name: "既定の列",
        sectionId: (await tracker.listSections(projects.n1)).find(
          (s) => s.name === "Untitled section",
        )!.externalId,
      });

      const result = await board.getBoard("n1");
      expect(result.projectId).toBe(projects.n1);
      expect(result.columns.map((c) => c.section)).toEqual([
        ...SECTIONS,
        "Untitled section",
      ]);
      const bySection = Object.fromEntries(
        result.columns.map((c) => [c.section, c.items.map((i) => i.id)]),
      );
      expect(bySection.Inbox).toEqual([inbox]);
      expect(bySection.Sprint).toEqual([sprint1, sprint2]);
      expect(bySection.Backlog).toEqual([]);
      expect(bySection["Untitled section"]).toHaveLength(1);

      const inboxItem = result.columns[0].items[0];
      expect(inboxItem.meta).toEqual({ id: "S-0001" });
      expect(inboxItem.body).toBe("本文");

      expect(await testDb.db.select().from(taskCache)).toHaveLength(4);
    });

    it("sections で列を絞れる", async () => {
      await seed("n1", "Inbox", 1);
      const [sprint] = await seed("n1", "Sprint", 1);
      const result = await board.getBoard("n1", { sections: ["Sprint", "Done"] });
      expect(result.columns.map((c) => c.section)).toEqual(["Sprint", "Done"]);
      expect(result.columns[0].items.map((i) => i.id)).toEqual([sprint]);
      expect(result.columns[1].items).toEqual([]);
      // 写しは絞らずに全部入れる
      expect(await testDb.db.select().from(taskCache)).toHaveLength(2);
    });

    it("「Owner 判断」の項目だけに Owner のコメントを付ける", async () => {
      const [decision] = await seed("n1", "Owner 判断", 1);
      const [backlog] = await seed("n1", "Backlog", 1);
      tracker.state.addCommentAs(decision, "持ち主の答え", OWNER_GID);
      tracker.state.addCommentAs(decision, "[from:owner] 画面からの答え", null);
      tracker.state.addCommentAs(decision, "他の人のコメント", "someone");
      await tracker.addComment(decision, "エージェントのコメント");
      tracker.state.addCommentAs(backlog, "Backlog への持ち主のコメント", OWNER_GID);

      const listComments = vi.spyOn(tracker, "listComments");
      const result = await board.getBoard("n1");
      const items = result.columns.flatMap((c) => c.items);

      expect(items.find((i) => i.id === decision)?.ownerComments).toEqual([
        { text: "持ち主の答え", createdAt: now.toISOString() },
        { text: "[from:owner] 画面からの答え", createdAt: now.toISOString() },
      ]);
      expect(items.find((i) => i.id === backlog)?.ownerComments).toEqual([]);
      // コメントは「Owner 判断」の項目の分だけ読む
      expect(listComments).toHaveBeenCalledTimes(1);
      expect(listComments).toHaveBeenCalledWith(decision);
    });

    it("ownerAssigneeId が無ければ [from:owner] の印だけを Owner のものとみなす", async () => {
      const noOwner = createBoardService({ db: testDb.db, tracker, now: () => now });
      const [decision] = await seed("n1", "Owner 判断", 1);
      tracker.state.addCommentAs(decision, "持ち主の答え", OWNER_GID);
      tracker.state.addCommentAs(decision, "[from:owner] 了承", null);
      const result = await noOwner.getBoard("n1", { sections: ["Owner 判断"] });
      expect(result.columns[0].items[0].ownerComments.map((c) => c.text)).toEqual([
        "[from:owner] 了承",
      ]);
    });
  });

  describe("requestOwner", () => {
    it("元の項目が無ければ「Owner 判断」に持ち主の担当で起票する", async () => {
      const { task, movedItemId } = await board.requestOwner("n1", {
        title: "方針を決めたい",
        reason: "理由",
      });
      expect(movedItemId).toBeNull();
      const detail = await tracker.getTask(task.externalId);
      expect(detail.sectionName).toBe("Owner 判断");
      expect(detail.assigneeId).toBe(OWNER_GID);
      expect(detail.notes).toBe("理由");
      expect((await findCachedItem(testDb.db, task.externalId))?.section).toBe(
        "Owner 判断",
      );
    });

    it("元の項目を notes で紐づけ、「Owner 判断」へ移してコメントする", async () => {
      const item = await board.createItem("n1", {
        section: "Backlog",
        name: "元の項目",
        body: "",
        type: "story",
        origin: "pm",
      });
      const { task, movedItemId } = await board.requestOwner("n1", {
        title: "やってよいか",
        reason: "費用がかかる",
        itemId: item.id,
      });
      expect(movedItemId).toBe(item.id);
      expect((await tracker.getTask(task.externalId)).notes).toBe(
        `費用がかかる\n\n対象の項目: ${item.id}`,
      );
      expect((await tracker.getTask(item.id)).sectionName).toBe("Owner 判断");
      expect((await tracker.listComments(item.id)).map((c) => c.text)).toEqual([
        `[devloop] Owner 判断を依頼しました: やってよいか (${task.externalId})`,
      ]);
      expect((await findCachedItem(testDb.db, item.id))?.section).toBe(
        "Owner 判断",
      );
    });

    it("別の Node の項目は起票せずに node_mismatch", async () => {
      const other = await board.createItem("n2", {
        section: "Backlog",
        name: "n2",
        body: "",
        type: "story",
        origin: "pm",
      });
      await board.ensureSections("n1");
      expect(
        await codeOf(
          board.requestOwner("n1", { title: "t", reason: "r", itemId: other.id }),
        ),
      ).toBe("node_mismatch");
      expect(await tracker.listTasks(projects.n1)).toEqual([]);
    });
  });

  describe("answerOwner", () => {
    it("[from:owner] の印を付けてコメントし、看板の Owner のコメントに出る", async () => {
      const { task } = await board.requestOwner("n1", {
        title: "判断",
        reason: "理由",
      });
      await board.answerOwner("n1", task.externalId, "進めてよい");
      expect(
        (await tracker.listComments(task.externalId)).map((c) => c.text),
      ).toEqual(["[from:owner] 進めてよい"]);

      const result = await board.getBoard("n1", { sections: ["Owner 判断"] });
      expect(result.columns[0].items[0].ownerComments.map((c) => c.text)).toEqual([
        "[from:owner] 進めてよい",
      ]);
    });

    it("別の Node の項目は node_mismatch、無い項目は not_found", async () => {
      const { task } = await board.requestOwner("n2", {
        title: "判断",
        reason: "理由",
      });
      await board.ensureSections("n1");
      expect(await codeOf(board.answerOwner("n1", task.externalId, "x"))).toBe(
        "node_mismatch",
      );
      expect(await codeOf(board.answerOwner("n1", "missing", "x"))).toBe(
        "not_found",
      );
      expect(await tracker.listComments(task.externalId)).toEqual([]);
    });
  });

  describe("アプリのコメントの作成者が持ち主になるとき (本番の Asana と同じ)", () => {
    beforeEach(() => {
      // アプリは持ち主の PAT で書き込むので、アプリのコメントの作成者も持ち主になる
      tracker.addComment = async (id, text) =>
        tracker.state.addCommentAs(id, text, OWNER_GID);
    });

    async function ownerTexts(itemId: string): Promise<string[]> {
      const result = await board.getBoard("n1", { sections: ["Owner 判断"] });
      const item = result.columns[0].items.find((i) => i.id === itemId);
      if (!item) throw new Error(`「Owner 判断」に項目が無い: ${itemId}`);
      return item.ownerComments.map((c) => c.text);
    }

    it("commentItem と requestOwner のコメントは ownerComments に入らない", async () => {
      const item = await board.createItem("n1", {
        section: "Backlog",
        name: "元の項目",
        body: "",
        type: "story",
        origin: "pm",
      });
      await board.commentItem(item.id, "調べました");
      await board.requestOwner("n1", { title: "判断", reason: "理由", itemId: item.id });

      expect((await tracker.listComments(item.id)).map((c) => c.authorId)).toEqual([
        OWNER_GID,
        OWNER_GID,
      ]);
      expect(await ownerTexts(item.id)).toEqual([]);
    });

    it("commentItem の本文を [from:owner] で始めても ownerComments に入らない", async () => {
      const [decision] = await seed("n1", "Owner 判断", 1);
      await board.commentItem(decision, "[from:owner] 進めてよい", { nodeId: "n1" });
      await board.commentItem(decision, "  [from:owner] 空白付き");
      expect(await ownerTexts(decision)).toEqual([]);
    });

    it("answerOwner のコメントは ownerComments に入る", async () => {
      const { task } = await board.requestOwner("n1", { title: "判断", reason: "理由" });
      await board.answerOwner("n1", task.externalId, "進めてよい");
      expect(await ownerTexts(task.externalId)).toEqual(["[from:owner] 進めてよい"]);
    });

    it("持ち主が Asana で直接付けた印の無いコメントは ownerComments に入る", async () => {
      const [decision] = await seed("n1", "Owner 判断", 1);
      await board.commentItem(decision, "エージェントのコメント", { nodeId: "n1" });
      tracker.state.addCommentAs(decision, "Asana からの答え", OWNER_GID);
      expect(await ownerTexts(decision)).toEqual(["Asana からの答え"]);
    });

    it("Asana に送る本文の先頭は [devloop] で、commentItem の本文の先頭の空白は除く", async () => {
      const item = await board.createItem("n1", {
        section: "Backlog",
        name: "元の項目",
        body: "",
        type: "story",
        origin: "pm",
      });
      await board.commentItem(item.id, "  [from:owner] 進めてよい");
      const { task } = await board.requestOwner("n1", {
        title: "判断",
        reason: "理由",
        itemId: item.id,
      });
      expect((await tracker.listComments(item.id)).map((c) => c.text)).toEqual([
        "[devloop] [from:owner] 進めてよい",
        `[devloop] Owner 判断を依頼しました: 判断 (${task.externalId})`,
      ]);
    });
  });
});
