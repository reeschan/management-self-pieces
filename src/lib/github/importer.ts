import { parseManifest } from "@/lib/manifest/parse";
import type {
  ImportedManifest,
  ImportError,
  ImportResult,
  RepoRef,
  RepoSource,
} from "./types";

export const MANIFEST_PATH = "node.yaml";

function emptyResult(): ImportResult {
  return { manifests: [], errors: [], scannedRepos: [] };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 1 リポジトリ分の node.yaml を読む。例外は投げず、読み込みに失敗したら
 * ImportError にして scannedRepos には含めない (一時的な失敗で Node を消さないため)。
 */
async function importRef(
  source: RepoSource,
  repo: RepoRef,
): Promise<ImportResult> {
  const result = emptyResult();
  let file;
  try {
    file = await source.getFile(
      repo.fullName,
      MANIFEST_PATH,
      repo.defaultBranch,
    );
  } catch (e) {
    result.errors.push({
      repo: repo.fullName,
      path: MANIFEST_PATH,
      message: errorMessage(e),
    });
    return result;
  }

  result.scannedRepos.push(repo.fullName);
  if (file === null) return result;

  const parsed = parseManifest(file.content);
  if (parsed.ok) {
    result.manifests.push({
      repo: repo.fullName,
      sha: file.sha,
      manifest: parsed.manifest,
    });
  } else {
    result.errors.push({
      repo: repo.fullName,
      path: MANIFEST_PATH,
      message: parsed.errors.join("; "),
    });
  }
  return result;
}

export async function importRepo(
  source: RepoSource,
  fullName: string,
): Promise<ImportResult> {
  let repo: RepoRef | null;
  try {
    repo = await source.getRepo(fullName);
  } catch (e) {
    return {
      manifests: [],
      errors: [{ repo: fullName, path: MANIFEST_PATH, message: errorMessage(e) }],
      scannedRepos: [],
    };
  }
  // App が入っていない = そのリポジトリの Node は消す
  if (repo === null) {
    return { manifests: [], errors: [], scannedRepos: [fullName] };
  }
  return importRef(source, repo);
}

export async function importAll(source: RepoSource): Promise<ImportResult> {
  const repos = [...(await source.listRepos())].sort((a, b) =>
    a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : 0,
  );

  const results = await Promise.all(
    repos.map((repo) => importRef(source, repo)),
  );

  const manifests: ImportedManifest[] = [];
  const errors: ImportError[] = [];
  const scannedRepos: string[] = [];
  // id → 採用したリポジトリ (fullName の辞書順で先のもの)
  const owners = new Map<string, string>();

  for (const result of results) {
    scannedRepos.push(...result.scannedRepos);
    errors.push(...result.errors);
    for (const item of result.manifests) {
      const id = item.manifest.id;
      const owner = owners.get(id);
      if (owner !== undefined) {
        errors.push({
          repo: item.repo,
          path: MANIFEST_PATH,
          message: `id '${id}' は ${owner} と重複しています`,
        });
        continue;
      }
      owners.set(id, item.repo);
      manifests.push(item);
    }
  }

  return { manifests, errors, scannedRepos };
}
