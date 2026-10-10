import type { NodeManifest } from "@/lib/manifest/schema";

/** fullName は "owner/name" */
export type RepoRef = { fullName: string; defaultBranch: string };

export type RepoFile = { content: string; sha: string };

/** GitHub への依存をまとめたもの。テストでは偽物に差し替える */
export interface RepoSource {
  listRepos(): Promise<RepoRef[]>;
  /** App が入っていなければ null */
  getRepo(fullName: string): Promise<RepoRef | null>;
  /** 無ければ null。テキストとして返す */
  getFile(fullName: string, path: string, ref: string): Promise<RepoFile | null>;
  /** 画像などのバイナリ用。無ければ null */
  getRawFile(
    fullName: string,
    path: string,
    ref: string,
  ): Promise<{ bytes: Uint8Array } | null>;
}

export type ImportedManifest = {
  repo: string;
  sha: string;
  manifest: NodeManifest;
};

export type ImportError = { repo: string; path: string; message: string };

export type ImportResult = {
  manifests: ImportedManifest[];
  errors: ImportError[];
  scannedRepos: string[];
};
