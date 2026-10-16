export type AssetKind = "markdown" | "svg" | "png" | "jpeg" | "webp" | "mermaid";

const KIND_BY_EXT: Record<string, AssetKind> = {
  md: "markdown",
  svg: "svg",
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  webp: "webp",
  mmd: "mermaid",
};

/** 拡張子から種類を決める (大文字小文字を無視)。対象外は null */
export function assetKindOf(path: string): AssetKind | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(KIND_BY_EXT, ext) ? KIND_BY_EXT[ext] : null;
}

const CONTENT_TYPES: Record<AssetKind, string> = {
  markdown: "text/plain; charset=utf-8",
  mermaid: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function contentTypeOf(kind: AssetKind): string {
  return CONTENT_TYPES[kind];
}

/**
 * Node に登録された detail と diagrams のパスと完全一致し、
 * かつ対象の拡張子のときだけ読ませてよい
 */
export function isAllowedAsset(
  node: { detailPath: string | null; diagrams: { path: string }[] },
  path: string,
): boolean {
  if (assetKindOf(path) === null) return false;
  if (node.detailPath !== null && path === node.detailPath) return true;
  return node.diagrams.some((d) => d.path === path);
}

const REPO_FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** "owner/name" の形なら true (fixtures/ で始まるものは false) */
export function isGithubSource(sourceRepo: string): boolean {
  if (sourceRepo.startsWith("fixtures/")) return false;
  return REPO_FULL_NAME.test(sourceRepo);
}
