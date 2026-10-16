"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/db/client";
import { actionError, UNAUTHORIZED, type ActionResult } from "@/lib/action-result";
import { getAllowedSession } from "@/lib/auth/server";
import {
  exportNodes,
  importNodes,
  previewImport,
  type ImportPreview,
} from "@/lib/nodes/transfer";

/** 読み込むテキストの上限 (文字数) */
const MAX_TEXT_LENGTH = 1_000_000;

/** 想定外の例外をログに出すときの見出し */
const LOG = "[nodes:transfer-actions] 処理に失敗しました";

/** 全 Node と関係を整形した JSON 文字列として書き出す */
export async function exportNodesAction(): Promise<ActionResult<string>> {
  if (!(await getAllowedSession())) return UNAUTHORIZED;
  try {
    const file = await exportNodes(getDb(), () => new Date());
    return { ok: true, value: JSON.stringify(file, null, 2) };
  } catch (e) {
    return actionError(e, LOG);
  }
}

/** 読み込んだときに何が変わるかだけを返す。大きすぎる・JSON でないときはエラーの一覧で返す */
export async function previewImportAction(text: string): Promise<ImportPreview> {
  if (!(await getAllowedSession())) {
    return { ok: false, errors: [UNAUTHORIZED.message] };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, errors: ["ファイルが大きすぎます"] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["JSON として読めません"] };
  }
  try {
    return await previewImport(getDb(), raw);
  } catch (e) {
    const { message } = actionError(e, LOG);
    return { ok: false, errors: [message] };
  }
}

/** 検証に通れば Node を読み込み、一覧の画面のキャッシュを新しくする */
export async function importNodesAction(
  text: string,
): Promise<ActionResult<{ added: number; updated: number }>> {
  if (!(await getAllowedSession())) return UNAUTHORIZED;
  if (text.length > MAX_TEXT_LENGTH) return { ok: false, message: "ファイルが大きすぎます" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "JSON として読めません" };
  }
  try {
    const result = await importNodes(getDb(), raw, () => new Date());
    revalidatePath("/");
    revalidatePath("/nodes");
    return { ok: true, value: result };
  } catch (e) {
    return actionError(e, LOG);
  }
}
