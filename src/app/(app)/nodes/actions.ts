"use server";

import { revalidatePath } from "next/cache";

import { actionError, UNAUTHORIZED, type ActionResult } from "@/lib/action-result";
import { getAllowedSession } from "@/lib/auth/server";
import { NodeId } from "@/lib/manifest/schema";
import { getNodeService } from "@/lib/nodes/server";

// Node 画面 (一覧・登録・編集・削除) から使う操作。
// 認証の確認は各関数の先頭で行い、想定内のエラーは戻り値の ActionResult で返す
// (本番のビルドでは例外の message が画面まで届かないため)。

/** Node の一覧の画面 */
const NODES_PATH = "/nodes";

/** 成功したときだけ、一覧の画面のキャッシュを新しくする */
function revalidateNodes(): void {
  revalidatePath("/");
  revalidatePath(NODES_PATH);
}

/** Node を 1 つ作る */
export async function createNode(input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!(await getAllowedSession())) return UNAUTHORIZED;
  try {
    const value = await getNodeService().create(input);
    revalidateNodes();
    return { ok: true, value };
  } catch (e) {
    return actionError(e, "[nodes:actions] 処理に失敗しました");
  }
}

/** Node の id とリポジトリ以外の項目を直す */
export async function updateNode(id: string, input: unknown): Promise<ActionResult<null>> {
  if (!(await getAllowedSession())) return UNAUTHORIZED;
  const nodeId = NodeId.safeParse(id);
  if (!nodeId.success) return { ok: false, message: "入力が正しくありません" };
  try {
    await getNodeService().update(nodeId.data, input);
    revalidateNodes();
    return { ok: true, value: null };
  } catch (e) {
    return actionError(e, "[nodes:actions] 処理に失敗しました");
  }
}

/** Node を消す (Asana との対応や devloop の記録があるときは消せない) */
export async function deleteNode(id: string): Promise<ActionResult<null>> {
  if (!(await getAllowedSession())) return UNAUTHORIZED;
  const nodeId = NodeId.safeParse(id);
  if (!nodeId.success) return { ok: false, message: "入力が正しくありません" };
  try {
    await getNodeService().remove(nodeId.data);
    revalidateNodes();
    return { ok: true, value: null };
  } catch (e) {
    return actionError(e, "[nodes:actions] 処理に失敗しました");
  }
}
