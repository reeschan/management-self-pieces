import { describe, expect, test } from "vitest";
import {
  assetKindOf,
  contentTypeOf,
  isAllowedAsset,
  isGithubSource,
} from "./asset";

const node = {
  detailPath: "docs/detail.md",
  diagrams: [{ path: "docs/arch.svg" }, { path: "docs/flow.mmd" }],
};

describe("isAllowedAsset", () => {
  test("detailPath と diagrams のパスは true", () => {
    expect(isAllowedAsset(node, "docs/detail.md")).toBe(true);
    expect(isAllowedAsset(node, "docs/arch.svg")).toBe(true);
    expect(isAllowedAsset(node, "docs/flow.mmd")).toBe(true);
  });

  test("許可リストに無いパスは false", () => {
    for (const p of [
      ".env",
      "src/index.ts",
      "../x.svg",
      "docs/other.svg",
      "docs/../docs/arch.svg",
      "/docs/arch.svg",
      "",
    ]) {
      expect(isAllowedAsset(node, p)).toBe(false);
    }
  });

  test("許可リストにあっても拡張子が対象外なら false", () => {
    const withHtml = {
      detailPath: "docs/detail.html",
      diagrams: [{ path: "docs/page.html" }, { path: ".env" }],
    };
    expect(isAllowedAsset(withHtml, "docs/detail.html")).toBe(false);
    expect(isAllowedAsset(withHtml, "docs/page.html")).toBe(false);
    expect(isAllowedAsset(withHtml, ".env")).toBe(false);
  });
});

describe("assetKindOf", () => {
  test("拡張子から種類を判定する (大文字小文字を無視)", () => {
    expect(assetKindOf("docs/arch.SVG")).toBe("svg");
    expect(assetKindOf("docs/arch.svg")).toBe("svg");
    expect(assetKindOf("docs/flow.mmd")).toBe("mermaid");
    expect(assetKindOf("README.md")).toBe("markdown");
    expect(assetKindOf("a.png")).toBe("png");
    expect(assetKindOf("a.JPG")).toBe("jpeg");
    expect(assetKindOf("a.jpeg")).toBe("jpeg");
    expect(assetKindOf("a.webp")).toBe("webp");
  });

  test("拡張子なし・対象外は null", () => {
    expect(assetKindOf("Makefile")).toBeNull();
    expect(assetKindOf("docs/arch")).toBeNull();
    expect(assetKindOf("index.html")).toBeNull();
    expect(assetKindOf(".env")).toBeNull();
    expect(assetKindOf("a.")).toBeNull();
    expect(assetKindOf("a.toString")).toBeNull();
  });
});

describe("contentTypeOf", () => {
  test("種類ごとの Content-Type", () => {
    expect(contentTypeOf("markdown")).toBe("text/plain; charset=utf-8");
    expect(contentTypeOf("mermaid")).toBe("text/plain; charset=utf-8");
    expect(contentTypeOf("svg")).toBe("image/svg+xml");
    expect(contentTypeOf("png")).toBe("image/png");
    expect(contentTypeOf("jpeg")).toBe("image/jpeg");
    expect(contentTypeOf("webp")).toBe("image/webp");
  });
});

describe("isGithubSource", () => {
  test("owner/name は true", () => {
    expect(isGithubSource("owner/name")).toBe(true);
    expect(isGithubSource("me/my-repo.js")).toBe(true);
  });

  test("fixtures/ や形の違うものは false", () => {
    expect(isGithubSource("fixtures/a.yaml")).toBe(false);
    expect(isGithubSource("owner")).toBe(false);
    expect(isGithubSource("a/b/c")).toBe(false);
    expect(isGithubSource("")).toBe(false);
  });
});
