import { eq, inArray, or, sql } from "drizzle-orm";
import type { z } from "zod";

import {
  devProjects,
  devloopRuns,
  externalRefs,
  iterations,
  nodes,
  relations,
} from "@/db/schema";
import type { AppDb } from "@/db/types";
import type { RepoRef, RepoSource } from "@/lib/github/types";

import {
  checkNoSelfRelation,
  checkRepoLess,
  NodeCreateInput,
  NodeUpdateInput,
} from "./input";

export type NodeErrorCode =
  | "invalid"
  | "not_found"
  | "id_taken"
  | "repo_taken"
  | "relation_target_missing"
  | "has_records"
  | "github_unavailable";

/** message は利用者向けの日本語。そのまま画面に出してよい */
export class NodeServiceError extends Error {
  code: NodeErrorCode;

  constructor(code: NodeErrorCode, message: string) {
    super(message);
    this.name = "NodeServiceError";
    this.code = code;
  }
}

export type NodeServiceDeps = {
  db: AppDb;
  /** 使うときに初めて呼ぶ (GitHub の設定が無くてもリポジトリを使わない操作は動くように) */
  source: () => RepoSource;
  now: () => Date;
};

const GITHUB_UNAVAILABLE_MESSAGE =
  "GitHub に接続できません。しばらくしてからもう一度お試しください";

/** zod の検証結果の文言を 1 つの message にまとめる */
function invalidFrom(error: z.ZodError): NodeServiceError {
  const lines = error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path === "" ? issue.message : `${path}: ${issue.message}`;
  });
  return new NodeServiceError("invalid", `入力に誤りがあります。${lines.join(" / ")}`);
}

/** リポジトリ名 (owner を除く) から Node の id の初期値を作る */
function idFromRepoName(name: string): string {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  return id === "" ? "node" : id;
}

