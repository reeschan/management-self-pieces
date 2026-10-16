import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  agentTokens,
  devProjects,
  externalRefs,
  ipAllowlist,
  mcpAuditLog,
  mcpRateLimits,
  nodes,
  taskCache,
} from "@/db/schema";
import { createBoardService, LIMITS, type Section } from "@/lib/devloop/board";
import { buildItemNotes, parseItemNotes } from "@/lib/devloop/item-meta";
import { createFakeTracker, type FakeTracker } from "@/test/fake-tracker";
import { createTestDb } from "@/test/pglite";

import { handleMcpRequest, type McpDeps } from "./handler";
import { addAllowlistEntry } from "./ip-allowlist";
import { issueToken, type Scope } from "./tokens";

const now = new Date("2026-10-14T00:30:00.000Z");
const ALLOWED_IP = "203.0.113.10";
const OWNER_GID = "owner-gid";
const LOCAL_HEADERS = { Host: "localhost:3000" };

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: { content?: Array<{ type: string; text: string }>; isError?: boolean };
  error?: { code: number; message: string };
};

function callTool(name: string, args: Record<string, unknown>, headers: Record<string, string>): Request {
  return new Request("https://app.example/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

async function readRpc(response: Response): Promise<JsonRpcResponse> {
  expect(response.status).toBe(200);
  return (await response.json()) as JsonRpcResponse;
}

/** tools/call の結果の本文 (text) を取り出す。 */
async function toolText(response: Response): Promise<{ text: string; isError: boolean }> {
  const body = await readRpc(response);
  expect(body.error).toBeUndefined();
  const content = body.result?.content ?? [];
  expect(content).toHaveLength(1);
  return { text: content[0].text, isError: body.result?.isError === true };
}

function makeNode(id: string) {
  return {
    id,
    kind: "project",
    title: id,
    summary: "",
    status: "active",
    detailPath: `nodes/${id}.md`,
    sourceRepo: `owner/${id}`,
  };
}

describe("看板のツール (board 権限)", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let tracker: FakeTracker;
  /** Node ごとの Asana のプロジェクトの gid (n3 は Asana につながっていない) */
  let projects: Record<"n1" | "n2", string>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    await testDb.db.delete(mcpAuditLog);
    await testDb.db.delete(mcpRateLimits);
    await testDb.db.delete(agentTokens);
    await testDb.db.delete(ipAllowlist);
    await testDb.db.delete(taskCache);
    await testDb.db.delete(externalRefs);
    await testDb.db.delete(devProjects);
    await testDb.db.delete(nodes);
    await testDb.db.insert(nodes).values([makeNode("n1"), makeNode("n2"), makeNode("n3")]);

    tracker = createFakeTracker({ now: () => now });
    const p1 = await tracker.createProject({ id: "n1", title: "n1", summary: "" });
    const p2 = await tracker.createProject({ id: "n2", title: "n2", summary: "" });
    projects = { n1: p1.externalId, n2: p2.externalId };
    await testDb.db.insert(externalRefs).values([
      { nodeId: "n1", provider: "asana", externalId: projects.n1 },
      { nodeId: "n2", provider: "asana", externalId: projects.n2 },
    ]);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  function localDeps(): McpDeps {
    return {
      db: testDb.db,
      mode: "local",
      clientIp: "127.0.0.1",
      now: () => now,
      tracker: () => tracker,
      ownerAssigneeId: OWNER_GID,
    };
  }

  function hostDeps(): McpDeps {
    return { ...localDeps(), mode: "host", clientIp: ALLOWED_IP };
  }

  /** 許可リストに入れたうえでトークンを発行し、Authorization ヘッダーを返す。 */
  async function hostAuth(scopes: Scope[]) {
    await addAllowlistEntry(testDb.db, { cidr: "203.0.113.0/24", label: "社内" });
    const token = await issueToken(testDb.db, { name: "agent", scopes, expiresAt: null, now });
    return { headers: { Authorization: `Bearer ${token.raw}` }, tokenId: token.id };
  }

  async function callLocal(name: string, args: Record<string, unknown>) {
    return toolText(await handleMcpRequest(callTool(name, args, LOCAL_HEADERS), localDeps()));
  }

  /** 検証で弾かれたこと (ツールは実行されず、監査ログも残らない) を確かめる。 */
  async function expectInvalid(name: string, args: Record<string, unknown>) {
    const body = await readRpc(await handleMcpRequest(callTool(name, args, LOCAL_HEADERS), localDeps()));
    const failed = body.error !== undefined || body.result?.isError === true;
    expect(failed).toBe(true);
    expect(await testDb.db.select().from(mcpAuditLog)).toHaveLength(0);
  }

  function boardService() {
    return createBoardService({ db: testDb.db, tracker, ownerAssigneeId: OWNER_GID, now: () => now });
  }

  /** 写しを通さずに Asana (偽物) へ直接項目を入れ、写しも読み直す */
  async function seed(node: "n1" | "n2", section: Section, count: number): Promise<string[]> {
    const board = boardService();
    await board.ensureSections(node);
    const sectionId = tracker.state.sections.get(projects[node])?.find((s) => s.name === section)?.externalId;
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const task = await tracker.createTask(projects[node], {
        name: `${section}-${i}`,
        notes: buildItemNotes("本文", { id: `S-${String(i + 1).padStart(4, "0")}` }),
        sectionId,
      });
      ids.push(task.externalId);
    }
    await board.getBoard(node);
    return ids;
  }

  function sectionOf(taskId: string): string | null {
    const task = tracker.state.tasks.get(taskId);
    if (!task?.sectionId) return null;
    return tracker.state.sections.get(task.projectId)?.find((s) => s.externalId === task.sectionId)?.name ?? null;
  }

  async function auditRows() {
    return testDb.db.select().from(mcpAuditLog);
  }

  describe("権限と回数", () => {
    it("read だけのトークンで create_item を呼ぶと forbidden で、項目は作られない", async () => {
      const { headers, tokenId } = await hostAuth(["read"]);
      const { text, isError } = await toolText(
        await handleMcpRequest(
          callTool(
            "create_item",
            { node_id: "n1", section: "Inbox", name: "案", notes: "", type: "story", origin: "pm" },
            headers,
          ),
          hostDeps(),
        ),
      );
      expect(isError).toBe(true);
      expect(text).toBe("forbidden: このツールには board 権限が要る");
      expect(tracker.state.tasks.size).toBe(0);

      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ tokenId, tool: "create_item", outcome: "rejected", reason: "forbidden_scope" });
      // 書き込みの回数は数えない
      const limits = await testDb.db.select().from(mcpRateLimits);
      expect(limits.filter((row) => row.kind === "write")).toHaveLength(0);
    });

    it("ホストで board 権限のトークンなら create_item が通り、監査ログに ok、書き込みの回数が数えられる", async () => {
      const { headers, tokenId } = await hostAuth(["board"]);
      const { text, isError } = await toolText(
        await handleMcpRequest(
          callTool(
            "create_item",
            { node_id: "n1", section: "Inbox", name: "案", notes: "本文", type: "story", origin: "pm" },
            headers,
          ),
          hostDeps(),
        ),
      );
      expect(isError).toBe(false);
      expect(JSON.parse(text)).toEqual({ id: expect.any(String) });

      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ mode: "host", tokenId, tool: "create_item", outcome: "ok", reason: null });

      const limits = await testDb.db.select().from(mcpRateLimits);
      expect(limits.find((row) => row.kind === "write")).toMatchObject({ tokenId, count: 1 });
    });
  });

  describe("create_item", () => {
    it("Inbox に作れて id が返り、タグと meta が付く。監査ログに ok が残る", async () => {
      const { text, isError } = await callLocal("create_item", {
        node_id: "n1",
        section: "Inbox",
        name: "検索を速くする",
        notes: "本文",
        type: "story",
        origin: "biz",
        meta: { value: 3, iteration: 1 },
      });
      expect(isError).toBe(false);
      const { id } = JSON.parse(text) as { id: string };

      const task = tracker.state.tasks.get(id);
      expect(task).toBeDefined();
      expect(task?.projectId).toBe(projects.n1);
      expect(sectionOf(id)).toBe("Inbox");
      expect(task?.tags.sort()).toEqual(["from:biz", "story"]);
      expect(parseItemNotes(task?.notes ?? "")).toMatchObject({
        body: "本文",
        meta: { id: "S-0001", value: 3, iteration: 1 },
      });

      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ mode: "local", tool: "create_item", outcome: "ok" });
    });

    it("section に Sprint や「Owner 判断」を渡すと入力エラー", async () => {
      const base = { node_id: "n1", name: "案", notes: "", type: "story", origin: "pm" };
      await expectInvalid("create_item", { ...base, section: "Sprint" });
      await expectInvalid("create_item", { ...base, section: "Owner 判断" });
      expect(tracker.state.tasks.size).toBe(0);
    });

    it("origin に owner を渡すと入力エラー", async () => {
      await expectInvalid("create_item", {
        node_id: "n1",
        section: "Inbox",
        name: "案",
        notes: "",
        type: "story",
        origin: "owner",
      });
      expect(tracker.state.tasks.size).toBe(0);
    });

    it("meta の値が不正なら入力エラー", async () => {
      await expectInvalid("create_item", {
        node_id: "n1",
        section: "Inbox",
        name: "案",
        notes: "",
        type: "story",
        origin: "pm",
        meta: { value: 9 },
      });
    });

    it(`Inbox が ${LIMITS.inbox} 件だと inbox_full`, async () => {
      await seed("n1", "Inbox", LIMITS.inbox);
      const { text, isError } = await callLocal("create_item", {
        node_id: "n1",
        section: "Inbox",
        name: "案",
        notes: "",
        type: "story",
        origin: "pm",
      });
      expect(isError).toBe(true);
      expect(text).toMatch(/^inbox_full: /);

      const rows = await auditRows();
      expect(rows.at(-1)).toMatchObject({ tool: "create_item", outcome: "tool_error", reason: "inbox_full" });
    });

    it("Asana につながっていない Node では not_linked", async () => {
      const { text, isError } = await callLocal("create_item", {
        node_id: "n3",
        section: "Inbox",
        name: "案",
        notes: "",
        type: "story",
        origin: "pm",
      });
      expect(isError).toBe(true);
      expect(text).toMatch(/^not_linked: /);
    });

    it("存在しない Node では not_found", async () => {
      const { text, isError } = await callLocal("create_item", {
        node_id: "missing",
        section: "Inbox",
        name: "案",
        notes: "",
        type: "story",
        origin: "pm",
      });
      expect(isError).toBe(true);
      expect(text).toBe("not_found: Node が見つからない");
    });
  });

  describe("move_item", () => {
    it("項目を列の間で動かせる", async () => {
      const [id] = await seed("n1", "Backlog", 1);
      const { text, isError } = await callLocal("move_item", { node_id: "n1", item_id: id, section: "In Progress" });
      expect(isError).toBe(false);
      expect(JSON.parse(text)).toEqual({ itemId: id, section: "In Progress" });
      expect(sectionOf(id)).toBe("In Progress");
    });

    it("Sprint の上限は Node の sprintLimit を使い、超えると sprint_full", async () => {
      await testDb.db.insert(devProjects).values({ nodeId: "n1", sprintLimit: 2 });
      await seed("n1", "Sprint", 2);
      const [id] = await seed("n1", "Backlog", 1);

      const { text, isError } = await callLocal("move_item", { node_id: "n1", item_id: id, section: "Sprint" });
      expect(isError).toBe(true);
      expect(text).toMatch(/^sprint_full: /);
      expect(sectionOf(id)).toBe("Backlog");
    });

    it("別の Node の項目を動かそうとすると node_mismatch", async () => {
      const [other] = await seed("n2", "Backlog", 1);
      const { text, isError } = await callLocal("move_item", { node_id: "n1", item_id: other, section: "Done" });
      expect(isError).toBe(true);
      expect(text).toMatch(/^node_mismatch: /);
      expect(sectionOf(other)).toBe("Backlog");
    });

    it("section に看板に無い列を渡すと入力エラー", async () => {
      await expectInvalid("move_item", { node_id: "n1", item_id: "x", section: "Doing" });
    });
  });

  describe("update_item / comment_item", () => {
    it("update_item は meta を丸ごと置き換える", async () => {
      const [id] = await seed("n1", "Backlog", 1);
      await tracker.updateTask(id, {
        notes: buildItemNotes("本文", { id: "S-0001", value: 2, hypothesis: "仮説" }),
      });
      const { text, isError } = await callLocal("update_item", {
        item_id: id,
        node_id: "n1",
        meta: { id: "S-0001", effort: 3 },
      });
      expect(isError).toBe(false);
      expect(JSON.parse(text)).toEqual({ itemId: id, meta: { id: "S-0001", effort: 3 } });
      expect(parseItemNotes(tracker.state.tasks.get(id)?.notes ?? "")).toMatchObject({
        body: "本文",
        meta: { id: "S-0001", effort: 3 },
      });
    });

    it("別の Node の項目に node_id を付けて呼ぶと node_mismatch で、項目は変わらない", async () => {
      const [other] = await seed("n2", "Backlog", 1);
      const before = tracker.state.tasks.get(other)?.notes;

      const updated = await callLocal("update_item", {
        item_id: other,
        node_id: "n1",
        meta: { id: "S-0009" },
      });
      expect(updated.isError).toBe(true);
      expect(updated.text).toMatch(/^node_mismatch: /);
      expect(tracker.state.tasks.get(other)?.notes).toBe(before);

      const commented = await callLocal("comment_item", { item_id: other, node_id: "n1", text: "コメント" });
      expect(commented.isError).toBe(true);
      expect(commented.text).toMatch(/^node_mismatch: /);
      expect(tracker.state.comments.get(other)).toEqual([]);
    });

    it("写しにも無い項目は not_found", async () => {
      const updated = await callLocal("update_item", { item_id: "nope", meta: { id: "S-0001" } });
      expect(updated.isError).toBe(true);
      expect(updated.text).toMatch(/^not_found: /);

      const commented = await callLocal("comment_item", { item_id: "nope", node_id: "n1", text: "コメント" });
      expect(commented.isError).toBe(true);
      expect(commented.text).toMatch(/^not_found: /);
    });

    it("comment_item で項目にコメントが付く", async () => {
      const [id] = await seed("n1", "Backlog", 1);
      const { text, isError } = await callLocal("comment_item", { item_id: id, text: "判断の理由" });
      expect(isError).toBe(false);
      expect(JSON.parse(text)).toEqual({ itemId: id, commented: true });
      expect(tracker.state.comments.get(id)?.map((c) => c.text)).toEqual(["[devloop] 判断の理由"]);
    });

    it("update_item の meta に id が無ければ入力エラー", async () => {
      await expectInvalid("update_item", { item_id: "x", meta: { value: 1 } });
    });
  });

  describe("request_owner と get_board", () => {
    it("request_owner で「Owner 判断」に持ち主宛ての項目ができ、元の項目も移る", async () => {
      const [id] = await seed("n1", "Backlog", 1);
      const { text, isError } = await callLocal("request_owner", {
        node_id: "n1",
        title: "価格を決めてほしい",
        reason: "判断できない",
        item_id: id,
      });
      expect(isError).toBe(false);
      const result = JSON.parse(text) as { task: { externalId: string }; movedItemId: string | null };
      expect(result.movedItemId).toBe(id);

      const created = tracker.state.tasks.get(result.task.externalId);
      expect(created).toMatchObject({ name: "価格を決めてほしい", assigneeId: OWNER_GID });
      expect(sectionOf(result.task.externalId)).toBe("Owner 判断");
      expect(sectionOf(id)).toBe("Owner 判断");
    });

    it("request_owner で別の Node の項目を渡すと node_mismatch で、何も作らない", async () => {
      const [other] = await seed("n2", "Backlog", 1);
      const before = tracker.state.tasks.size;
      const { text, isError } = await callLocal("request_owner", {
        node_id: "n1",
        title: "判断",
        reason: "理由",
        item_id: other,
      });
      expect(isError).toBe(true);
      expect(text).toMatch(/^node_mismatch: /);
      expect(tracker.state.tasks.size).toBe(before);
      expect(sectionOf(other)).toBe("Backlog");
    });

    it("get_board は列ごとの形で返り、「Owner 判断」の項目に Owner のコメントが付く", async () => {
      const [owner] = await seed("n1", "Owner 判断", 1);
      await seed("n1", "Backlog", 1);
      tracker.state.addCommentAs(owner, "持ち主の答え", OWNER_GID);
      tracker.state.addCommentAs(owner, "[from:owner] 画面からの答え", null);
      tracker.state.addCommentAs(owner, "エージェントのコメント", null);

      const { text, isError } = await callLocal("get_board", { node_id: "n1" });
      expect(isError).toBe(false);
      const board = JSON.parse(text) as {
        columns: Array<{ section: string; items: Array<{ id: string; ownerComments: Array<{ text: string }> }> }>;
      };
      expect(board.columns.slice(0, 8).map((c) => c.section)).toEqual([
        "Inbox",
        "Backlog",
        "Sprint",
        "In Progress",
        "Biz Review",
        "Done",
        "Owner 判断",
        "Rejected",
      ]);
      expect(board.columns.find((c) => c.section === "Backlog")?.items).toHaveLength(1);
      const ownerItem = board.columns.find((c) => c.section === "Owner 判断")?.items[0];
      expect(ownerItem?.id).toBe(owner);
      expect(ownerItem?.ownerComments.map((c) => c.text)).toEqual(["持ち主の答え", "[from:owner] 画面からの答え"]);
    });

    it("get_board は Asana につながっていない Node で not_linked", async () => {
      const { text, isError } = await callLocal("get_board", { node_id: "n3" });
      expect(isError).toBe(true);
      expect(text).toMatch(/^not_linked: /);
    });
  });

  it("Tracker を作れない (Asana の環境変数が無い) ときは internal_error だけを返し、中身を出さない", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const deps: McpDeps = {
        ...localDeps(),
        tracker: () => {
          throw new Error("secret: ASANA_PAT が無い");
        },
      };
      const { text, isError } = await toolText(
        await handleMcpRequest(callTool("get_board", { node_id: "n1" }, LOCAL_HEADERS), deps),
      );
      expect(isError).toBe(true);
      expect(text).toBe("internal_error: 処理に失敗しました");
      expect(text).not.toContain("secret");

      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ tool: "get_board", outcome: "tool_error", reason: "internal_error" });
    } finally {
      consoleError.mockRestore();
    }
  });
});
