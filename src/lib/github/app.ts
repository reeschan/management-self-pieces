import { App } from "octokit";
import { githubEnv } from "@/lib/env";
import type { RepoFile, RepoRef, RepoSource } from "./types";

type InstallationOctokit = App["octokit"];

function isNotFound(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    (e as { status: unknown }).status === 404
  );
}

function splitFullName(fullName: string): { owner: string; repo: string } {
  const [owner, repo, ...rest] = fullName.split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`リポジトリ名が不正です: ${fullName}`);
  }
  return { owner, repo };
}

/** GitHub App の Installation Token で読む RepoSource */
export function createRepoSource(): RepoSource {
  const env = githubEnv();
  const app = new App({ appId: env.appId, privateKey: env.privateKey });

  // installation ごとの octokit と、リポジトリ → installation の対応をキャッシュする
  const octokits = new Map<number, Promise<InstallationOctokit>>();
  const repoInstallations = new Map<string, number | null>();

  function installationOctokit(id: number): Promise<InstallationOctokit> {
    let octokit = octokits.get(id);
    if (!octokit) {
      octokit = app.getInstallationOctokit(id);
      octokit.catch(() => octokits.delete(id));
      octokits.set(id, octokit);
    }
    return octokit;
  }

  /** App が入っていなければ null */
  async function installationIdFor(fullName: string): Promise<number | null> {
    const key = fullName.toLowerCase();
    const cached = repoInstallations.get(key);
    if (cached !== undefined) return cached;
    const { owner, repo } = splitFullName(fullName);
    try {
      const { data } = await app.octokit.request(
        "GET /repos/{owner}/{repo}/installation",
        { owner, repo },
      );
      repoInstallations.set(key, data.id);
      return data.id;
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async function octokitFor(
    fullName: string,
  ): Promise<InstallationOctokit | null> {
    const id = await installationIdFor(fullName);
    return id === null ? null : installationOctokit(id);
  }

  return {
    async listRepos(): Promise<RepoRef[]> {
      const installations = await app.octokit.paginate(
        "GET /app/installations",
        { per_page: 100 },
      );
      const refs: RepoRef[] = [];
      for (const installation of installations) {
        const octokit = await installationOctokit(installation.id);
        const repos = await octokit.paginate("GET /installation/repositories", {
          per_page: 100,
        });
        for (const repo of repos) {
          repoInstallations.set(repo.full_name.toLowerCase(), installation.id);
          refs.push({
            fullName: repo.full_name,
            defaultBranch: repo.default_branch,
          });
        }
      }
      return refs;
    },

    async getRepo(fullName: string): Promise<RepoRef | null> {
      const octokit = await octokitFor(fullName);
      if (octokit === null) return null;
      const { owner, repo } = splitFullName(fullName);
      try {
        const { data } = await octokit.request("GET /repos/{owner}/{repo}", {
          owner,
          repo,
        });
        return { fullName: data.full_name, defaultBranch: data.default_branch };
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },

    async getFile(
      fullName: string,
      path: string,
      ref: string,
    ): Promise<RepoFile | null> {
      const octokit = await octokitFor(fullName);
      if (octokit === null) return null;
      const { owner, repo } = splitFullName(fullName);
      try {
        const { data } = await octokit.request(
          "GET /repos/{owner}/{repo}/contents/{path}",
          { owner, repo, path, ref },
        );
        if (Array.isArray(data) || data.type !== "file" || !("content" in data)) {
          return null;
        }
        const content = Buffer.from(data.content, "base64").toString("utf-8");
        return { content, sha: data.sha };
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },

    async getRawFile(
      fullName: string,
      path: string,
      ref: string,
    ): Promise<{ bytes: Uint8Array } | null> {
      const octokit = await octokitFor(fullName);
      if (octokit === null) return null;
      const { owner, repo } = splitFullName(fullName);
      try {
        const response = await octokit.request(
          "GET /repos/{owner}/{repo}/contents/{path}",
          {
            owner,
            repo,
            path,
            ref,
            headers: { accept: "application/vnd.github.raw" },
            // content-type に関係なくバイト列で受け取るため、本文は自前で読む
            request: { parseSuccessResponseBody: false },
          },
        );
        const body = response.data as unknown as ReadableStream<Uint8Array> | null;
        const buffer = await new Response(body).arrayBuffer();
        return { bytes: new Uint8Array(buffer) };
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
  };
}
