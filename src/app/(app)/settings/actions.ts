"use server";

import { ipAddress } from "@vercel/functions";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { getDb } from "@/db/client";
import { actionError, UNAUTHORIZED, type ActionResult } from "@/lib/action-result";
import { getAllowedSession } from "@/lib/auth/server";
import { allowEntryFor, isLoopback, normalizeCidr } from "@/lib/mcp/ip";
import { addAllowlistEntry, removeAllowlistEntry } from "@/lib/mcp/ip-allowlist";
import { issueToken, revokeToken, SCOPES } from "@/lib/mcp/tokens";

// 設定画面 (エージェント用トークン・IP 許可リスト) から使う操作。
// 認証の確認は各関数の先頭で行い、想定内のエラーは戻り値の ActionResult で返す
// (本番のビルドでは例外の message が画面まで届かないため)。

/** 1 日のミリ秒数 */
const DAY_MS = 24 * 60 * 60 * 1000;

const LOG = "[settings:actions] 処理に失敗しました";
const INVALID_INPUT = "入力が正しくありません";
const INVALID_NAME = "名前は 1〜60 文字で指定してください";
const INVALID_LABEL = "ラベルは 1〜60 文字で指定してください";
const INVALID_CIDR = "CIDR の形が正しくありません";
const NO_CURRENT_IP =
  "今の IP を取得できません (ローカルで動いているときは IP 許可リストは使いません)";

const issueInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z
    .array(z.enum(SCOPES))
    .min(1)
    .refine((scopes) => new Set(scopes).size === scopes.length),
  expiresInDays: z.number().int().min(1).max(365).nullable(),
});

const tokenIdSchema = z.uuid();

const ipAllowlistInputSchema = z.object({
  cidr: z.string(),
  label: z.string().trim().min(1).max(60),
});

const ipAllowlistIdSchema = z.number().int().positive();

const labelSchema = z.string().trim().min(1).max(60);

/** 検証に落ちた項目 (path の先頭) が field なら true */
function failedOn(error: z.ZodError, field: string): boolean {
  return error.issues.some((issue) => issue.path[0] === field);
}

/**
 * エージェント用トークンを発行する。
 * 値 (`raw`) はこの戻り値でだけ画面に渡す。ログには出さない。
 */
export async function issueAgentToken(input: {
  name: string;
  scopes: string[];
  expiresInDays: number | null;
}): Promise<ActionResult<{ id: string; raw: string }>> {
  if (!(await getAllowedSession())) return UNAUTHORIZED;
  const parsed = issueInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: failedOn(parsed.error, "name") ? INVALID_NAME : INVALID_INPUT,
    };
  }
  const data = parsed.data;
  const now = new Date();
  // 期限は今から expiresInDays 日後。null なら期限なし
  const expiresAt =
    data.expiresInDays === null
      ? null
      : new Date(now.getTime() + data.expiresInDays * DAY_MS);
  try {
    const issued = await issueToken(getDb(), {
      name: data.name,
      scopes: data.scopes,
      expiresAt,
      now,
    });
    revalidatePath("/settings");
    return { ok: true, value: issued };
  } catch (e) {
    return actionError(e, LOG);
  }
}

/** エージェント用トークンを失効させる。存在しないか、既に失効済みなら false */
export async function revokeAgentToken(id: string): Promise<ActionResult<boolean>> {
  if (!(await getAllowedSession())) return UNAUTHORIZED;
  const tokenId = tokenIdSchema.safeParse(id);
  if (!tokenId.success) return { ok: false, message: INVALID_INPUT };
  try {
    const revoked = await revokeToken(getDb(), tokenId.data, new Date());
    revalidatePath("/settings");
    return { ok: true, value: revoked };
  } catch (e) {
    return actionError(e, LOG);
  }
}

/** IP 許可リストに範囲を足し、正規化後の CIDR を返す */
export async function addIpAllowlist(input: {
  cidr: string;
  label: string;
}): Promise<ActionResult<string>> {
  if (!(await getAllowedSession())) return UNAUTHORIZED;
  const parsed = ipAllowlistInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: failedOn(parsed.error, "label") ? INVALID_LABEL : INVALID_INPUT,
    };
  }
  if (normalizeCidr(parsed.data.cidr) === null) {
    return { ok: false, message: INVALID_CIDR };
  }
  try {
    const cidr = await addAllowlistEntry(getDb(), parsed.data);
    revalidatePath("/settings");
    return { ok: true, value: cidr };
  } catch (e) {
    return actionError(e, LOG);
  }
}

/** IP 許可リストから 1 件を消す。存在しなければ false */
export async function removeIpAllowlist(id: number): Promise<ActionResult<boolean>> {
  if (!(await getAllowedSession())) return UNAUTHORIZED;
  const entryId = ipAllowlistIdSchema.safeParse(id);
  if (!entryId.success) return { ok: false, message: INVALID_INPUT };
  try {
    const removed = await removeAllowlistEntry(getDb(), entryId.data);
    revalidatePath("/settings");
    return { ok: true, value: removed };
  } catch (e) {
    return actionError(e, LOG);
  }
}

/** 今の送信元 IP を含む範囲を IP 許可リストに足し、その範囲を返す */
export async function allowCurrentIp(label: string): Promise<ActionResult<string>> {
  if (!(await getAllowedSession())) return UNAUTHORIZED;
  const entryLabel = labelSchema.safeParse(label);
  if (!entryLabel.success) return { ok: false, message: INVALID_LABEL };
  const ip = ipAddress(await headers());
  // ローカルで動いているときは送信元がループバックになるので、許可リストの対象にしない
  const cidr = ip === undefined || isLoopback(ip) ? null : allowEntryFor(ip);
  if (cidr === null) return { ok: false, message: NO_CURRENT_IP };
  try {
    const added = await addAllowlistEntry(getDb(), { cidr, label: entryLabel.data });
    revalidatePath("/settings");
    return { ok: true, value: added };
  } catch (e) {
    return actionError(e, LOG);
  }
}
