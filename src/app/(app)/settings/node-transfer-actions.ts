"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/db/client";
import { getAllowedSession } from "@/lib/auth/server";
import { NodeServiceError } from "@/lib/nodes/service";
import {
  exportNodes,
  importNodes,
  previewImport,
  type ImportPreview,
} from "@/lib/nodes/transfer";

/** 読み込むテキストの上限 (文字数) */
const MAX_TEXT_LENGTH = 1_000_000;

/** 例外を利用者向けの文言の Error に直す。NodeServiceError の message はそのまま出してよい */
function toUserError(e: unknown): Error {
  if (e instanceof NodeServiceError) return new Error(e.message);
  return new Error("処理に失敗しました");
}

/** 全 Node と関係を整形した JSON 文字列として書き出す */
export async function exportNodesAction(): Promise<string> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  try {
    const file = await exportNodes(getDb(), () => new Date());
    return JSON.stringify(file, null, 2);
  } catch (e) {
    throw toUserError(e);
  }
}

/** 読み込んだときに何が変わるかだけを返す。大きすぎる・JSON でないときはエラーの一覧で返す */
export async function previewImportAction(text: string): Promise<ImportPreview> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
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
    throw toUserError(e);
  }
}

/** 検証に通れば Node を読み込み、一覧の画面のキャッシュを新しくする */
export async function importNodesAction(
  text: string,
): Promise<{ added: number; updated: number }> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  if (text.length > MAX_TEXT_LENGTH) throw new Error("ファイルが大きすぎます");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("JSON として読めません");
  }
  try {
    const result = await importNodes(getDb(), raw, () => new Date());
    revalidatePath("/");
    revalidatePath("/nodes");
    return result;
  } catch (e) {
    throw toUserError(e);
  }
}
