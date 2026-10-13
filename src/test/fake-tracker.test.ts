import { describe, expect, test } from "vitest";
import { createFakeTracker } from "./fake-tracker";

const node = { id: "node-1", title: "成果物", summary: "説明" };

describe("メモリ上の Tracker", () => {
  test("プロジェクトの説明から Node を探し、存在しなければ null を返す", async () => {
    const tracker = createFakeTracker();
    expect(await tracker.findProjectByNodeId(node.id)).toBeNull();
    const project = await tracker.createProject(node);
    expect(project).toEqual({
      provider: tracker.id,
      externalId: "fake-1",
      url: null,
    });
    expect(tracker.state.projects.get(project.externalId)).toEqual({
      name: node.title,
      notes: "説明\n\npiece-node-id: node-1",
    });
    expect(await tracker.findProjectByNodeId(node.id)).toEqual(project);
    tracker.state.projects.set("external-project", {
      name: "直接追加",
      notes: "piece-node-id: node-2",
    });
    expect(await tracker.findProjectByNodeId("node-2")).toMatchObject({
      externalId: "external-project",
    });
    expect(await tracker.findProjectByNodeId("node-3")).toBeNull();
  });

  test("セクションを作成順に、プロジェクトごとに一覧する", async () => {
    const tracker = createFakeTracker();
    const { externalId: projectId } = await tracker.createProject(node);
    const other = await tracker.createProject({ ...node, id: "node-2" });
    expect(await tracker.listSections(projectId)).toEqual([]);
    const inbox = await tracker.createSection(projectId, "Inbox");
    const sprint = await tracker.createSection(projectId, "Sprint");
    await tracker.createSection(other.externalId, "Done");
    expect(await tracker.listSections(projectId)).toEqual([inbox, sprint]);
    expect(tracker.state.sections.get(projectId)).toEqual([inbox, sprint]);
  });

  test("タスクを列に作成し、移動・更新した詳細を取得できる", async () => {
    const tracker = createFakeTracker();
    const { externalId: projectId } = await tracker.createProject(node);
    const inbox = await tracker.createSection(projectId, "Inbox");
    const done = await tracker.createSection(projectId, "Done");
    const task = await tracker.createTask(projectId, {
      name: "実装",
      notes: "最初の説明",
      dueOn: "2026-10-20",
      sectionId: inbox.externalId,
      assigneeId: "owner-1",
    });
    expect(task).toEqual({
      externalId: "fake-4",
      name: "実装",
      completed: false,
      dueOn: "2026-10-20",
      url: null,
    });
    expect(await tracker.getTask(task.externalId)).toEqual({
      ...task,
      notes: "最初の説明",
      tags: [],
      sectionId: inbox.externalId,
      sectionName: "Inbox",
      assigneeId: "owner-1",
    });
    await tracker.moveTask(task.externalId, done.externalId);
    const updated = await tracker.updateTask(task.externalId, {
      name: "実装済み",
      notes: "更新した説明",
      assigneeId: "owner-2",
    });
    expect(updated).toEqual({
      ...task,
      name: "実装済み",
      notes: "更新した説明",
      tags: [],
      sectionId: done.externalId,
      sectionName: "Done",
      assigneeId: "owner-2",
    });
    expect(await tracker.getTask(task.externalId)).toEqual(updated);
    expect(await tracker.listTaskDetails(projectId)).toEqual([updated]);
    expect(await tracker.listTasks(projectId)).toEqual([
      { ...task, name: "実装済み" },
    ]);
    expect(
      await tracker.updateTask(task.externalId, { notes: "", assigneeId: null }),
    ).toEqual({ ...updated, notes: "", assigneeId: null });
    expect(await tracker.updateTask(task.externalId, {})).toEqual({
      ...updated,
      notes: "",
      assigneeId: null,
    });
  });

  test("省略した項目には既定値を使い、state の直接編集を取得結果に反映する", async () => {
    const tracker = createFakeTracker();
    const { externalId: projectId } = await tracker.createProject(node);
    const other = await tracker.createProject({ ...node, id: "node-2" });
    expect(await tracker.listTasks(projectId)).toEqual([]);
    expect(await tracker.listTaskDetails(projectId)).toEqual([]);
    const task = await tracker.createTask(projectId, { name: "未着手" });
    await tracker.createTask(other.externalId, { name: "別の項目" });
    expect(await tracker.getTask(task.externalId)).toEqual({
      externalId: task.externalId,
      name: "未着手",
      completed: false,
      dueOn: null,
      url: null,
      notes: "",
      tags: [],
      sectionId: null,
      sectionName: null,
      assigneeId: null,
    });
    const stored = tracker.state.tasks.get(task.externalId)!;
    stored.completed = true;
    stored.tags.push("from:owner");
    const details = await tracker.getTask(task.externalId);
    expect(details.completed).toBe(true);
    expect(details.tags).toEqual(["from:owner"]);
    expect(await tracker.listTaskDetails(projectId)).toEqual([details]);
    expect(await tracker.listTasks(projectId)).toEqual([
      { ...task, completed: true },
    ]);
  });

  test("タグを名前で再利用し、重複させずタスクに付ける", async () => {
    const tracker = createFakeTracker();
    const { externalId: projectId } = await tracker.createProject(node);
    const task = await tracker.createTask(projectId, { name: "項目" });
    const tagId = await tracker.ensureTag("story");
    expect(tagId).toBe("fake-3");
    expect(await tracker.ensureTag("story")).toBe(tagId);
    tracker.state.tags.set("from:owner", "owner-tag");
    expect(await tracker.ensureTag("from:owner")).toBe("owner-tag");
    await tracker.addTag(task.externalId, tagId);
    await tracker.addTag(task.externalId, tagId);
    await tracker.addTag(task.externalId, "owner-tag");
    expect(tracker.state.tasks.get(task.externalId)?.tags).toEqual([
      "story",
      "from:owner",
    ]);
    expect((await tracker.getTask(task.externalId)).tags).toEqual([
      "story",
      "from:owner",
    ]);
  });

  test("コメントを作成者・注入した時刻付きで追加順に一覧する", async () => {
    let time = new Date("2026-10-13T01:00:00.000Z");
    const tracker = createFakeTracker({ now: () => time });
    const { externalId: projectId } = await tracker.createProject(node);
    const task = await tracker.createTask(projectId, { name: "判断待ち" });
    const other = await tracker.createTask(projectId, { name: "別の項目" });
    expect(await tracker.listComments(task.externalId)).toEqual([]);
    await tracker.addComment(task.externalId, "確認をお願いします");
    time = new Date("2026-10-13T02:00:00.000Z");
    tracker.state.addCommentAs(task.externalId, "進めてください", "owner-1");
    tracker.state.comments.get(task.externalId)!.push({
      externalId: "direct-comment",
      text: "直接追加",
      authorId: "owner-2",
      createdAt: "2026-10-13T03:00:00.000Z",
    });
    expect(await tracker.listComments(task.externalId)).toEqual([
      {
        externalId: "fake-4",
        text: "確認をお願いします",
        authorId: null,
        createdAt: "2026-10-13T01:00:00.000Z",
      },
      {
        externalId: "fake-5",
        text: "進めてください",
        authorId: "owner-1",
        createdAt: "2026-10-13T02:00:00.000Z",
      },
      {
        externalId: "direct-comment",
        text: "直接追加",
        authorId: "owner-2",
        createdAt: "2026-10-13T03:00:00.000Z",
      },
    ]);
    expect(await tracker.listComments(other.externalId)).toEqual([]);
  });

  test("Webhook は固定値を返し、インスタンスごとに状態と連番が独立する", async () => {
    const first = createFakeTracker();
    const second = createFakeTracker();
    const project = await first.createProject(node);
    expect(
      await first.createWebhook(project.externalId, "https://example.test/hook"),
    ).toEqual({ webhookId: "fake-webhook" });
    expect(second.state.projects.size).toBe(0);
    expect(await second.createProject(node)).toEqual(project);
    expect(await first.ensureTag("story")).toBe("fake-2");
    expect(second.state.tags.size).toBe(0);
  });

  test("存在しない gid を使う各操作は not found で失敗する", async () => {
    const tracker = createFakeTracker();
    const { externalId: projectId } = await tracker.createProject(node);
    const task = await tracker.createTask(projectId, { name: "項目" });
    const section = await tracker.createSection(projectId, "Inbox");
    const tag = await tracker.ensureTag("story");
    const missing = "missing";
    const operations = [
      () => tracker.listTasks(missing),
      () => tracker.createTask(missing, { name: "項目" }),
      () => tracker.createTask(projectId, { name: "項目", sectionId: missing }),
      () => tracker.createWebhook(missing, "https://example.test/hook"),
      () => tracker.listSections(missing),
      () => tracker.createSection(missing, "Inbox"),
      () => tracker.listTaskDetails(missing),
      () => tracker.getTask(missing),
      () => tracker.moveTask(missing, section.externalId),
      () => tracker.moveTask(task.externalId, missing),
      () => tracker.updateTask(missing, { name: "更新" }),
      () => tracker.addTag(missing, tag),
      () => tracker.addTag(task.externalId, missing),
      () => tracker.addComment(missing, "コメント"),
      () => tracker.listComments(missing),
    ];
    for (const operation of operations) {
      await expect(operation()).rejects.toThrow(new Error("not found"));
    }
    expect(() => tracker.state.addCommentAs(missing, "返答", "owner-1"))
      .toThrow(new Error("not found"));
    expect(tracker.state.tasks.size).toBe(1);
    expect(tracker.state.tasks.get(task.externalId)?.sectionId).toBeNull();
    expect(tracker.state.tasks.get(task.externalId)?.tags).toEqual([]);
  });
});
