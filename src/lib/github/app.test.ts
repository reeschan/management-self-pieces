import { describe, expect, test } from "vitest";
import { toRepoRef } from "./app";

describe("toRepoRef", () => {
  test("GitHub のリポジトリのオブジェクトを RepoRef に直す", () => {
    expect(
      toRepoRef({
        id: 42,
        full_name: "owner/repo",
        default_branch: "main",
        description: "説明",
        topics: ["app", "tools"],
        homepage: "https://example.test",
        html_url: "https://github.com/owner/repo",
        archived: false,
      }),
    ).toEqual({
      id: 42,
      fullName: "owner/repo",
      defaultBranch: "main",
      description: "説明",
      topics: ["app", "tools"],
      homepage: "https://example.test",
      htmlUrl: "https://github.com/owner/repo",
      archived: false,
    });
  });

  test("topics・homepage・description が無ければ既定値にする", () => {
    expect(
      toRepoRef({
        id: 7,
        full_name: "owner/repo",
        default_branch: "trunk",
        html_url: "https://github.com/owner/repo",
        archived: true,
      }),
    ).toEqual({
      id: 7,
      fullName: "owner/repo",
      defaultBranch: "trunk",
      description: null,
      topics: [],
      homepage: null,
      htmlUrl: "https://github.com/owner/repo",
      archived: true,
    });
    expect(
      toRepoRef({
        id: 8,
        full_name: "owner/repo",
        default_branch: "main",
        description: null,
        topics: [],
        homepage: "",
        html_url: "https://github.com/owner/repo",
        archived: false,
      }),
    ).toMatchObject({ description: null, topics: [], homepage: null });
  });
});
