"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, UNAUTHORIZED, type ActionResult } from "@/lib/action-result";
import { getAllowedSession } from "@/lib/auth/server";
import { NodeId } from "@/lib/manifest/schema";
import {
  createTaskForNode,
  linkNodeToAsana,
  refreshTasks,
} from "@/lib/tracker/service";
import type { ExternalRef, TaskInput, TrackerTask } from "@/lib/tracker/types";

// Node のパネルの「チケット」タブから使う操作。
// 認証の確認は各関数の先頭で行い、想定内のエラーは戻り値の ActionResult で返す
// (本番のビルドでは例外の message が画面まで届かないため)。

const taskInputSchema: z.ZodType<TaskInput> = z.object({
  name: z.string().min(1).max(200),
  notes: z.string().optional(),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Node に Asana プロジェクトをつなぐ (無ければ作る) */
export async function linkAsanaProject(nodeId: string): Promise<ActionResult<ExternalRef>> {
  if (!(await getAllowedSession())) return UNAUTHORIZED;
  const id = NodeId.safeParse(nodeId);
  if (!id.success) return { ok: false, message: "入力が正しくありません" };
  try {
    const value = await linkNodeToAsana(id.data);
    revalidatePath("/");
    return { ok: true, value };
  } catch (e) {
    return actionError(e, "[tracker:actions] 処理に失敗しました");
  }
}

/** Node のプロジェクトにタスクを作る */
export async function createTask(
  nodeId: string,
  input: TaskInput,
): Promise<ActionResult<TrackerTask>> {
  if (!(await getAllowedSession())) return UNAUTHORIZED;
  const id = NodeId.safeParse(nodeId);
  if (!id.success) return { ok: false, message: "入力が正しくありません" };
  const data = taskInputSchema.safeParse(input);
  if (!data.success) {
    return {
      ok: false,
      message: "タスク名は 1〜200 文字、期日は YYYY-MM-DD で指定してください",
    };
  }
  try {
    const value = await createTaskForNode(id.data, data.data);
    revalidatePath("/");
    return { ok: true, value };
  } catch (e) {
    return actionError(e, "[tracker:actions] 処理に失敗しました");
  }
}

/** Node のタスクを Asana から取り直す */
export async function refreshNodeTasks(nodeId: string): Promise<ActionResult<number>> {
  if (!(await getAllowedSession())) return UNAUTHORIZED;
  const id = NodeId.safeParse(nodeId);
  if (!id.success) return { ok: false, message: "入力が正しくありません" };
  try {
    const value = await refreshTasks(id.data);
    revalidatePath("/");
    return { ok: true, value };
  } catch (e) {
    return actionError(e, "[tracker:actions] 処理に失敗しました");
  }
}
