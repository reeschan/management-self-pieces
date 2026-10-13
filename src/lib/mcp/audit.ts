import { desc, eq, lt } from "drizzle-orm";

import { mcpAuditLog, type McpAuditLogRow } from "@/db/schema";
import type { AppDb } from "@/db/types";

export type AuditEntry = {
  mode: "local" | "host";
  tokenId: string | null;
  ip: string | null;
  tool: string | null;
  argsSummary: string | null;
  outcome: "ok" | "tool_error" | "rejected";
  reason: string | null;
  durationMs: number | null;
  now: Date;
};

export async function recordAudit(db: AppDb, entry: AuditEntry): Promise<void> {
  const { now, ...values } = entry;
  await db.insert(mcpAuditLog).values({ ...values, createdAt: now });
}

export async function listAudit(
  db: AppDb,
  input: { onlyRejected: boolean; limit: number },
): Promise<McpAuditLogRow[]> {
  const limit = Number.isNaN(input.limit)
    ? 1
    : Math.max(1, Math.min(500, Math.trunc(input.limit)));

  return db
    .select()
    .from(mcpAuditLog)
    .where(input.onlyRejected ? eq(mcpAuditLog.outcome, "rejected") : undefined)
    .orderBy(desc(mcpAuditLog.createdAt), desc(mcpAuditLog.id))
    .limit(limit);
}

export async function purgeAudit(db: AppDb, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const rows = await db
    .delete(mcpAuditLog)
    .where(lt(mcpAuditLog.createdAt, cutoff))
    .returning({ id: mcpAuditLog.id });
  return rows.length;
}

export function summarizeArgs(args: unknown): string | null {
  if (args === undefined || args === null) return null;

  const summary = typeof args === "object"
    ? Object.fromEntries(
        Object.entries(args).map(([key, value]) => {
          if (typeof value === "string" && value.length > 40) {
            return [key, `${value.slice(0, 20)}…(${value.length}文字)`];
          }
          if (Array.isArray(value)) return [key, `[${value.length}件]`];
          if (value !== null && typeof value === "object") return [key, "{…}"];
          return [key, value];
        }),
      )
    : args;

  return JSON.stringify(summary)?.slice(0, 200) ?? null;
}
