import type { RepoRef, RepoSource } from "@/lib/github/types";

export type FakeRepoInput = Partial<RepoRef> & {
  fullName: string;
  files?: Record<string, string>;
  throws?: boolean;
};

type FakeRepo = {
  ref: RepoRef;
  files: Record<string, string>;
  throws: boolean;
};

/**
 * テスト用のメモリ上の RepoSource。
 * id は指定が無ければ並び順に 1 から振る。throws は GitHub に届かないリポジトリ。
 */
export function createFakeRepoSource(repos: FakeRepoInput[]): RepoSource {
  const entries: FakeRepo[] = repos.map((repo, index) => ({
    ref: {
      id: repo.id ?? index + 1,
      fullName: repo.fullName,
      defaultBranch: repo.defaultBranch ?? "main",
      description: repo.description ?? null,
      topics: repo.topics ?? [],
      homepage: repo.homepage ?? null,
      htmlUrl: repo.htmlUrl ?? `https://github.com/${repo.fullName}`,
      archived: repo.archived ?? false,
    },
    files: repo.files ?? {},
    throws: repo.throws ?? false,
  }));

  function findByName(fullName: string): FakeRepo | undefined {
    const key = fullName.toLowerCase();
    return entries.find((entry) => entry.ref.fullName.toLowerCase() === key);
  }

  /** 見つからなければ null、届かないリポジトリなら例外 */
  function resolve(entry: FakeRepo | undefined, label: string): FakeRepo | null {
    if (entry === undefined) return null;
    if (entry.throws) throw new Error(`GitHub に接続できません: ${label}`);
    return entry;
  }

  return {
    async listRepos(): Promise<RepoRef[]> {
      return entries.filter((entry) => !entry.throws).map((entry) => entry.ref);
    },

    async getRepo(fullName: string): Promise<RepoRef | null> {
      return resolve(findByName(fullName), fullName)?.ref ?? null;
    },

    async getRepoById(id: number): Promise<RepoRef | null> {
      const entry = entries.find((entry) => entry.ref.id === id);
      return resolve(entry, `id=${id}`)?.ref ?? null;
    },

    async getFile(fullName: string, path: string) {
      const content = resolve(findByName(fullName), fullName)?.files[path];
      return content === undefined ? null : { content, sha: "fake" };
    },

    async getRawFile(fullName: string, path: string) {
      const content = resolve(findByName(fullName), fullName)?.files[path];
      return content === undefined
        ? null
        : { bytes: new TextEncoder().encode(content) };
    },
  };
}
