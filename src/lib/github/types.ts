/** fullName は "owner/name" */
export type RepoRef = {
  id: number;
  fullName: string;
  defaultBranch: string;
  description: string | null;
  topics: string[];
  homepage: string | null;
  htmlUrl: string;
  archived: boolean;
};

export type RepoFile = { content: string; sha: string };

/** GitHub への依存をまとめたもの。テストでは偽物に差し替える */
export interface RepoSource {
  listRepos(): Promise<RepoRef[]>;
  /** App が入っていなければ null */
  getRepo(fullName: string): Promise<RepoRef | null>;
  /** App が入っていなければ null */
  getRepoById(id: number): Promise<RepoRef | null>;
  /** 無ければ null。テキストとして返す */
  getFile(fullName: string, path: string, ref: string): Promise<RepoFile | null>;
  /** 画像などのバイナリ用。無ければ null */
  getRawFile(
    fullName: string,
    path: string,
    ref: string,
  ): Promise<{ bytes: Uint8Array } | null>;
}
