import { getDb } from "@/db/client";
import { createRepoSource } from "@/lib/github/app";
import { importAll, importRepo } from "@/lib/github/importer";
import { applyImportResult, type SyncSummary } from "./apply-result";

export { applyImportResult, type SyncSummary } from "./apply-result";

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
