import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";

import { agentTokens } from "@/db/schema";
import type { AppDb } from "@/db/types";

/** エージェント用トークンに付けられる権限。 */
export const SCOPES = ["read", "board", "loop"] as const;
export type Scope = (typeof SCOPES)[number];

/** トークンの値の接頭辞。これで始まらない値は DB を引かずに弾く。 */
const TOKEN_PREFIX = "msp_";
/** 検証で受け付けるトークンの値の最大長。 */
const MAX_RAW_LENGTH = 200;
/** name の最大長 (前後の空白を除いた長さ)。 */
const MAX_NAME_LENGTH = 60;

function isScope(value: unknown): value is Scope {
  return typeof value === "string" && (SCOPES as readonly string[]).includes(value);
}

/** 新しいトークンの値を作る。`msp_` + 32 バイトのランダム値の base64url。 */
export function generateRawToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/** トークンの値の SHA-256 を hex で返す。DB にはこの値だけを残す。 */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * トークンを発行する。値 (`raw`) は戻り値でだけ返し、DB にはハッシュだけを保存する。
 * name は前後の空白を除いて 1〜60 文字、scopes は 1 つ以上で重複なし。違反は Error を投げる。
 */
export async function issueToken(
  db: AppDb,
  input: { name: string; scopes: Scope[]; expiresAt: Date | null; now: Date },
): Promise<{ id: string; raw: string }> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
    throw new Error(`name は前後の空白を除いて 1〜${MAX_NAME_LENGTH} 文字にしてください`);
  }
  if (input.scopes.length === 0) {
    throw new Error("scopes を 1 つ以上指定してください");
  }
  for (const scope of input.scopes) {
    if (!isScope(scope)) {
      throw new Error(`知らない scope です: ${String(scope)}`);
    }
  }
  if (new Set(input.scopes).size !== input.scopes.length) {
    throw new Error("scopes に重複があります");
  }

  const id = randomUUID();
  const raw = generateRawToken();
  await db.insert(agentTokens).values({
    id,
    name,
    tokenHash: hashToken(raw),
    scopes: [...input.scopes],
    expiresAt: input.expiresAt,
    createdAt: input.now,
  });
  return { id, raw };
}

/** トークンを失効させる。存在しないか、既に失効済みなら false。 */
export async function revokeToken(db: AppDb, id: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(agentTokens)
    .set({ revokedAt: now })
    .where(and(eq(agentTokens.id, id), isNull(agentTokens.revokedAt)))
    .returning({ id: agentTokens.id });
  return rows.length > 0;
}

/** トークンの一覧を作成の新しい順に返す。ハッシュは返さない。 */
export async function listTokens(db: AppDb): Promise<
  Array<{
    id: string;
    name: string;
    scopes: string[];
    expiresAt: Date | null;
    revokedAt: Date | null;
    lastUsedAt: Date | null;
    createdAt: Date;
  }>
> {
  return db
    .select({
      id: agentTokens.id,
      name: agentTokens.name,
      scopes: agentTokens.scopes,
      expiresAt: agentTokens.expiresAt,
      revokedAt: agentTokens.revokedAt,
      lastUsedAt: agentTokens.lastUsedAt,
      createdAt: agentTokens.createdAt,
    })
    .from(agentTokens)
    .orderBy(desc(agentTokens.createdAt));
}

/**
 * トークンの値を確かめる。通ったら lastUsedAt を now に更新し、id と scopes を返す。
 * 接頭辞が無い・長すぎる・見つからない・失効済み・期限切れ (expiresAt <= now) なら null。
 */
export async function verifyToken(
  db: AppDb,
  raw: string,
  now: Date,
): Promise<{ id: string; scopes: Scope[] } | null> {
  // 形の合わない値は DB を引かずに弾く
  if (!raw.startsWith(TOKEN_PREFIX) || raw.length > MAX_RAW_LENGTH) {
    return null;
  }

  const hash = hashToken(raw);
  const rows = await db
    .select({
      id: agentTokens.id,
      tokenHash: agentTokens.tokenHash,
      scopes: agentTokens.scopes,
      expiresAt: agentTokens.expiresAt,
      revokedAt: agentTokens.revokedAt,
    })
    .from(agentTokens)
    .where(eq(agentTokens.tokenHash, hash))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }

  // 保存済みのハッシュとは、一定時間の比較で突き合わせる
  const expected = Buffer.from(row.tokenHash, "utf8");
  const actual = Buffer.from(hash, "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  if (row.revokedAt !== null) {
    return null;
  }
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) {
    return null;
  }

  await db.update(agentTokens).set({ lastUsedAt: now }).where(eq(agentTokens.id, row.id));

  return { id: row.id, scopes: row.scopes.filter(isScope) };
}
