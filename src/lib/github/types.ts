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
