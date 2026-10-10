import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Asana Webhook の X-Hook-Signature を検証する。
 * 署名は本文の HMAC-SHA256 (hex)。定数時間で比べ、null や長さ違いは false。
 */
export function verifyAsanaSignature(
  secret: string,
  rawBody: string,
  signature: string | null,
): boolean {
  if (signature === null || secret.length === 0) return false;
  const expected = Buffer.from(
    createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"),
    "utf8",
  );
  const actual = Buffer.from(signature, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
