import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ImportResult } from "@/lib/github/types";


// run.ts が読み込む octokit は ESM 専用で、tsx が CJS として読むと入れ子の依存を
// 解決できない。"import" 条件を付けた Node で自分自身を起動し直して回避する。
if (!process.env.NODE_OPTIONS?.includes("--conditions=import")) {
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, ...process.argv.slice(1)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --conditions=import`.trim(),
      },
    },
  );
  process.exit(child.status ?? 1);
}

const { getDb } = await import("@/db/client");
const { EnvError } = await import("@/lib/env");
const { applyImportResult } = await import("@/lib/import/run");
const { parseManifest } = await import("@/lib/manifest/parse");

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
