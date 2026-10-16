import { randomUUID } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { devloopRuns } from "@/db/schema";
import type { AppDb } from "@/db/types";
import { SECTIONS } from "@/lib/devloop/board";
import { ITEM_TYPES, ItemMetaSchema } from "@/lib/devloop/item-meta";
import {
  type IterationManifest,
  IterationManifestSchema,
  upsertIteration,
} from "@/lib/devloop/iteration-manifest";
import { NodeId } from "@/lib/manifest/schema";

import {
  controlService,
  defineTool,
  requireNode,
  type ToolContext,
  ToolError,
  UNTRUSTED_NOTE,
} from "./tools";

// 看板 (board 権限) のツール。devloop の PC 側のスキルが呼ぶ。
// 権限・書き込みの回数・監査ログ・エラーの形は defineTool に任せる。
// 上限 (Inbox・Biz の提案・Sprint) と、項目と Node の照合は看板のサービスが強制する。

const ItemId = z.string().min(1).max(40);

/** エージェントが作れる列。Sprint 以降と「Owner 判断」へは move_item や request_owner で動かす */
const CREATE_SECTIONS = ["Inbox", "Backlog"] as const;

/** エージェントが名乗れる出どころ。owner は画面からだけ */
const AGENT_ORIGINS = ["pm", "biz", "tl"] as const;

/** 看板のツールを登録する。すべて board 権限の書き込み。 */
export function registerBoardTools(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    ctx,
    {
      name: "create_item",
      scope: "board",
      write: true,
      description: `看板の Inbox か Backlog に項目を作り、項目の id を返す。type はタグ <type>、origin はタグ from:<origin> として付く。meta の id を省くと種類ごとの連番を振る。Inbox の上限 (15 件) や Biz の提案の上限を超えると inbox_full / biz_proposal_limit を返す。${UNTRUSTED_NOTE}`,
      inputSchema: {
        node_id: NodeId,
        section: z.enum(CREATE_SECTIONS),
        name: z.string().min(1).max(200),
        notes: z.string().max(10_000),
        type: z.enum(ITEM_TYPES),
        origin: z.enum(AGENT_ORIGINS),
        meta: ItemMetaSchema.partial({ id: true }).optional(),
      },
    },
    async ({ node_id, section, name, notes, type, origin, meta }) => {
      const node = await requireNode(ctx.db, node_id);
      const item = await ctx.devloop().board.createItem(node.id, {
        section,
        name,
        body: notes,
        type,
        origin,
        meta,
      });
      return { id: item.id };
    },
  );

  defineTool(
    server,
    ctx,
    {
      name: "move_item",
      scope: "board",
      write: true,
      description: `項目を看板の別の列に移す。Sprint へは Node の sprintLimit までで、超えると sprint_full を返す。項目がこの Node のものでなければ node_mismatch を返す。${UNTRUSTED_NOTE}`,
      inputSchema: {
        node_id: NodeId,
        item_id: ItemId,
        section: z.enum(SECTIONS),
      },
    },
    async ({ node_id, item_id, section }) => {
      const node = await requireNode(ctx.db, node_id);
      const { board, control } = ctx.devloop();
      const { sprintLimit } = await control.getSettings(node.id);
      await board.moveItem(node.id, item_id, section, { sprintLimit });
      return { itemId: item_id, section };
    },
  );

  defineTool(
    server,
    ctx,
    {
      name: "update_item",
      scope: "board",
      write: true,
      description: `項目の meta を丸ごと置き換える (前の meta のキーは残らない)。node_id を渡すと、項目がその Node のものかを確かめる。${UNTRUSTED_NOTE}`,
      inputSchema: {
        item_id: ItemId,
        node_id: NodeId.optional(),
        meta: ItemMetaSchema,
      },
    },
    async ({ item_id, node_id, meta }) => {
      if (node_id !== undefined) await requireNode(ctx.db, node_id);
      const item = await ctx.devloop().board.updateItem(item_id, {
        nodeId: node_id,
        meta,
      });
      return { itemId: item.id, meta: item.meta };
    },
  );

  defineTool(
    server,
    ctx,
    {
      name: "comment_item",
      scope: "board",
      write: true,
      description: `項目にコメントを付ける。node_id を渡すと、項目がその Node のものかを確かめる。${UNTRUSTED_NOTE}`,
      inputSchema: {
        item_id: ItemId,
        node_id: NodeId.optional(),
        text: z.string().min(1).max(5_000),
      },
    },
    async ({ item_id, node_id, text }) => {
      if (node_id !== undefined) await requireNode(ctx.db, node_id);
      await ctx.devloop().board.commentItem(item_id, text, { nodeId: node_id });
      return { itemId: item_id, commented: true };
    },
  );

  defineTool(
    server,
    ctx,
    {
      name: "request_owner",
      scope: "board",
      write: true,
      description: `持ち主に判断を求める。「Owner 判断」の列に持ち主宛ての項目を作る。item_id を渡すと、その項目を notes で紐づけ、「Owner 判断」へ移してコメントを付ける。${UNTRUSTED_NOTE}`,
      inputSchema: {
        node_id: NodeId,
        title: z.string().min(1).max(200),
        reason: z.string().min(1).max(5_000),
        item_id: ItemId.optional(),
      },
    },
    async ({ node_id, title, reason, item_id }) => {
      const node = await requireNode(ctx.db, node_id);
      return ctx.devloop().board.requestOwner(node.id, {
        title,
        reason,
        itemId: item_id,
      });
    },
  );
}

// ---------------------------------------------------------------- 制御 (loop 権限) のツール
// devloop のランナーが tick ごとに呼ぶ。復元した R/lib/devloop/mcp-tools.ts の振る舞いをもとに、
// 入力の上限・Node との照合・実行と Node の照合を足した。

