import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { iterations, type IterationRow } from "@/db/schema";
import type { AppDb } from "@/db/types";

const scoreSchema = z.number().int().min(1).max(5).optional();
const datetimeSchema = z.iso.datetime({ offset: true });
const statsSchema = z.record(z.string(), z.unknown()).refine((stats) => {
  try {
    return JSON.stringify(stats).length <= 10_000;
  } catch {
    return false;
  }
}, "stats は JSON に変換できる 10,000 文字以内のオブジェクトにしてください");

// 定義したキー以外は、ストーリーと採点の中も含めて捨てる。
export const IterationManifestSchema = z.object({
  number: z.number().int().min(1),
  goal: z.string().min(1).max(300),
  phase: z.enum([
    "plan", "build", "verify", "review", "retro", "groom", "release", "done", "owner_wait",
  ]),
  stories: z.array(z.object({
    id: z.string().regex(/^[SBDEC]-\d{4}$/),
    title: z.string().min(1).max(200),
    status: z.enum(["planned", "done", "carried_over", "owner", "rejected"]),
    biz: z.enum(["accepted", "changes_requested"]).optional(),
  })).max(50),
  biz_scores: z.object({
    value: scoreSchema,
    usability: scoreSchema,
    coherence: scoreSchema,
  }).default({}),
  started_at: datetimeSchema,
  result: z.enum(["accepted", "partially_accepted", "rejected", "aborted"]).optional(),
  finished_at: datetimeSchema.optional(),
  pr_url: z.url({ protocol: /^https$/ }).optional(),
  stats: statsSchema.optional(),
});

export type IterationManifest = z.infer<typeof IterationManifestSchema>;

export async function upsertIteration(
  db: AppDb,
  nodeId: string,
  manifest: IterationManifest,
): Promise<void> {
  const values = {
    goal: manifest.goal,
    phase: manifest.phase,
    stories: manifest.stories,
    bizScores: manifest.biz_scores,
    result: manifest.result ?? null,
    prUrl: manifest.pr_url ?? null,
    stats: manifest.stats ?? {},
    startedAt: new Date(manifest.started_at),
    finishedAt: manifest.finished_at ? new Date(manifest.finished_at) : null,
  };

  // 記録全体を置き換える。sourceSha は挿入・更新のどちらでも指定しない。
  await db.insert(iterations)
    .values({ nodeId, number: manifest.number, ...values })
    .onConflictDoUpdate({
      target: [iterations.nodeId, iterations.number],
      set: values,
    });
}

export async function listIterations(db: AppDb, nodeId: string): Promise<IterationRow[]> {
  return db.select().from(iterations)
    .where(eq(iterations.nodeId, nodeId))
    .orderBy(desc(iterations.number));
}
