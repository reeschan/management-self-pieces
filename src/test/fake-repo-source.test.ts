import { describe, expect, test } from "vitest";
import { createFakeRepoSource } from "./fake-repo-source";

describe("メモリ上の RepoSource", () => {
  test("足りない項目を既定値で埋め、throws のものは一覧に含めない", async () => {
    const source = createFakeRepoSource([
      { fullName: "owner/one" },
      {
        fullName: "owner/two",
        id: 9,
        defaultBranch: "develop",
        description: "説明",
        topics: ["app"],
        homepage: "https://example.test",
        htmlUrl: "https://example.test/two",
        archived: true,
      },
      { fullName: "owner/three", throws: true },
    ]);
    expect(await source.listRepos()).toEqual([
      {
        id: 1,
        fullName: "owner/one",
        defaultBranch: "main",
        description: null,
        topics: [],
        homepage: null,
        htmlUrl: "https://github.com/owner/one",
        archived: false,
      },
      {
        id: 9,
        fullName: "owner/two",
        defaultBranch: "develop",
        description: "説明",
        topics: ["app"],
        homepage: "https://example.test",
        htmlUrl: "https://example.test/two",
        archived: true,
      },
    ]);
  });

  test("名前 (大文字小文字を区別しない) と id で探し、無ければ null", async () => {
    const source = createFakeRepoSource([
      { fullName: "Owner/One" },
      { fullName: "owner/two" },
    ]);
    expect(await source.getRepo("OWNER/ONE")).toEqual({
      id: 1,
      fullName: "Owner/One",
      defaultBranch: "main",
      description: null,
      topics: [],
      homepage: null,
      htmlUrl: "https://github.com/Owner/One",
      archived: false,
    });
    expect(await source.getRepo("owner/two")).toMatchObject({
      id: 2,
      fullName: "owner/two",
    });
    expect(await source.getRepoById(1)).toMatchObject({
      fullName: "Owner/One",
    });
    expect(await source.getRepoById(2)).toMatchObject({
      fullName: "owner/two",
    });
    expect(await source.getRepo("owner/missing")).toBeNull();
    expect(await source.getRepoById(99)).toBeNull();
  });

  test("throws のリポジトリの取得は例外になる", async () => {
    const source = createFakeRepoSource([
      { fullName: "owner/repo", throws: true },
    ]);
    await expect(source.getRepo("owner/repo")).rejects.toThrow();
    await expect(source.getRepo("OWNER/REPO")).rejects.toThrow();
    await expect(source.getRepoById(1)).rejects.toThrow();
    await expect(
      source.getFile("owner/repo", "node.yaml", "main"),
    ).rejects.toThrow();
    await expect(
      source.getRawFile("owner/repo", "node.yaml", "main"),
    ).rejects.toThrow();
  });

  test("ファイルを内容と固定の sha で返し、無ければ null", async () => {
    const source = createFakeRepoSource([
      {
        fullName: "owner/repo",
        files: { "node.yaml": "title: 例\n", "empty.txt": "" },
      },
    ]);
    expect(await source.getFile("OWNER/REPO", "node.yaml", "main")).toEqual({
      content: "title: 例\n",
      sha: "fake",
    });
    expect(await source.getFile("owner/repo", "empty.txt", "main")).toEqual({
      content: "",
      sha: "fake",
    });
    expect(
      await source.getFile("owner/repo", "missing.yaml", "main"),
    ).toBeNull();
    expect(
      await source.getFile("owner/missing", "node.yaml", "main"),
    ).toBeNull();
    expect(
      await source.getRawFile("owner/repo", "node.yaml", "main"),
    ).toEqual({ bytes: new TextEncoder().encode("title: 例\n") });
    expect(
      await source.getRawFile("owner/repo", "missing.yaml", "main"),
    ).toBeNull();
  });
});
