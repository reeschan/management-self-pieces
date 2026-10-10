import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/db/client";
import { EnvError } from "@/lib/env";
import type { ImportResult } from "@/lib/github/types";
import { applyImportResult } from "@/lib/import/apply-result";
import { parseManifest } from "@/lib/manifest/parse";

const fixturesDir = path.join(process.cwd(), "fixtures");

async function main(): Promise<number> {
  const files = (await readdir(fixturesDir))
    .filter((name) => name.endsWith(".yaml"))
    .sort();

  const result: ImportResult = {
    manifests: [],
    errors: [],
    scannedRepos: files.map((name) => `fixtures/${name}`),
  };
  let failed = false;

  for (const name of files) {
    const repo = `fixtures/${name}`;
    const text = await readFile(path.join(fixturesDir, name), "utf8");
    const parsed = parseManifest(text);
    if (parsed.ok) {
      result.manifests.push({ repo, sha: "fixture", manifest: parsed.manifest });
    } else {
      failed = true;
      console.error(`${repo}: 検証に失敗しました`);
      for (const error of parsed.errors) console.error(`  ${error}`);
    }
  }
  if (failed) return 1;

  const summary = await applyImportResult(getDb(), result);
  console.log("seed 完了:", summary);
  return 0;
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof EnvError) {
    console.error(e.message);
    process.exitCode = 1;
  } else {
    throw e;
  }
}
