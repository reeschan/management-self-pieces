/**
 * ログインを許すメールアドレスかどうか。
 * 前後の空白を除き小文字にして、許可リストと完全一致で比べる。空・null・undefined は false。
 */
export function isAllowedEmail(
  email: string | null | undefined,
  allowed: readonly string[],
): boolean {
  if (typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return allowed.some((entry) => entry.trim().toLowerCase() === normalized);
}
