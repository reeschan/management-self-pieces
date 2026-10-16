import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  agentTokens,
  devloopControl,
  devloopRuns,
  devProjects,
  externalRefs,
  ipAllowlist,
  iterations,
  mcpAuditLog,
  mcpRateLimits,
  nodes,
  taskCache,
} from "@/db/schema";
import { createFakeTracker, type FakeTracker } from "@/test/fake-tracker";
import { createTestDb } from "@/test/pglite";

import { handleMcpRequest, type McpDeps } from "./handler";
import { addAllowlistEntry } from "./ip-allowlist";
import { issueToken, type Scope } from "./tokens";

const now = new Date("2026-10-14T00:30:00.000Z");
const ALLOWED_IP = "203.0.113.10";
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

/** iteration.yaml と同じ形の、正しいイテレーションの記録 */
function validManifest() {
  return {
    number: 1,
    goal: "検索を速くする",
    phase: "build",
    stories: [{ id: "S-0001", title: "索引を作る", status: "planned" }],
    started_at: "2026-10-14T09:00:00+09:00",
    unknown_key: "捨てられる",
  };
}

describe("制御のツール (loop 権限・is_stopped)", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let tracker: FakeTracker;

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
    await testDb.db.delete(devloopRuns);
    await testDb.db.delete(iterations);
    await testDb.db.delete(devProjects);
    await testDb.db.delete(devloopControl);
    await testDb.db.delete(nodes);
    await testDb.db.insert(nodes).values([makeNode("n1"), makeNode("n2")]);
    tracker = createFakeTracker({ now: () => now });
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
      ownerAssigneeId: null,
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

  async function callHost(name: string, args: Record<string, unknown>, headers: Record<string, string>) {
    return toolText(await handleMcpRequest(callTool(name, args, headers), hostDeps()));
  }

  /** 検証で弾かれたこと (ツールは実行されず、監査ログも残らない) を確かめる。 */
  async function expectInvalid(name: string, args: Record<string, unknown>) {
    const body = await readRpc(await handleMcpRequest(callTool(name, args, LOCAL_HEADERS), localDeps()));
    const failed = body.error !== undefined || body.result?.isError === true;
    expect(failed).toBe(true);
    expect(await testDb.db.select().from(mcpAuditLog)).toHaveLength(0);
  }

  /** Node を有効・一時停止なしにする */
  async function enable(nodeId: string) {
    await testDb.db.insert(devProjects).values({ nodeId, enabled: true, paused: false });
  }

  async function settingsOf(nodeId: string) {
    const [row] = await testDb.db.select().from(devProjects).where(eq(devProjects.nodeId, nodeId));
    return row;
  }

  async function runOf(id: string) {
    const [row] = await testDb.db.select().from(devloopRuns).where(eq(devloopRuns.id, id));
    return row;
  }

  async function auditRows() {
    return testDb.db.select().from(mcpAuditLog);
  }

  describe("権限", () => {
    it("board だけのトークンで next_project を呼ぶと forbidden で、Node は選ばれない", async () => {
      await enable("n1");
      const { headers, tokenId } = await hostAuth(["board"]);
      const { text, isError } = await callHost("next_project", {}, headers);
      expect(isError).toBe(true);
      expect(text).toBe("forbidden: このツールには loop 権限が要る");
      expect((await settingsOf("n1")).lastSelectedAt).toBeNull();

      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ tokenId, tool: "next_project", outcome: "rejected", reason: "forbidden_scope" });
    });

    it("read だけのトークンでは report_run と pause も forbidden で、何も書かない", async () => {
      const { headers } = await hostAuth(["read"]);
      const reported = await callHost("report_run", { node_id: "n1", phase: "plan", summary: "" }, headers);
      expect(reported.isError).toBe(true);
      expect(reported.text).toBe("forbidden: このツールには loop 権限が要る");
      const paused = await callHost("pause", { node_id: "n1", reason: "危ない" }, headers);
      expect(paused.isError).toBe(true);
      expect(paused.text).toBe("forbidden: このツールには loop 権限が要る");

      expect(await testDb.db.select().from(devloopRuns)).toHaveLength(0);
      expect(await testDb.db.select().from(devProjects)).toHaveLength(0);
    });

    it("read のトークンで is_stopped が呼べ、書き込みの回数は数えない", async () => {
      await enable("n1");
      const { headers } = await hostAuth(["read"]);
      const { text, isError } = await callHost("is_stopped", { node_id: "n1" }, headers);
      expect(isError).toBe(false);
      expect(JSON.parse(text)).toEqual({ stopped: false, reason: null });

      const limits = await testDb.db.select().from(mcpRateLimits);
      expect(limits.filter((row) => row.kind === "write")).toHaveLength(0);
    });

    it("loop のトークンで next_project が通り、書き込みの回数が数えられる", async () => {
      await enable("n1");
      const { headers, tokenId } = await hostAuth(["loop"]);
      const { isError } = await callHost("next_project", {}, headers);
      expect(isError).toBe(false);

      const limits = await testDb.db.select().from(mcpRateLimits);
      expect(limits.find((row) => row.kind === "write")).toMatchObject({ tokenId, count: 1 });
    });
  });

  describe("next_project", () => {
    it("有効な Node を返し、選んだ時刻を記録する。全体の上限 (既定 1) に達すると null", async () => {
      await enable("n1");
      const first = await callLocal("next_project", {});
      expect(first.isError).toBe(false);
      expect(JSON.parse(first.text)).toEqual({
        nodeId: "n1",
        sourceRepo: "owner/n1",
        autonomy: 1,
        maxPbisPerIteration: 10,
        sprintLimit: 6,
        openIteration: null,
      });
      expect((await settingsOf("n1")).lastSelectedAt).toEqual(now);

      // 今日 1 回イテレーションを終えた (release が succeeded)
      await testDb.db.insert(devloopRuns).values({
        id: "done-today",
        nodeId: "n1",
        phase: "release",
        status: "succeeded",
        startedAt: now,
        heartbeatAt: now,
        finishedAt: now,
      });
      const second = await callLocal("next_project", {});
      expect(second.isError).toBe(false);
      expect(JSON.parse(second.text)).toBeNull();
    });

    it("有効な Node が無ければ null", async () => {
      const { text, isError } = await callLocal("next_project", {});
      expect(isError).toBe(false);
      expect(JSON.parse(text)).toBeNull();
    });
  });

  describe("report_run", () => {
    it("開始 → ハートビート → 終了で devloop_runs の行が変わる", async () => {
      await enable("n1");
      const started = await callLocal("report_run", {
        node_id: "n1",
        run_id: "run-1",
        phase: "plan",
        summary: "計画を始める",
        iteration: 2,
      });
      expect(started.isError).toBe(false);
      expect(JSON.parse(started.text)).toMatchObject({ runId: "run-1", run: { id: "run-1", status: "running" } });
      expect(await runOf("run-1")).toMatchObject({
        nodeId: "n1",
        iteration: 2,
        phase: "plan",
        status: "running",
        summary: "計画を始める",
        finishedAt: null,
      });

      const beat = await callLocal("report_run", {
        node_id: "n1",
        run_id: "run-1",
        phase: "plan",
        summary: "半分まで",
        status: "running",
      });
      expect(beat.isError).toBe(false);
      expect(JSON.parse(beat.text)).toEqual({ runId: "run-1", status: "running" });
      expect(await runOf("run-1")).toMatchObject({ status: "running", summary: "半分まで" });

      // 空の要約のハートビートでは、要約を消さない
      await callLocal("report_run", { node_id: "n1", run_id: "run-1", phase: "plan", summary: "", status: "running" });
      expect((await runOf("run-1")).summary).toBe("半分まで");

      const finished = await callLocal("report_run", {
        node_id: "n1",
        run_id: "run-1",
        phase: "plan",
        summary: "計画を終えた",
        status: "succeeded",
        tokens: { input: 100, output: 20 },
      });
      expect(finished.isError).toBe(false);
      expect(JSON.parse(finished.text)).toMatchObject({ runId: "run-1", autoPaused: false });
      expect(await runOf("run-1")).toMatchObject({
        status: "succeeded",
        summary: "計画を終えた",
        tokens: { input: 100, output: 20 },
        finishedAt: now,
      });
      expect((await settingsOf("n1")).lastRunAt).toEqual(now);
    });

    it("run_id を省いた開始では run_id が振られる", async () => {
      const { text, isError } = await callLocal("report_run", { node_id: "n1", phase: "build", summary: "" });
      expect(isError).toBe(false);
      const { runId } = JSON.parse(text) as { runId: string };
      expect(runId).toMatch(/^[0-9a-f-]{36}$/);
      expect(await runOf(runId)).toMatchObject({ nodeId: "n1", status: "running" });
    });

    it("3 回続けて failed で Node が一時停止になる", async () => {
      await enable("n1");
      const results: Array<{ autoPaused: boolean }> = [];
      for (let i = 1; i <= 3; i++) {
        const runId = `fail-${i}`;
        await callLocal("report_run", { node_id: "n1", run_id: runId, phase: "build", summary: "" });
        const { text, isError } = await callLocal("report_run", {
          node_id: "n1",
          run_id: runId,
          phase: "build",
          summary: "失敗",
          status: "failed",
        });
        expect(isError).toBe(false);
        results.push(JSON.parse(text) as { autoPaused: boolean });
      }
      expect(results.map((r) => r.autoPaused)).toEqual([false, false, true]);
      expect(results[2]).toMatchObject({ reason: "3 回続けて失敗" });
      expect(await settingsOf("n1")).toMatchObject({ paused: true, pauseReason: "3 回続けて失敗" });

      const stopped = await callLocal("is_stopped", { node_id: "n1" });
      expect(JSON.parse(stopped.text)).toEqual({ stopped: true, reason: "3 回続けて失敗" });
    });

    it("iteration_manifest が正しければ iterations に入る (知らないキーは捨てる)", async () => {
      const { isError } = await callLocal("report_run", {
        node_id: "n1",
        run_id: "run-m",
        phase: "build",
        summary: "",
        iteration_manifest: validManifest(),
      });
      expect(isError).toBe(false);

      const rows = await testDb.db.select().from(iterations);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        nodeId: "n1",
        number: 1,
        goal: "検索を速くする",
        phase: "build",
        stories: [{ id: "S-0001", title: "索引を作る", status: "planned" }],
      });
      expect(await runOf("run-m")).toBeDefined();
    });

    it("iteration_manifest が不正なら invalid_manifest で、詳細は返さず、行は増えない", async () => {
      const { text, isError } = await callLocal("report_run", {
        node_id: "n1",
        run_id: "run-bad",
        phase: "build",
        summary: "",
        iteration_manifest: { ...validManifest(), number: 0, goal: "" },
      });
      expect(isError).toBe(true);
      expect(text).toBe("invalid_manifest: iteration_manifest の形が正しくない");

      expect(await testDb.db.select().from(iterations)).toHaveLength(0);
      expect(await testDb.db.select().from(devloopRuns)).toHaveLength(0);

      const rows = await auditRows();
      expect(rows.at(-1)).toMatchObject({ tool: "report_run", outcome: "tool_error", reason: "invalid_manifest" });
    });

    it("ハートビートと終了で run_id が無い・実行が無い・別の Node の実行なら、書かずにエラー", async () => {
      await callLocal("report_run", { node_id: "n2", run_id: "run-n2", phase: "build", summary: "" });

      const noId = await callLocal("report_run", { node_id: "n1", phase: "build", summary: "", status: "failed" });
      expect(noId.isError).toBe(true);
      expect(noId.text).toMatch(/^run_id_required: /);

      const missing = await callLocal("report_run", {
        node_id: "n1",
        run_id: "nope",
        phase: "build",
        summary: "",
        status: "succeeded",
      });
      expect(missing.isError).toBe(true);
      expect(missing.text).toMatch(/^run_not_found: /);

      const mismatch = await callLocal("report_run", {
        node_id: "n1",
        run_id: "run-n2",
        phase: "build",
        summary: "",
        status: "failed",
      });
      expect(mismatch.isError).toBe(true);
      expect(mismatch.text).toMatch(/^node_mismatch: /);
      expect(await runOf("run-n2")).toMatchObject({ status: "running", finishedAt: null });
    });

    it("同じ run_id で 2 回開始すると run_exists", async () => {
      await callLocal("report_run", { node_id: "n1", run_id: "dup", phase: "build", summary: "" });
      const { text, isError } = await callLocal("report_run", { node_id: "n1", run_id: "dup", phase: "build", summary: "" });
      expect(isError).toBe(true);
      expect(text).toMatch(/^run_exists: /);
    });

    it("存在しない Node では not_found", async () => {
      const { text, isError } = await callLocal("report_run", { node_id: "missing", phase: "build", summary: "" });
      expect(isError).toBe(true);
      expect(text).toBe("not_found: Node が見つからない");
      expect(await testDb.db.select().from(devloopRuns)).toHaveLength(0);
    });

    it("入力の上限を超えると入力エラー", async () => {
      await expectInvalid("report_run", { node_id: "n1", phase: "", summary: "" });
      await expectInvalid("report_run", { node_id: "n1", phase: "x".repeat(41), summary: "" });
      await expectInvalid("report_run", { node_id: "n1", phase: "build", summary: "x".repeat(2_001) });
      await expectInvalid("report_run", { node_id: "n1", phase: "build" });
      await expectInvalid("report_run", { node_id: "n1", run_id: "x".repeat(101), phase: "build", summary: "" });
      await expectInvalid("report_run", { node_id: "n1", phase: "build", summary: "", status: "done" });
      await expectInvalid("report_run", { node_id: "n1", phase: "build", summary: "", iteration: -1 });
      await expectInvalid("report_run", {
        node_id: "n1",
        phase: "build",
        summary: "",
        tokens: { note: "x".repeat(2_000) },
      });
      expect(await testDb.db.select().from(devloopRuns)).toHaveLength(0);
    });
  });

  describe("pause と is_stopped", () => {
    it("pause の後に is_stopped が true", async () => {
      await enable("n1");
      const before = await callLocal("is_stopped", { node_id: "n1" });
      expect(JSON.parse(before.text)).toEqual({ stopped: false, reason: null });

      const paused = await callLocal("pause", { node_id: "n1", reason: "テストが壊れている" });
      expect(paused.isError).toBe(false);
      expect(JSON.parse(paused.text)).toMatchObject({ nodeId: "n1", paused: true, pauseReason: "テストが壊れている" });

      const after = await callLocal("is_stopped", { node_id: "n1" });
      expect(JSON.parse(after.text)).toEqual({ stopped: true, reason: "テストが壊れている" });
    });

    it("全体停止なら、有効な Node でも is_stopped が true", async () => {
      await enable("n1");
      await testDb.db.insert(devloopControl).values({
        key: "global_stop",
        value: JSON.stringify({ on: true, reason: "持ち主が止めた" }),
      });
      const { text, isError } = await callLocal("is_stopped", { node_id: "n1" });
      expect(isError).toBe(false);
      expect(JSON.parse(text)).toEqual({ stopped: true, reason: "持ち主が止めた" });

      const next = await callLocal("next_project", {});
      expect(JSON.parse(next.text)).toBeNull();
    });

    it("存在しない Node では not_found", async () => {
      const stopped = await callLocal("is_stopped", { node_id: "missing" });
      expect(stopped.text).toBe("not_found: Node が見つからない");
      const paused = await callLocal("pause", { node_id: "missing", reason: "理由" });
      expect(paused.text).toBe("not_found: Node が見つからない");
      expect(await testDb.db.select().from(devProjects)).toHaveLength(0);
    });

    it("pause の reason が空か長すぎると入力エラー", async () => {
      await expectInvalid("pause", { node_id: "n1", reason: "" });
      await expectInvalid("pause", { node_id: "n1", reason: "x".repeat(501) });
    });
  });

  describe("get_project の devloop", () => {
    async function insertTask(externalId: string, section: string | null, completed: boolean) {
      await testDb.db.insert(taskCache).values({
        provider: "asana",
        externalId,
        projectExternalId: "proj-n1",
        nodeId: "n1",
        name: externalId,
        completed,
        section,
      });
    }

    it("設定・停止・最後の実行・列ごとの未完了の件数・未回答の Owner 判断の件数が入る", async () => {
      await testDb.db.insert(devProjects).values({
        nodeId: "n1",
        enabled: true,
        paused: true,
        pauseReason: "様子を見る",
        autonomy: 2,
        sprintLimit: 4,
        lastRunAt: now,
      });
      await testDb.db.insert(externalRefs).values({ nodeId: "n1", provider: "asana", externalId: "proj-n1" });
      await insertTask("t1", "Inbox", false);
      await insertTask("t2", "Inbox", false);
      await insertTask("t3", "Sprint", false);
      await insertTask("t4", "Sprint", true);
      await insertTask("t5", "Owner 判断", false);
      await insertTask("t6", "Owner 判断", true);
      await insertTask("t7", null, false);

      const { text, isError } = await callLocal("get_project", { node_id: "n1" });
      expect(isError).toBe(false);
      const project = JSON.parse(text) as { devloop: Record<string, unknown> };
      expect(project.devloop).toEqual({
        settings: expect.objectContaining({
          nodeId: "n1",
          enabled: true,
          paused: true,
          pauseReason: "様子を見る",
          autonomy: 2,
          sprintLimit: 4,
        }),
        stopped: true,
        pauseReason: "様子を見る",
        lastRunAt: now.toISOString(),
        sectionCounts: {
          Inbox: 2,
          Backlog: 0,
          Sprint: 1,
          "In Progress": 0,
          "Biz Review": 0,
          Done: 0,
          "Owner 判断": 1,
          Rejected: 0,
        },
        openOwnerDecisions: 1,
      });
    });

    it("Asana につながっていない Node でも例外にせず、件数は 0。全体停止は停止として出る", async () => {
      await enable("n2");
      await testDb.db.insert(devloopControl).values({
        key: "global_stop",
        value: JSON.stringify({ on: true, reason: null }),
      });
      const { text, isError } = await callLocal("get_project", { node_id: "n2" });
      expect(isError).toBe(false);
      const project = JSON.parse(text) as {
        asana: { linked: boolean };
        devloop: { stopped: boolean; pauseReason: string | null; sectionCounts: Record<string, number>; openOwnerDecisions: number };
      };
      expect(project.asana.linked).toBe(false);
      expect(project.devloop.stopped).toBe(true);
      expect(project.devloop.pauseReason).toBe("全体停止");
      expect(Object.values(project.devloop.sectionCounts).every((n) => n === 0)).toBe(true);
      expect(project.devloop.openOwnerDecisions).toBe(0);
    });
  });

  it("Asana の環境変数が無く Tracker を作れなくても、制御のツールと get_project は動く", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await enable("n1");
      const deps: McpDeps = {
        ...localDeps(),
        tracker: () => {
          throw new Error("secret: ASANA_PAT が無い");
        },
      };
      for (const [name, args] of [
        ["get_project", { node_id: "n1" }],
        ["is_stopped", { node_id: "n1" }],
        ["next_project", {}],
        ["report_run", { node_id: "n1", phase: "plan", summary: "" }],
        ["pause", { node_id: "n1", reason: "止める" }],
      ] as const) {
        const { text, isError } = await toolText(await handleMcpRequest(callTool(name, args, LOCAL_HEADERS), deps));
        expect(isError, name).toBe(false);
        expect(text).not.toContain("secret");
      }
    } finally {
      consoleError.mockRestore();
    }
  });

  it("想定外の例外 (DB の書き込みの失敗) は internal_error だけを返し、中身を出さない", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // insert だけが SQL 入りの例外を投げる DB (監査ログの insert も失敗するが、結果はそのまま返る)
      const failing = new Proxy(testDb.db, {
        get(target, prop, receiver) {
          if (prop === "insert") {
            return () => {
              throw new Error('secret: insert into "devloop_runs" failed');
            };
          }
          return Reflect.get(target, prop, receiver) as unknown;
        },
      });
      const deps: McpDeps = { ...localDeps(), db: failing };
      const { text, isError } = await toolText(
        await handleMcpRequest(
          callTool("report_run", { node_id: "n1", phase: "plan", summary: "" }, LOCAL_HEADERS),
          deps,
        ),
      );
      expect(isError).toBe(true);
      expect(text).toBe("internal_error: 処理に失敗しました");
      expect(text).not.toContain("secret");
      expect(await testDb.db.select().from(devloopRuns)).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
    }
  });
});
