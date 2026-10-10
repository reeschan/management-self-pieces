import { describe, expect, test } from "vitest";

import type { ImportedManifest, ImportResult } from "@/lib/github/types";
import type { NodeManifest } from "@/lib/manifest/schema";
import { planSync, type ExistingNode } from "./plan";

function manifest(
  id: string,
  repo: string,
  sha: string,
  extra: Partial<NodeManifest> = {},
): ImportedManifest {
  return {
    repo,
    sha,
    manifest: {
      id,
      kind: "app",
      title: `${id} title`,
      summary: `${id} summary`,
      detail: "README.md",
      diagrams: [],
      links: {},
      status: "active",
      tags: [],
      relations: [],
      meta: {},
      ...extra,
    },
  };
}

function result(partial: Partial<ImportResult>): ImportResult {
  return { manifests: [], errors: [], scannedRepos: [], ...partial };
}

describe("planSync", () => {
  test("新規の manifest は upserts に入り、列が正しく写される", () => {
    const plan = planSync(
      [],
      result({
        manifests: [
          manifest("alpha", "me/alpha", "sha1", {
            detail: "docs/detail.md",
            tags: ["t1"],
            links: { site: "https://example.com" },
            diagrams: [{ path: "docs/a.mmd", title: "A" }],
            status: "idea",
            meta: { url: "https://example.com" },
          }),
        ],
        scannedRepos: ["me/alpha"],
      }),
    );
    expect(plan.upserts).toHaveLength(1);
    const row = plan.upserts[0];
    expect(row).toMatchObject({
      id: "alpha",
      kind: "app",
      title: "alpha title",
      summary: "alpha summary",
      status: "idea",
      detailPath: "docs/detail.md",
      tags: ["t1"],
      links: { site: "https://example.com" },
      diagrams: [{ path: "docs/a.mmd", title: "A" }],
      meta: { url: "https://example.com" },
      sourceRepo: "me/alpha",
      sourceSha: "sha1",
    });
    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(row).not.toHaveProperty("detail");
    expect(row).not.toHaveProperty("relations");
    expect(plan.deleteIds).toEqual([]);
    expect(plan.scopeRepos).toEqual(["me/alpha"]);
  });

  test("scopeRepos 内にあって manifests に無い既存 Node は deleteIds に入る", () => {
    const existing: ExistingNode[] = [
      { id: "alpha", sourceRepo: "me/alpha", sourceSha: "old" },
      { id: "gone", sourceRepo: "me/alpha", sourceSha: "old" },
    ];
    const plan = planSync(
      existing,
      result({
        manifests: [manifest("alpha", "me/alpha", "new")],
        scannedRepos: ["me/alpha"],
      }),
    );
    expect(plan.deleteIds).toEqual(["gone"]);
    expect(plan.upserts.map((u) => u.id)).toEqual(["alpha"]);
  });

  test("App が外れたリポジトリ (manifests 無し、scannedRepos にだけある) の Node は消える", () => {
    const plan = planSync(
      [{ id: "beta", sourceRepo: "me/beta", sourceSha: "s" }],
      result({ scannedRepos: ["me/beta"] }),
    );
    expect(plan.deleteIds).toEqual(["beta"]);
    expect(plan.upserts).toEqual([]);
  });

  test("scopeRepos 外の既存 Node は deleteIds に入らない", () => {
    const existing: ExistingNode[] = [
      { id: "other", sourceRepo: "me/other", sourceSha: "s" },
      { id: "gone", sourceRepo: "me/alpha", sourceSha: "s" },
    ];
    const plan = planSync(
      existing,
      result({ manifests: [], scannedRepos: ["me/alpha"] }),
    );
    expect(plan.deleteIds).toEqual(["gone"]);
    expect(plan.deleteIds).not.toContain("other");
  });

  test("別リポジトリに移った Node は upsert され、sourceRepo が書き換わり、消されない", () => {
    const plan = planSync(
      [{ id: "moved", sourceRepo: "me/old", sourceSha: "s1" }],
      result({
        manifests: [manifest("moved", "me/new", "s2")],
        scannedRepos: ["me/new", "me/old"],
      }),
    );
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]).toMatchObject({
      id: "moved",
      sourceRepo: "me/new",
      sourceSha: "s2",
    });
    expect(plan.deleteIds).toEqual([]);
  });

  test("重複した relation は 1 件になる", () => {
    const plan = planSync(
      [],
      result({
        manifests: [
          manifest("alpha", "me/alpha", "s", {
            relations: [
              { type: "uses", to: "beta" },
              { type: "uses", to: "beta" },
              { type: "related", to: "beta" },
            ],
          }),
          manifest("gamma", "me/gamma", "s", {
            relations: [{ type: "uses", to: "beta" }],
          }),
        ],
        scannedRepos: ["me/alpha", "me/gamma"],
      }),
    );
    expect(plan.relations).toEqual([
      { fromId: "alpha", toId: "beta", type: "uses" },
      { fromId: "alpha", toId: "beta", type: "related" },
      { fromId: "gamma", toId: "beta", type: "uses" },
    ]);
  });

  test("errors はそのまま渡る", () => {
    const errors = [
      { repo: "me/bad", path: "node.yaml", message: "id: 必須です" },
      { repo: "me/dup", path: "node.yaml", message: "id が重複しています" },
    ];
    const plan = planSync([], result({ errors, scannedRepos: ["me/bad"] }));
    expect(plan.errors).toEqual(errors);
  });

  test("検証エラーが出たリポジトリの既存 Node は deleteIds に入らない", () => {
    const plan = planSync(
      [{ id: "broken", sourceRepo: "me/bad", sourceSha: "s" }],
      result({
        errors: [{ repo: "me/bad", path: "node.yaml", message: "id: 必須です" }],
        scannedRepos: ["me/bad"],
      }),
    );
    expect(plan.deleteIds).toEqual([]);
  });

  test("同じ状況でエラーが無ければ、既存 Node は deleteIds に入る", () => {
    const plan = planSync(
      [{ id: "broken", sourceRepo: "me/bad", sourceSha: "s" }],
      result({ errors: [], scannedRepos: ["me/bad"] }),
    );
    expect(plan.deleteIds).toEqual(["broken"]);
  });
});