const RunId = z.string().min(1).max(100);

const RUN_STATUSES = ["running", "succeeded", "failed", "noop", "rate_limited"] as const;

const TOKENS_MAX_LENGTH = 2_000;

/** tokens は JSON にして 2,000 文字までのオブジェクト */
const TokensSchema = z.record(z.string(), z.unknown()).refine((tokens) => {
  try {
    return JSON.stringify(tokens).length <= TOKENS_MAX_LENGTH;
  } catch {
    return false;
  }
}, "tokens は JSON に変換できる 2,000 文字以内のオブジェクトにしてください");

/** 実行の行を引く (Node との照合に使う)。無ければ null。 */
async function findRun(db: AppDb, runId: string) {
  const [run] = await db
    .select({ id: devloopRuns.id, nodeId: devloopRuns.nodeId })
    .from(devloopRuns)
    .where(eq(devloopRuns.id, runId))
    .limit(1);
  return run ?? null;
}

/** 制御のツールを登録する。is_stopped だけ read 権限の読み取り、ほかは loop 権限の書き込み。 */
export function registerLoopTools(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    ctx,
    {
      name: "next_project",
      scope: "loop",
      write: true,
      description: `次に進める Node を 1 つ選び、{ nodeId, sourceRepo, autonomy, maxPbisPerIteration, sprintLimit, openIteration } を返す。リポジトリがあり、届く Node だけから選ぶ。選んだ Node には選んだ時刻を記録する。進める Node が無い・全体停止中・全体の 1 日の上限に達した、のいずれかなら null。${UNTRUSTED_NOTE}`,
      inputSchema: {},
    },
    async () => controlService(ctx).nextProject(),
  );

  defineTool(
    server,
    ctx,
    {
      name: "report_run",
      scope: "loop",
      write: true,
      description: `実行の記録を書く。status が無ければ開始 (run_id を省くとアプリが振る)、running ならハートビート、succeeded / failed / noop / rate_limited なら終了。ハートビートと終了には run_id が要る。返す値には runId を含む。失敗が 3 回続くと Node を自動で一時停止し、autoPaused: true を返す。iteration_manifest (iteration.yaml と同じ形) を渡すとイテレーションの記録を更新し、形が不正なら invalid_manifest を返して何も書かない。${UNTRUSTED_NOTE}`,
      inputSchema: {
        node_id: NodeId,
        run_id: RunId.optional(),
        phase: z.string().min(1).max(40),
        summary: z.string().max(2_000),
        status: z.enum(RUN_STATUSES).optional(),
        iteration: z.number().int().min(0).optional(),
        tokens: TokensSchema.optional(),
        iteration_manifest: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ node_id, run_id, phase, summary, status, iteration, tokens, iteration_manifest }) => {
      const node = await requireNode(ctx.db, node_id);

      // 何かを書く前に記録の形を確かめる。不正なら中身の詳細は返さない
      let manifest: IterationManifest | null = null;
      if (iteration_manifest !== undefined) {
        const parsed = IterationManifestSchema.safeParse(iteration_manifest);
        if (!parsed.success) {
          throw new ToolError("invalid_manifest", "iteration_manifest の形が正しくない");
        }
        manifest = parsed.data;
      }

      const control = controlService(ctx);
      let result: Record<string, unknown>;
      if (status === undefined) {
        // 開始
        const id = run_id ?? randomUUID();
        if (run_id !== undefined && (await findRun(ctx.db, run_id)) !== null) {
          throw new ToolError("run_exists", "その run_id の実行は既にある");
        }
        const run = await control.startRun({ id, nodeId: node.id, iteration, phase });
        if (summary !== "") await control.heartbeat(id, summary);
        result = { runId: run.id, run: summary !== "" ? { ...run, summary } : run };
      } else {
        // ハートビートと終了は、その Node の既存の実行だけを受け付ける
        if (run_id === undefined) {
          throw new ToolError("run_id_required", "ハートビートと終了には run_id が要る");
        }
        const existing = await findRun(ctx.db, run_id);
        if (existing === null) {
          throw new ToolError("run_not_found", "実行が見つからない");
        }
        if (existing.nodeId !== node.id) {
          throw new ToolError("node_mismatch", "実行がこの Node のものではない");
        }
        if (status === "running") {
          // 空の要約では、それまでの要約を消さない
          await control.heartbeat(run_id, summary === "" ? undefined : summary);
          result = { runId: run_id, status };
        } else {
          const finished = await control.finishRun(run_id, { status, summary, tokens });
          result = { runId: run_id, ...finished };
        }
      }

      if (manifest !== null) {
        await upsertIteration(ctx.db, node.id, manifest);
      }
      return result;
    },
  );

  defineTool(
    server,
    ctx,
    {
      name: "pause",
      scope: "loop",
      write: true,
      description: `Node を理由付きで一時停止にし、制御の設定を返す (止める方向だけ。再開は持ち主が画面で行う)。${UNTRUSTED_NOTE}`,
      inputSchema: {
        node_id: NodeId,
        reason: z.string().min(1).max(500),
      },
    },
    async ({ node_id, reason }) => {
      const node = await requireNode(ctx.db, node_id);
      return controlService(ctx).pause(node.id, reason);
    },
  );

  defineTool(
    server,
    ctx,
    {
      name: "is_stopped",
      scope: "read",
      write: false,
      description: `Node が止まっているかを { stopped, reason } で返す。全体停止・Node が無効・Node が一時停止、のどれかなら stopped: true。${UNTRUSTED_NOTE}`,
      inputSchema: { node_id: NodeId },
    },
    async ({ node_id }) => {
      const node = await requireNode(ctx.db, node_id);
      return controlService(ctx).isStopped(node.id);
    },
  );
}
