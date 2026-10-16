import { NodeServiceError } from "@/lib/nodes/service";

// サーバーアクションの戻り値。想定内のエラーは例外にせず、この形で返す。
// 本番のビルドでは例外の message がクライアントに届かない (汎用のエラーになる) ため。

export type ActionResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** 例外を利用者向けの戻り値に直す。NodeServiceError の message はそのまま出してよい */
export function actionError(e: unknown, log: string): { ok: false; message: string } {
  if (e instanceof NodeServiceError) return { ok: false, message: e.message };
  console.error(log, e);
  return { ok: false, message: "処理に失敗しました" };
}

/** セッションが無いときの戻り値 */
export const UNAUTHORIZED: { ok: false; message: string } = {
  ok: false,
  message: "ログインし直してください",
};