/** 同じ (type, to) の関係を 1 つにまとめる */
function uniqueRelations<T extends { type: string; to: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((relation) => {
    const key = `${relation.type}\u0000${relation.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createNodeService(deps: NodeServiceDeps) {
  const { db } = deps;

  async function withGithub<T>(run: (source: RepoSource) => Promise<T>): Promise<T> {
    try {
      return await run(deps.source());
    } catch {
      throw new NodeServiceError("github_unavailable", GITHUB_UNAVAILABLE_MESSAGE);
    }
  }

  /** 関係の先がすべてあることを確かめる */
  async function assertTargetsExist(targets: string[]): Promise<void> {
    const wanted = [...new Set(targets)];
    if (wanted.length === 0) return;
    const rows = await db
      .select({ id: nodes.id })
      .from(nodes)
      .where(inArray(nodes.id, wanted));
    const found = new Set(rows.map((row) => row.id));
    const missing = wanted.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new NodeServiceError(
        "relation_target_missing",
        `関係の先の Node がありません: ${missing.join(", ")}`,
      );
    }
  }

  async function deletionBlockers(id: string): Promise<("asana" | "devloop")[]> {
    const blockers: ("asana" | "devloop")[] = [];

    const asana = await db
      .select({ nodeId: externalRefs.nodeId })
      .from(externalRefs)
      .where(eq(externalRefs.nodeId, id))
      .limit(1);
    if (asana.length > 0) blockers.push("asana");

    const projects = await db
      .select({ nodeId: devProjects.nodeId })
      .from(devProjects)
      .where(eq(devProjects.nodeId, id))
      .limit(1);
    const runs = await db
      .select({ id: devloopRuns.id })
      .from(devloopRuns)
      .where(eq(devloopRuns.nodeId, id))
      .limit(1);
    const iters = await db
      .select({ nodeId: iterations.nodeId })
      .from(iterations)
      .where(eq(iterations.nodeId, id))
      .limit(1);
    if (projects.length > 0 || runs.length > 0 || iters.length > 0) {
      blockers.push("devloop");
    }

    return blockers;
  }

  return {
    async listCandidates(): Promise<RepoRef[]> {
      const repos = await withGithub((source) => source.listRepos());
      const linked = await db
        .select({ repoId: nodes.repoId, sourceRepo: nodes.sourceRepo })
        .from(nodes);
      const linkedIds = new Set<number>();
      const linkedNames = new Set<string>();
      for (const row of linked) {
        if (row.repoId !== null) linkedIds.add(row.repoId);
        if (row.sourceRepo !== null) linkedNames.add(row.sourceRepo.toLowerCase());
      }
      return repos.filter(
        (repo) =>
          !linkedIds.has(repo.id) && !linkedNames.has(repo.fullName.toLowerCase()),
      );
    },

    async draftFromRepo(fullName: string): Promise<NodeCreateInput> {
      const { repo, hasReadme } = await withGithub(async (source) => {
        const found = await source.getRepo(fullName);
        if (found === null) return { repo: null, hasReadme: false };
        const readme = await source.getFile(
          found.fullName,
          "README.md",
          found.defaultBranch,
        );
        return { repo: found, hasReadme: readme !== null };
      });
      if (repo === null) {
        throw new NodeServiceError(
          "not_found",
          "リポジトリが見つかりません。GitHub App がこのリポジトリに入っているか確かめてください",
        );
      }

      const name = repo.fullName.split("/").pop() ?? repo.fullName;
      const links: Record<string, string> = { repo: repo.htmlUrl };
      if (repo.homepage !== null && repo.homepage !== "") {
        links.homepage = repo.homepage;
      }
      return {
        id: idFromRepoName(name),
        kind: "app",
        title: name.slice(0, 100),
        summary: (repo.description ?? "").slice(0, 200),
        status: "active",
        tags: [...repo.topics],
        links,
        meta: {},
        detailPath: hasReadme ? "README.md" : null,
        diagrams: [],
        relations: [],
        repo: { id: repo.id, fullName: repo.fullName },
      };
    },

    async create(input: unknown): Promise<{ id: string }> {
      const parsed = NodeCreateInput.safeParse(input);
      if (!parsed.success) throw invalidFrom(parsed.error);
      const value = parsed.data;

      const existing = await db
        .select({ id: nodes.id })
        .from(nodes)
        .where(eq(nodes.id, value.id))
        .limit(1);
      if (existing.length > 0) {
        throw new NodeServiceError("id_taken", `ID「${value.id}」は既に使われています`);
      }

      if (value.repo !== null) {
        const sameName = sql`lower(${nodes.sourceRepo}) = ${value.repo.fullName.toLowerCase()}`;
        const taken = await db
          .select({ id: nodes.id })
          .from(nodes)
          .where(
            value.repo.id !== null
              ? or(eq(nodes.repoId, value.repo.id), sameName)
              : sameName,
          )
          .limit(1);
        if (taken.length > 0) {
          throw new NodeServiceError(
            "repo_taken",
            `このリポジトリは既に Node「${taken[0].id}」に結び付いています`,
          );
        }
      }

      const edges = uniqueRelations(value.relations);
      await assertTargetsExist(edges.map((relation) => relation.to));

      const now = deps.now();
      await db.insert(nodes).values({
        id: value.id,
        kind: value.kind,
        title: value.title,
        summary: value.summary,
        status: value.status,
        detailPath: value.detailPath,
        tags: value.tags,
        links: value.links,
        diagrams: value.diagrams,
        meta: value.meta,
        sourceRepo: value.repo?.fullName ?? null,
        repoId: value.repo?.id ?? null,
        repoReachable: true,
        createdAt: now,
        updatedAt: now,
      });
      if (edges.length > 0) {
        await db.insert(relations).values(
          edges.map((relation) => ({
            fromId: value.id,
            toId: relation.to,
            type: relation.type,
          })),
        );
      }
      return { id: value.id };
    },

    async update(id: string, input: unknown): Promise<void> {
      const rows = await db.select().from(nodes).where(eq(nodes.id, id)).limit(1);
      const node = rows[0];
      if (node === undefined) {
        throw new NodeServiceError("not_found", "Node が見つかりません");
      }

      const parsed = NodeUpdateInput.superRefine((value, ctx) => {
        checkNoSelfRelation(id, value, ctx);
        if (node.sourceRepo === null) checkRepoLess(value, ctx);
      }).safeParse(input);
      if (!parsed.success) throw invalidFrom(parsed.error);
      const value = parsed.data;

      const edges = uniqueRelations(value.relations);
      await assertTargetsExist(edges.map((relation) => relation.to));

      await db
        .update(nodes)
        .set({
          kind: value.kind,
          title: value.title,
          summary: value.summary,
          status: value.status,
          detailPath: value.detailPath,
          tags: value.tags,
          links: value.links,
          diagrams: value.diagrams,
          meta: value.meta,
          updatedAt: deps.now(),
        })
        .where(eq(nodes.id, id));
      await db.delete(relations).where(eq(relations.fromId, id));
      if (edges.length > 0) {
        await db.insert(relations).values(
          edges.map((relation) => ({
            fromId: id,
            toId: relation.to,
            type: relation.type,
          })),
        );
      }
    },

    deletionBlockers,

    async remove(id: string): Promise<void> {
      const rows = await db
        .select({ id: nodes.id })
        .from(nodes)
        .where(eq(nodes.id, id))
        .limit(1);
      if (rows.length === 0) {
        throw new NodeServiceError("not_found", "Node が見つかりません");
      }
      const blockers = await deletionBlockers(id);
      if (blockers.length > 0) {
        throw new NodeServiceError(
          "has_records",
          "Asana との対応か devloop の記録があるため消せません。status を archived にしてください",
        );
      }
      // 出る関係は cascade で消える。向いた関係 (to_id) は FK が無いので自分で消す
      await db.delete(relations).where(eq(relations.toId, id));
      await db.delete(nodes).where(eq(nodes.id, id));
    },
  };
}
