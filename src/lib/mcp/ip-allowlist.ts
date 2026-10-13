import { asc, eq } from "drizzle-orm";

import { ipAllowlist } from "@/db/schema";
import type { AppDb } from "@/db/types";

import { cidrContains, normalizeCidr } from "./ip";

export async function listAllowlist(db: AppDb) {
  return db.select().from(ipAllowlist).orderBy(asc(ipAllowlist.createdAt), asc(ipAllowlist.id));
}

export async function addAllowlistEntry(db: AppDb, input: { cidr: string; label: string }): Promise<string> {
  const cidr = normalizeCidr(input.cidr);
  if (cidr === null) throw new Error("CIDR が不正です");
  const label = input.label.trim();
  if (label.length < 1 || label.length > 60) throw new Error("ラベルは 1〜60 文字で指定してください");
  await db.insert(ipAllowlist).values({ cidr, label })
    .onConflictDoNothing({ target: ipAllowlist.cidr });
  return cidr;
}

export async function removeAllowlistEntry(db: AppDb, id: number): Promise<boolean> {
  const deleted = await db.delete(ipAllowlist).where(eq(ipAllowlist.id, id))
    .returning({ id: ipAllowlist.id });
  return deleted.length > 0;
}

export async function isIpAllowed(db: AppDb, ip: string): Promise<boolean> {
  const entries = await db.select({ cidr: ipAllowlist.cidr }).from(ipAllowlist);
  return entries.some(({ cidr }) => cidrContains(cidr, ip));
}
