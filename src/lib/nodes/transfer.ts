import { asc } from "drizzle-orm";
import { z } from "zod";

import { nodes, relations } from "@/db/schema";
import type { AppDb } from "@/db/types";
import { NodeId, RelationType } from "@/lib/manifest/schema";

import { fieldsShape, NodeCreateInput, NodeRepo } from "./input";
import { NodeServiceError } from "./service";

/** 書き出し・読み込みのファイルの 1 Node。NodeFields から relations を除き、id と repo を足したもの */
export const ExportNode = z
  .object({
    ...fieldsShape,
    id: NodeId,
    repo: NodeRepo.nullable(),
  })
  .omit({ relations: true });

const ExportRelation = z.object({
  from: NodeId,
  to: NodeId,
  type: RelationType,
});

/** 書き出し・読み込みのファイルの形 */
export const ExportFile = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  nodes: z.array(ExportNode),
  relations: z.array(ExportRelation),
});

export type ExportNode = z.output<typeof ExportNode>;
export type ExportFile = z.output<typeof ExportFile>;

export type ImportPreview =
  | { ok: true; added: number; updated: number }
  | { ok: false; errors: string[] };

type ValidationResult =
  | { ok: true; file: ExportFile; added: number; updated: number }
  | { ok: false; errors: string[] };

/** zod の issue を「パス: 理由」の 1 行にする */
function issueLine(path: readonly PropertyKey[], message: string): string {
  const text = path.join(".");
  return text === "" ? message : `${text}: ${message}`;
}

/**
 * ファイル全体を検証する。エラーはすべて集めて「パス: 理由」の配列で返す。
 * 検証に通ったときだけ、追加・更新の件数を数える。
 */
async function validateImport(db: AppDb, raw: unknown): Promise<ValidationResult> {
  const parsed = ExportFile.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => issueLine(issue.path, issue.message)),
    };
  }
  const file = parsed.data;
  const errors: string[] = [];

  // 各 Node が NodeCreateInput の決まり (meta の型・リポジトリの無い Node の detailPath と diagrams) に合うか
  file.nodes.forEach((node, index) => {
    const result = NodeCreateInput.safeParse({ ...node, relations: [] });
    if (result.success) return;
    for (const issue of result.error.issues) {
      errors.push(issueLine(["nodes", index, ...issue.path], issue.message));
    }
  });

  // ファイルの中で id が重ならないか
  const seenIds = new Map<string, number>();
  file.nodes.forEach((node, index) => {
    const first = seenIds.get(node.id);
    if (first === undefined) {
      seenIds.set(node.id, index);
      return;
    }
    errors.push(`nodes.${index}.id: ID「${node.id}」が nodes.${first} と重複しています`);
  });

  // ファイルの中でリポジトリ (id か名前の大文字小文字を無視した一致) が重ならないか
  const repoIdOwners = new Map<number, number>();
  const repoNameOwners = new Map<string, number>();
  file.nodes.forEach((node, index) => {
    const repo = node.repo;
    if (repo === null) return;
    const name = repo.fullName.toLowerCase();
    const owner =
      (repo.id === null ? undefined : repoIdOwners.get(repo.id)) ?? repoNameOwners.get(name);
    if (owner !== undefined) {
      errors.push(
        `nodes.${index}.repo: リポジトリ「${repo.fullName}」が nodes.${owner} と重複しています`,
      );
    }
    if (repo.id !== null) repoIdOwners.set(repo.id, index);
    repoNameOwners.set(name, index);
  });

  // DB の Node (関係の存在確認と、リポジトリの結び付きの確認に使う)
  const dbRows = await db
    .select({ id: nodes.id, repoId: nodes.repoId, sourceRepo: nodes.sourceRepo })
    .from(nodes);
  const dbIds = new Set(dbRows.map((row) => row.id));

  // リポジトリが DB の別の id の Node に結び付いていないか
  file.nodes.forEach((node, index) => {
    const repo = node.repo;
    if (repo === null) return;
    const name = repo.fullName.toLowerCase();
    const taken = dbRows.find(
      (row) =>
        row.id !== node.id &&
        ((repo.id !== null && row.repoId === repo.id) ||
          (row.sourceRepo !== null && row.sourceRepo.toLowerCase() === name)),
    );
    if (taken !== undefined) {
      errors.push(
        `nodes.${index}.repo: リポジトリ「${repo.fullName}」は既に Node「${taken.id}」に結び付いています`,
      );
    }
  });

  // 関係の先と元がファイルか DB にあるか
  const known = new Set([...dbIds, ...file.nodes.map((node) => node.id)]);
  file.relations.forEach((relation, index) => {
    if (!known.has(relation.from)) {
      errors.push(
        `relations.${index}.from: 関係の元の Node「${relation.from}」がファイルにも DB にもありません`,
      );
    }
    if (!known.has(relation.to)) {
      errors.push(
        `relations.${index}.to: 関係の先の Node「${relation.to}」がファイルにも DB にもありません`,
      );
    }
  });

  if (errors.length > 0) return { ok: false, errors };

  let added = 0;
  let updated = 0;
  for (const node of file.nodes) {
    if (dbIds.has(node.id)) updated += 1;
    else added += 1;
  }
  return { ok: true, file, added, updated };
}

