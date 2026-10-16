import { describe, expect, test } from "vitest";
import {
  decideGithubAction,
  explainGithubAction,
  isAuthorizedCron,
} from "./webhook";

describe("decideGithubAction", () => {
  const repository = { id: 101, full_name: "owner/repo" };

  test("repository の renamed・transferred・archived・unarchived は refresh", () => {
    for (const action of ["renamed", "transferred", "archived", "unarchived"]) {
      expect(decideGithubAction("repository", { action, repository })).toEqual([
        { kind: "refresh", repos: [{ id: 101, fullName: "owner/repo" }] },
      ]);
    }
  });

  test("repository の deleted は unreachable", () => {
    expect(
      decideGithubAction("repository", { action: "deleted", repository }),
    ).toEqual([
      { kind: "unreachable", repos: [{ id: 101, fullName: "owner/repo" }] },
    ]);
  });

  test("repository のその他の action は空", () => {
    expect(
      decideGithubAction("repository", { action: "created", repository }),
    ).toEqual([]);
    expect(
      decideGithubAction("repository", { action: "edited", repository }),
    ).toEqual([]);
  });

  test("installation_repositories は追加を refresh・削除を unreachable にする (両方なら 2 つ)", () => {
    expect(
      decideGithubAction("installation_repositories", {
        repositories_added: [
          { id: 1, full_name: "o/a" },
          { id: 2, full_name: "o/b" },
        ],
        repositories_removed: [{ id: 3, full_name: "o/c" }],
      }),
    ).toEqual([
      {
        kind: "refresh",
        repos: [
          { id: 1, fullName: "o/a" },
          { id: 2, fullName: "o/b" },
        ],
      },
      { kind: "unreachable", repos: [{ id: 3, fullName: "o/c" }] },
    ]);
  });

  test("installation_repositories は片方だけなら 1 つ", () => {
    expect(
      decideGithubAction("installation_repositories", {
        repositories_added: [{ id: 1, full_name: "o/a" }],
      }),
    ).toEqual([{ kind: "refresh", repos: [{ id: 1, fullName: "o/a" }] }]);
    expect(
      decideGithubAction("installation_repositories", {
        repositories_removed: [{ id: 2, full_name: "o/b" }],
      }),
    ).toEqual([{ kind: "unreachable", repos: [{ id: 2, fullName: "o/b" }] }]);
  });

  test("installation_repositories で変化が無ければ空", () => {
    expect(
      decideGithubAction("installation_repositories", {
        repositories_added: [],
        repositories_removed: [],
      }),
    ).toEqual([]);
    expect(decideGithubAction("installation_repositories", {})).toEqual([]);
  });

  test("installation の deleted で repositories があれば unreachable", () => {
    expect(
      decideGithubAction("installation", {
        action: "deleted",
        repositories: [
          { id: 1, full_name: "o/a" },
          { id: 2, full_name: "o/b" },
        ],
      }),
    ).toEqual([
      {
        kind: "unreachable",
        repos: [
          { id: 1, fullName: "o/a" },
          { id: 2, fullName: "o/b" },
        ],
      },
    ]);
  });

  test("installation の deleted 以外と、repositories が無い deleted は空", () => {
    expect(
      decideGithubAction("installation", {
        action: "created",
        repositories: [{ id: 1, full_name: "o/a" }],
      }),
    ).toEqual([]);
    expect(decideGithubAction("installation", { action: "deleted" })).toEqual(
      [],
    );
    expect(
      decideGithubAction("installation", {
        action: "deleted",
        repositories: [],
      }),
    ).toEqual([]);
  });

  test("push は空", () => {
    expect(
      decideGithubAction("push", {
        ref: "refs/heads/main",
        repository: { ...repository, default_branch: "main" },
      }),
    ).toEqual([]);
    expect(
      decideGithubAction("push", {
        ref: "refs/heads/feature",
        repository: { ...repository, default_branch: "main" },
      }),
    ).toEqual([]);
  });

  test("その他のイベントは空", () => {
    expect(decideGithubAction("ping", { zen: "hi" })).toEqual([]);
    expect(decideGithubAction("issues", {})).toEqual([]);
    expect(decideGithubAction("", {})).toEqual([]);
  });

  test("形の合わない payload は例外を投げず空", () => {
    const bad: unknown[] = [
      null,
      undefined,
      "text",
      42,
      [],
      {},
      { action: "renamed" }, // repository が無い
      { action: "renamed", repository: {} }, // id が無い
      { action: "renamed", repository: { id: "1", full_name: "o/r" } }, // id が文字列
      { action: "renamed", repository: { id: 1 } }, // full_name が無い
    ];
    for (const payload of bad) {
      expect(decideGithubAction("repository", payload)).toEqual([]);
      expect(decideGithubAction("installation", payload)).toEqual([]);
    }
    expect(
      decideGithubAction("installation_repositories", {
        repositories_added: [{ name: "no-full-name" }],
      }),
    ).toEqual([]);
    expect(
      decideGithubAction("installation_repositories", {
        repositories_removed: [{ full_name: "o/a" }], // id が無い
      }),
    ).toEqual([]);
    expect(
      decideGithubAction("installation", {
        action: "deleted",
        repositories: [{ full_name: "o/a" }], // id が無い
      }),
    ).toEqual([]);
  });
});

describe("explainGithubAction", () => {
  test("何もしないときの理由を返す", () => {
    expect(explainGithubAction("push", {})).not.toBe("");
    expect(explainGithubAction("ping", {})).not.toBe("");
    expect(
      explainGithubAction("repository", {
        action: "created",
        repository: { id: 1, full_name: "o/r" },
      }),
    ).not.toBe("");
    expect(explainGithubAction("installation_repositories", {})).not.toBe("");
  });
});

describe("isAuthorizedCron", () => {
  const secret = "0123456789abcdef0123";

  test("正しいトークンで true", () => {
    expect(isAuthorizedCron(`Bearer ${secret}`, secret)).toBe(true);
  });

  test("違うトークンで false", () => {
    expect(
      isAuthorizedCron(`Bearer ${secret.replace("0", "x")}`, secret),
    ).toBe(false);
    expect(isAuthorizedCron(secret, secret)).toBe(false);
  });

  test("長さ違いで false", () => {
    expect(isAuthorizedCron(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${secret.slice(1)}`, secret)).toBe(false);
    expect(isAuthorizedCron("", secret)).toBe(false);
  });

  test("null で false", () => {
    expect(isAuthorizedCron(null, secret)).toBe(false);
  });
});
