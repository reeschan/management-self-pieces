import { lt, sql } from "drizzle-orm";

import { mcpRateLimits } from "@/db/schema";
import type { AppDb } from "@/db/types";

export const RATE_LIMITS = { all: 1200, write: 300 } as const;

export function windowStartOf(now: Date): Date {
  const start = new Date(now.getTime());
  start.setUTCMinutes(0, 0, 0);
  return start;
}

export async function consumeRateLimit(
  db: AppDb,
  input: { tokenId: string; kind: "all" | "write"; now: Date },
): Promise<{ allowed: boolean; count: number }> {
  const [row] = await db
    .insert(mcpRateLimits)
    .values({
      tokenId: input.tokenId,
      kind: input.kind,
      windowStart: windowStartOf(input.now),
      count: 1,
    })
    .onConflictDoUpdate({
      target: [
        mcpRateLimits.tokenId,
        mcpRateLimits.kind,
        mcpRateLimits.windowStart,
      ],
      set: { count: sql`${mcpRateLimits.count} + 1` },
    })
    .returning({ count: mcpRateLimits.count });

  return { allowed: row.count <= RATE_LIMITS[input.kind], count: row.count };
}

export async function purgeRateLimits(db: AppDb, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const rows = await db
    .delete(mcpRateLimits)
    .where(lt(mcpRateLimits.windowStart, cutoff))
    .returning({ tokenId: mcpRateLimits.tokenId });
  return rows.length;
}
