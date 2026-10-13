"use server";

import { ipAddress } from "@vercel/functions";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { getDb } from "@/db/client";
import { getAllowedSession } from "@/lib/auth/server";
import { allowEntryFor, isLoopback, normalizeCidr } from "@/lib/mcp/ip";
import { addAllowlistEntry, removeAllowlistEntry } from "@/lib/mcp/ip-allowlist";
import { issueToken, revokeToken, SCOPES } from "@/lib/mcp/tokens";

/** 1 日のミリ秒数 */
const DAY_MS = 24 * 60 * 60 * 1000;

const issueInputSchema = z.object({
  name: z.string().min(1).max(60),
  scopes: z.array(z.enum(SCOPES)).min(1),
  expiresInDays: z.number().int().min(1).max(365).nullable(),
});

const tokenIdSchema = z.uuid();

const ipAllowlistInputSchema = z.object({
  cidr: z.string(),
  label: z.string(),
});

const ipAllowlistIdSchema = z.number().int().positive();

const labelSchema = z.string();

/**
 * エージェント用トークンを発行する。
 * 値 (`raw`) はこの戻り値でだけ画面に渡す。ログには出さない。
 */
export async function issueAgentToken(input: {
  name: string;
  scopes: string[];
  expiresInDays: number | null;
}): Promise<{ id: string; raw: string }> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const data = issueInputSchema.parse(input);
  const now = new Date();
  // 期限は今から expiresInDays 日後。null なら期限なし
  const expiresAt =
    data.expiresInDays === null
      ? null
      : new Date(now.getTime() + data.expiresInDays * DAY_MS);
  const issued = await issueToken(getDb(), {
    name: data.name,
    scopes: data.scopes,
    expiresAt,
    now,
  });
  revalidatePath("/settings");
  return issued;
}

/** エージェント用トークンを失効させる。存在しないか、既に失効済みなら false */
export async function revokeAgentToken(id: string): Promise<boolean> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const tokenId = tokenIdSchema.parse(id);
  const revoked = await revokeToken(getDb(), tokenId, new Date());
  revalidatePath("/settings");
  return revoked;
}

/** IP 許可リストに範囲を足し、正規化後の CIDR を返す */
export async function addIpAllowlist(input: {
  cidr: string;
  label: string;
}): Promise<string> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const data = ipAllowlistInputSchema.parse(input);
  if (normalizeCidr(data.cidr) === null) {
    throw new Error("CIDR の形が正しくない");
  }
  const cidr = await addAllowlistEntry(getDb(), data);
  revalidatePath("/settings");
  return cidr;
}

/** IP 許可リストから 1 件を消す。存在しなければ false */
export async function removeIpAllowlist(id: number): Promise<boolean> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const entryId = ipAllowlistIdSchema.parse(id);
  const removed = await removeAllowlistEntry(getDb(), entryId);
  revalidatePath("/settings");
  return removed;
}

/** 今の送信元 IP を含む範囲を IP 許可リストに足し、その範囲を返す */
export async function allowCurrentIp(label: string): Promise<string> {
  if (!(await getAllowedSession())) throw new Error("unauthorized");
  const entryLabel = labelSchema.parse(label);
  const ip = ipAddress(await headers());
  // ローカルで動いているときは送信元がループバックになるので、許可リストの対象にしない
  const cidr = ip === undefined || isLoopback(ip) ? null : allowEntryFor(ip);
  if (cidr === null) {
    throw new Error(
      "今の IP を取得できない (ローカルで動いているときは IP 許可リストは使わない)",
    );
  }
  const added = await addAllowlistEntry(getDb(), { cidr, label: entryLabel });
  revalidatePath("/settings");
  return added;
}
