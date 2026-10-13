"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db/client";
import { getAllowedSession } from "@/lib/auth/server";
import {
  BoardError,
  BoardLimitError,
  createBoardService,
  LIMITS,
  type Section,
} from "@/lib/devloop/board";
import {
  type ControlSettings,
  createControlService,
  type SettingsPatch,
  SettingsPatchSchema,
} from "@/lib/devloop/control";
import { asanaOwnerGid } from "@/lib/env";
import { NodeId } from "@/lib/manifest/schema";
import { getTracker, linkNodeToAsana } from "@/lib/tracker/service";

// devloop の画面 (Node のパネル・Owner 判断の受け箱・設定画面) から使う操作。
// 認証の確認は各関数の先頭で行い、例外は利用者向けの文言に変えて投げ直す。

/** Owner 判断の受け箱の画面 */
const OWNER_INBOX_PATH = "/owner";
/** 設定画面 */
const SETTINGS_PATH = "/settings";

const itemIdSchema = z.string().min(1).max(100);
const pauseReasonSchema = z.string().trim().min(1).max(500);
const globalStopSchema = z.object({
  on: z.boolean(),
  reason: z.string().trim().max(500).nullable(),
});
const dailyLimitSchema = z.number().int().min(1).max(20);
const answerTextSchema = z.string().trim().min(1).max(5000);

/** 入力を検証する。失敗したら中身を出さずに利用者向けの文言で投げる */
function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("入力が正しくありません");
  return result.data;
}

function limitMessage(error: BoardLimitError): string {
  switch (error.code) {
    case "inbox_full":
      return `Inbox が上限の ${LIMITS.inbox} 件に達しています`;
    case "biz_proposal_limit":
      return `Biz の提案は 1 イテレーションに ${LIMITS.bizProposalsPerIteration} 件までです`;
    case "sprint_full":
      return "Sprint が上限の件数に達しています";
  }
}

function boardMessage(error: BoardError): string {
  switch (error.code) {
    case "not_linked":
      return "この Node は Asana につながっていません。先に看板を準備してください";
    case "not_found":
      return "項目が見つかりません";
    case "node_mismatch":
      return "項目はこの Node に属していません";
  }
}

/** 看板の例外は利用者向けの文言に、それ以外は中身をログにだけ出して一律の文言に変える */
async function withUserError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BoardLimitError) throw new Error(limitMessage(error));
    if (error instanceof BoardError) throw new Error(boardMessage(error));
    console.error("[devloop:actions] 処理に失敗しました", error);
    throw new Error("処理に失敗しました");
  }
}

function boardService() {
  return createBoardService({
    db: getDb(),
    tracker: getTracker(),
    ownerAssigneeId: asanaOwnerGid() ?? undefined,
  });
}

function controlService() {
  return createControlService({ db: getDb() });
}

/** 看板を準備する。Asana のプロジェクトをつなぎ (無ければ作り)、足りない列を作る */
export async function prepareBoard(nodeId: string): Promise<{
  projectId: string;
  url: string | null;
  created: Section[];
}> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const id = parseInput(NodeId, nodeId);
  const result = await withUserError(async () => {
    const ref = await linkNodeToAsana(id);
    const { created } = await boardService().ensureSections(id);
    return { projectId: ref.externalId, url: ref.url, created };
  });
  revalidatePath("/");
  return result;
}

/** Node ごとの devloop の設定を変える (行が無ければ既定値で作る) */
export async function updateDevloopSettings(
  nodeId: string,
  patch: SettingsPatch,
): Promise<ControlSettings> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const id = parseInput(NodeId, nodeId);
  const data = parseInput(SettingsPatchSchema, patch);
  const settings = await withUserError(() =>
    controlService().updateSettings(id, data),
  );
  revalidatePath("/");
  return settings;
}

/** Node の devloop を一時停止する */
export async function pauseNode(
  nodeId: string,
  reason: string,
): Promise<ControlSettings> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const id = parseInput(NodeId, nodeId);
  const text = parseInput(pauseReasonSchema, reason);
  const settings = await withUserError(() => controlService().pause(id, text));
  revalidatePath("/");
  return settings;
}

/** Node の devloop の一時停止を解く */
export async function resumeNode(nodeId: string): Promise<ControlSettings> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const id = parseInput(NodeId, nodeId);
  const settings = await withUserError(() => controlService().resume(id));
  revalidatePath("/");
  return settings;
}

/** 全体停止を切り替える。解除するときは理由を残さない */
export async function setGlobalStop(
  on: boolean,
  reason: string | null,
): Promise<void> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const data = parseInput(globalStopSchema, { on, reason });
  // 空の理由は「理由なし」として扱う
  const stopReason = data.reason || undefined;
  await withUserError(() => controlService().setGlobalStop(data.on, stopReason));
  revalidatePath("/");
  revalidatePath(SETTINGS_PATH);
}

/** 全 Node を合わせた 1 日の上限 (1〜20) を変える */
export async function setDailyLimit(n: number): Promise<void> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const limit = parseInput(dailyLimitSchema, n);
  await withUserError(() => controlService().setDailyLimit(limit));
  revalidatePath("/");
  revalidatePath(SETTINGS_PATH);
}

/** Owner 判断に答える。答えは `[from:owner]` の印つきの Asana のコメントになる */
export async function answerOwnerDecision(
  nodeId: string,
  itemId: string,
  text: string,
): Promise<void> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const id = parseInput(NodeId, nodeId);
  const item = parseInput(itemIdSchema, itemId);
  const answer = parseInput(answerTextSchema, text);
  await withUserError(() => boardService().answerOwner(id, item, answer));
  revalidatePath("/");
  revalidatePath(OWNER_INBOX_PATH);
}
