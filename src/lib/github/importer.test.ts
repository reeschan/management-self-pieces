import { describe, expect, test } from "vitest";
import { importAll, importRepo, MANIFEST_PATH } from "./importer";
import type { RepoFile, RepoRef, RepoSource } from "./types";

type FakeRepo = { defaultBranch?: string; file?: RepoFile; throws?: boolean };

function fakeSource(repos: Record<string, FakeRepo>): RepoSource {
  return {
    async listRepos() {
      return Object.entries(repos).map(([fullName, r]) => ({
        fullName,
        defaultBranch: r.defaultBranch ?? "main",
      }));
    },
    async getRepo(fullName): Promise<RepoRef | null> {
      const r = repos[fullName];
      return r ? { fullName, defaultBranch: r.defaultBranch ?? "main" } : null;
    },
    async getFile(fullName, path, ref) {
      const r = repos[fullName];
      if (!r) return null;
      if (r.throws) throw new Error("network error");
      expect(path).toBe(MANIFEST_PATH);
      expect(ref).toBe(r.defaultBranch ?? "main");
      return r.file ?? null;
    },
    async getRawFile() {
      return null;
    },
  };
}

function yaml(id: string, extra = ""): string {
  return `id: ${id}\nkind: app\ntitle: ${id}\nsummary: ${id} の説明\n${extra}`;
}

describe("importAll", () => {
  test("正しい node.yaml が 2 リポジトリにあると manifests が 2 件になり sha が入る", async () => {
    const result = await importAll(
      fakeSource({
        "me/a": { file: { content: yaml("app-a"), sha: "sha-a" } },
        "me/b": {
          defaultBranch: "develop",
          file: { content: yaml("app-b"), sha: "sha-b" },
        },
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.manifests).toHaveLength(2);
    expect(
      result.manifests.map((m) => [m.repo, m.sha, m.manifest.id]),
    ).toEqual([
      ["me/a", "sha-a", "app-a"],
      ["me/b", "sha-b", "app-b"],
    ]);
    expect(result.scannedRepos.sort()).toEqual(["me/a", "me/b"]);
  });

  test("node.yaml が無いリポジトリは manifests にも errors にも出ず、scannedRepos には出る", async () => {
    const result = await importAll(
      fakeSource({
        "me/a": { file: { content: yaml("app-a"), sha: "sha-a" } },
        "me/empty": {},
      }),
    );
    expect(result.manifests.map((m) => m.repo)).toEqual(["me/a"]);
    expect(result.errors).toEqual([]);
    expect(result.scannedRepos).toContain("me/empty");
  });

  test("不正な node.yaml は errors に 1 件出て、message に項目パスが含まれる", async () => {
    const result = await importAll(
      fakeSource({
        "me/bad": {
          file: {
            content: "id: bad\nkind: app\nsummary: タイトルが無い\n",
            sha: "sha-bad",
          },
        },
      }),
    );
    expect(result.manifests).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].repo).toBe("me/bad");
    expect(result.errors[0].path).toBe("node.yaml");
    expect(result.errors[0].message).toContain("title");
    expect(result.scannedRepos).toEqual(["me/bad"]);
  });

  test("同じ id が 2 リポジトリにあると辞書順で先が採用され、後は重複エラーになる", async () => {
    const result = await importAll(
      fakeSource({
        // listRepos の順序に依らず辞書順で決まることを確かめるため、後のものを先に置く
        "me/zeta": { file: { content: yaml("dup"), sha: "sha-z" } },
        "me/alpha": { file: { content: yaml("dup"), sha: "sha-a" } },
      }),
    );
    expect(result.manifests).toHaveLength(1);
    expect(result.manifests[0].repo).toBe("me/alpha");
    expect(result.errors).toEqual([
      {
        repo: "me/zeta",
        path: "node.yaml",
        message: "id 'dup' は me/alpha と重複しています",
      },
    ]);
  });

  test("getFile が例外を投げたリポジトリは errors に出て、scannedRepos に含まれない", async () => {
    const result = await importAll(
      fakeSource({
        "me/a": { file: { content: yaml("app-a"), sha: "sha-a" } },
        "me/broken": { throws: true },
      }),
    );
    expect(result.manifests.map((m) => m.repo)).toEqual(["me/a"]);
    expect(result.errors).toEqual([
      { repo: "me/broken", path: "node.yaml", message: "network error" },
    ]);
    expect(result.scannedRepos).toEqual(["me/a"]);
  });
});

describe("importRepo", () => {
  test("getRepo が null のとき scannedRepos にその名前だけが入る", async () => {
    const result = await importRepo(fakeSource({}), "me/gone");
    expect(result).toEqual({
      manifests: [],
      errors: [],
      scannedRepos: ["me/gone"],
    });
  });

  test("1 リポジトリ分の node.yaml を読む", async () => {
    const result = await importRepo(
      fakeSource({ "me/a": { file: { content: yaml("app-a"), sha: "sha-a" } } }),
      "me/a",
    );
    expect(result.manifests.map((m) => [m.repo, m.sha, m.manifest.id])).toEqual(
      [["me/a", "sha-a", "app-a"]],
    );
    expect(result.scannedRepos).toEqual(["me/a"]);
  });

  test("getFile が例外を投げると errors に出て scannedRepos は空", async () => {
    const result = await importRepo(
      fakeSource({ "me/broken": { throws: true } }),
      "me/broken",
    );
    expect(result.errors).toHaveLength(1);
    expect(result.scannedRepos).toEqual([]);
  });
});
