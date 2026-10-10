import { getDb, type Db } from "@/db/client";
import { nodes } from "@/db/schema";
import { createRepoSource } from "@/lib/github/app";
import { importAll, importRepo } from "@/lib/github/importer";
import type { ImportResult } from "@/lib/github/types";
import { applySync } from "./apply";
import { planSync } from "./plan";

export type SyncSummary = {
  upserted: number;
  deleted: number;
  errors: number;
  scannedRepos: number;
};

/** 既存 Node を読み、計画を作って DB に反映する */
export async function applyImportResult(
  db: Db,
  result: ImportResult,
): Promise<SyncSummary> {
  const existing = await db
    .select({
      id: nodes.id,
      sourceRepo: nodes.sourceRepo,
      sourceSha: nodes.sourceSha,
    })
    .from(nodes);
  const plan = planSync(existing, result);
  await applySync(db, plan);
  return {
    upserted: plan.upserts.length,
    deleted: plan.deleteIds.length,
    errors: plan.errors.length,
    scannedRepos: plan.scopeRepos.length,
  };
}

/** App が入っている全リポジトリを取り込む */
export async function runFullImport(): Promise<SyncSummary> {
  const source = createRepoSource();
  const result = await importAll(source);
  return applyImportResult(getDb(), result);
}

/** 1 リポジトリだけ取り込む */
export async function runRepoImport(fullName: string): Promise<SyncSummary> {
  const source = createRepoSource();
  const result = await importRepo(source, fullName);
  return applyImportResult(getDb(), result);
}
