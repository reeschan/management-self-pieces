import { readFile } from "node:fs/promises";
import path from "node:path";

import { getDb } from "@/db/client";
import { EnvError } from "@/lib/env";
import { NodeServiceError } from "@/lib/nodes/service";
import { importNodes, previewImport } from "@/lib/nodes/transfer";

const fixturesPath = path.join(process.cwd(), "fixtures", "nodes.json");

async function main(): Promise<number> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(fixturesPath, "utf8"));
  } catch {
    console.error("fixtures/nodes.json を読み込めませんでした");
    return 1;
  }

  const db = getDb();
  const preview = await previewImport(db, raw);
  if (!preview.ok) {
    console.error("fixtures/nodes.json の検証に失敗しました:");
    for (const error of preview.errors) console.error(`  ${error}`);
    return 1;
  }
  console.log(`プレビュー: 追加 ${preview.added} 件、更新 ${preview.updated} 件`);

  const summary = await importNodes(db, raw, () => new Date());
  console.log(`seed 完了: 追加 ${summary.added} 件、更新 ${summary.updated} 件`);
  return 0;
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof EnvError || e instanceof NodeServiceError) {
    console.error(e.message);
    process.exitCode = 1;
  } else {
    throw e;
  }
}
