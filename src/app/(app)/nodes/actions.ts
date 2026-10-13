"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAllowedSession } from "@/lib/auth/server";
import { NodeId } from "@/lib/manifest/schema";
import { getNodeService } from "@/lib/nodes/server";
import { NodeServiceError } from "@/lib/nodes/service";

// Node 画面 (一覧・登録・編集・削除) から使う操作。
// 認証の確認は各関数の先頭で行い、例外は利用者向けの文言に変えて投げ直す。

/** Node の一覧の画面 */
const NODES_PATH = "/nodes";

/** 入力を検証する。失敗したら中身を出さずに利用者向けの文言で投げる */
function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("入力が正しくありません");
  return result.data;
}

/** Node の例外はその message を、それ以外は中身をログにだけ出して一律の文言に変える */
async function withUserError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof NodeServiceError) throw new Error(error.message);
    console.error("[nodes:actions] 処理に失敗しました", error);
    throw new Error("処理に失敗しました");
  }
}

/** Node を 1 つ作る */
export async function createNode(input: unknown): Promise<{ id: string }> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const result = await withUserError(() => getNodeService().create(input));
  revalidatePath("/");
  revalidatePath(NODES_PATH);
  return result;
}

/** Node の id とリポジトリ以外の項目を直す */
export async function updateNode(id: string, input: unknown): Promise<void> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const nodeId = parseInput(NodeId, id);
  await withUserError(() => getNodeService().update(nodeId, input));
  revalidatePath("/");
  revalidatePath(NODES_PATH);
}

/** Node を消す (Asana との対応や devloop の記録があるときは消せない) */
export async function deleteNode(id: string): Promise<void> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const nodeId = parseInput(NodeId, id);
  await withUserError(() => getNodeService().remove(nodeId));
  revalidatePath("/");
  revalidatePath(NODES_PATH);
}