/** 全 Node (id の昇順) と全関係 (from・to・type の昇順) を書き出す */
export async function exportNodes(db: AppDb, now: () => Date): Promise<ExportFile> {
  const nodeRows = await db.select().from(nodes).orderBy(asc(nodes.id));
  const edgeRows = await db
    .select()
    .from(relations)
    .orderBy(asc(relations.fromId), asc(relations.toId), asc(relations.type));

  return ExportFile.parse({
    version: 1,
    exportedAt: now().toISOString(),
    nodes: nodeRows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      status: row.status,
      tags: row.tags,
      links: row.links,
      meta: row.meta,
      detailPath: row.detailPath,
      diagrams: row.diagrams,
      repo: row.sourceRepo === null ? null : { id: row.repoId, fullName: row.sourceRepo },
    })),
    relations: edgeRows.map((row) => ({
      from: row.fromId,
      to: row.toId,
      type: row.type,
    })),
  });
}

/** 読み込んだときに何が変わるかだけを返す。DB は変えない */
export async function previewImport(db: AppDb, raw: unknown): Promise<ImportPreview> {
  const result = await validateImport(db, raw);
  if (!result.ok) return { ok: false, errors: result.errors };
  return { ok: true, added: result.added, updated: result.updated };
}

/**
 * 検証に通れば、Node を id で upsert し、無い関係だけを足す。ファイルに無い Node と関係は消さない。
 * 検証に落ちたら NodeServiceError("invalid") を投げ、何も書かない。
 */
export async function importNodes(
  db: AppDb,
  raw: unknown,
  now: () => Date,
): Promise<{ added: number; updated: number }> {
  const result = await validateImport(db, raw);
  if (!result.ok) {
    throw new NodeServiceError("invalid", `読み込めません。${result.errors.join(" / ")}`);
  }
  const { file } = result;
  const timestamp = now();

  for (const node of file.nodes) {
    await db
      .insert(nodes)
      .values({
        id: node.id,
        kind: node.kind,
        title: node.title,
        summary: node.summary,
        status: node.status,
        detailPath: node.detailPath,
        tags: node.tags,
        links: node.links,
        diagrams: node.diagrams,
        meta: node.meta,
        sourceRepo: node.repo?.fullName ?? null,
        repoId: node.repo?.id ?? null,
        repoReachable: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: nodes.id,
        set: {
          kind: node.kind,
          title: node.title,
          summary: node.summary,
          status: node.status,
          detailPath: node.detailPath,
          tags: node.tags,
          links: node.links,
          diagrams: node.diagrams,
          meta: node.meta,
          sourceRepo: node.repo?.fullName ?? null,
          repoId: node.repo?.id ?? null,
          updatedAt: timestamp,
        },
      });
  }

  if (file.relations.length > 0) {
    await db
      .insert(relations)
      .values(
        file.relations.map((relation) => ({
          fromId: relation.from,
          toId: relation.to,
          type: relation.type,
        })),
      )
      .onConflictDoNothing();
  }

  return { added: result.added, updated: result.updated };
}
