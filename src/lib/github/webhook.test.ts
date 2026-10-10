import { describe, expect, test } from "vitest";
import { decideGithubAction, isAuthorizedCron } from "./webhook";

describe("decideGithubAction", () => {
  const repository = { full_name: "owner/repo", default_branch: "main" };

  test("default branch への push は import-repo", () => {
    expect(
      decideGithubAction("push", { ref: "refs/heads/main", repository }),
    ).toEqual({ kind: "import-repo", repos: ["owner/repo"] });
  });

  test("別ブランチへの push は ignore", () => {
    expect(
      decideGithubAction("push", { ref: "refs/heads/feature", repository })
        .kind,
    ).toBe("ignore");
    expect(
      decideGithubAction("push", { ref: "refs/tags/main", repository }).kind,
    ).toBe("ignore");
  });

  test("installation_repositories は追加と削除の両方の full_name を含む", () => {
    expect(
      decideGithubAction("installation_repositories", {
        action: "added",
        repositories_added: [{ full_name: "o/a" }, { full_name: "o/b" }],
        repositories_removed: [{ full_name: "o/c" }],
      }),
    ).toEqual({ kind: "import-repo", repos: ["o/a", "o/b", "o/c"] });
  });

  test("installation_repositories で変化が無ければ ignore", () => {
    expect(
      decideGithubAction("installation_repositories", {
        repositories_added: [],
        repositories_removed: [],
      }).kind,
    ).toBe("ignore");
  });

  test("installation の deleted は import-repo", () => {
    expect(
      decideGithubAction("installation", {
        action: "deleted",
        repositories: [{ full_name: "o/a" }, { full_name: "o/b" }],
      }),
    ).toEqual({ kind: "import-repo", repos: ["o/a", "o/b"] });
  });

  test("installation の deleted 以外は ignore", () => {
    expect(
      decideGithubAction("installation", {
        action: "created",
        repositories: [{ full_name: "o/a" }],
      }).kind,
    ).toBe("ignore");
  });

  test("ping やその他のイベントは ignore", () => {
    expect(decideGithubAction("ping", { zen: "hi" }).kind).toBe("ignore");
    expect(decideGithubAction("issues", {}).kind).toBe("ignore");
    expect(decideGithubAction("", {}).kind).toBe("ignore");
  });

  test("形の合わない payload は例外を投げず ignore", () => {
    const bad: unknown[] = [
      null,
      undefined,
      "text",
      42,
      [],
      {},
      { ref: 1, repository },
      { ref: "refs/heads/main" },
      { ref: "refs/heads/main", repository: { full_name: "o/r" } },
    ];
    for (const payload of bad) {
      expect(decideGithubAction("push", payload).kind).toBe("ignore");
      expect(decideGithubAction("installation", payload).kind).toBe("ignore");
      expect(
        decideGithubAction("installation_repositories", payload).kind,
      ).toBe("ignore");
    }
    expect(
      decideGithubAction("installation_repositories", {
        repositories_added: [{ name: "no-full-name" }],
      }).kind,
    ).toBe("ignore");
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
