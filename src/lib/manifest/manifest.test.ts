import { describe, expect, test } from "vitest";
import { nodeJsonSchema } from "./json-schema";
import { parseManifest } from "./parse";

const minimal = `
id: my-app
kind: app
title: マイアプリ
summary: 小さなアプリ
`;

function expectError(yamlText: string, path: string) {
  const result = parseManifest(yamlText);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.errors.some((e) => e.startsWith(`${path}: `))).toBe(true);
}

describe("parseManifest", () => {
  test("最小の YAML が通り、既定値が入る", () => {
    const result = parseManifest(minimal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest).toEqual({
      id: "my-app",
      kind: "app",
      title: "マイアプリ",
      summary: "小さなアプリ",
      detail: "README.md",
      diagrams: [],
      links: {},
      status: "active",
      tags: [],
      relations: [],
      meta: {},
    });
  });

  test("すべての項目を書いた YAML が通る", () => {
    const result = parseManifest(`
id: my-app
kind: app
title: マイアプリ
summary: 小さなアプリ
detail: docs/detail.md
diagrams:
  - path: docs/arch.svg
    title: 構成図
  - path: docs/flow.svg
links:
  repo: https://github.com/example/my-app
  site: https://example.com
status: maintenance
tags: [web, nextjs]
relations:
  - type: uses
    to: shared-lib
  - type: part-of
    to: platform
meta:
  url: https://example.com
  deployTarget: vercel
  extra: 1
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.detail).toBe("docs/detail.md");
    expect(result.manifest.diagrams).toHaveLength(2);
    expect(result.manifest.relations[0]).toEqual({ type: "uses", to: "shared-lib" });
    expect(result.manifest.meta).toEqual({
      url: "https://example.com",
      deployTarget: "vercel",
      extra: 1,
    });
  });

  test("id に大文字を含むと失敗する", () => {
    expectError(minimal.replace("my-app", "My-App"), "id");
  });

  test("未登録の kind は失敗する", () => {
    expectError(minimal.replace("kind: app", "kind: unknown"), "kind");
  });

  test("diagrams[0].path が ../ を含むと失敗する", () => {
    expectError(`${minimal}diagrams:\n  - path: ../x.svg\n`, "diagrams.0.path");
  });

  test.each(["/abs.svg", "a\\b.svg", ""])("不正な相対パス %j は失敗する", (p) => {
    expectError(`${minimal}detail: ${JSON.stringify(p)}\n`, "detail");
  });

  test("kind=app で meta.url が URL でないと失敗する", () => {
    expectError(`${minimal}meta:\n  url: not-a-url\n`, "meta.url");
  });

  test("YAML の構文エラーは例外を投げずに失敗する", () => {
    let result: ReturnType<typeof parseManifest> | undefined;
    expect(() => {
      result = parseManifest("id: [unclosed\nkind: : :\n");
    }).not.toThrow();
    expect(result?.ok).toBe(false);
  });

  test("ルートがオブジェクトでないと (root) のエラーになる", () => {
    expectError("just a string", "(root)");
  });
});

describe("nodeJsonSchema", () => {
  test("主要な項目と kind の enum を含む", () => {
    const schema = nodeJsonSchema() as {
      $id: string;
      title: string;
      properties: Record<string, { enum?: string[] }>;
    };
    expect(schema.title).toBe("node.yaml");
    expect(schema.$id).toBeTruthy();
    expect(schema.properties).toHaveProperty("id");
    expect(schema.properties).toHaveProperty("kind");
    expect(schema.properties).toHaveProperty("relations");
    expect(schema.properties.kind.enum).toContain("skill");
  });
});
