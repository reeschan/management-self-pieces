import { z } from "zod";

import { kinds, kindIds } from "@/lib/manifest/kinds";
import {
  Diagram,
  NodeId,
  NodeStatus,
  Relation,
  RepoPath,
} from "@/lib/manifest/schema";

/** owner/name の形 (GitHub のリポジトリのフルネーム) */
const FULL_NAME_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const NodeRepo = z
  .object({
    id: z.number().int().positive().nullable().describe("GitHub のリポジトリ id"),
    fullName: z
      .string()
      .regex(FULL_NAME_PATTERN, "リポジトリは owner/name の形で指定してください")
      .describe("owner/name"),
  })
  .describe("Node のリポジトリ");

/** id を含まない項目の形。create と update で共有する */
const fieldsShape = {
  kind: z.enum(kindIds).describe("Node の種類"),
  title: z
    .string()
    .min(1, "タイトルを入力してください")
    .max(100, "タイトルは 100 文字までです"),
  summary: z.string().max(200, "概要は 200 文字までです").default(""),
  status: NodeStatus.default("active"),
  tags: z.array(z.string()).default([]),
  links: z
    .record(z.string(), z.url("リンクは URL で指定してください"))
    .default({}),
  meta: z.record(z.string(), z.unknown()).default({}),
  detailPath: RepoPath.nullable().default(null),
  diagrams: z.array(Diagram).default([]),
  relations: z.array(Relation).default([]),
};

type FieldsValue = {
  kind: keyof typeof kinds;
  meta: Record<string, unknown>;
};

/** kind ごとの meta の型を確かめる */
function checkMeta(value: FieldsValue, ctx: z.RefinementCtx): void {
  const result = kinds[value.kind].meta.safeParse(value.meta);
  if (result.success) return;
  for (const issue of result.error.issues) {
    ctx.addIssue({
      code: "custom",
      path: ["meta", ...issue.path],
      message: issue.message,
    });
  }
}

/** 自分自身への関係を許さない */
export function checkNoSelfRelation(
  id: string,
  value: { relations: { to: string }[] },
  ctx: z.RefinementCtx,
): void {
  if (value.relations.some((relation) => relation.to === id)) {
    ctx.addIssue({
      code: "custom",
      path: ["relations"],
      message: "自分自身への関係は設定できません",
    });
  }
}

/** リポジトリの無い Node は、詳細のファイルも図も持てない */
export function checkRepoLess(
  value: { detailPath: string | null; diagrams: unknown[] },
  ctx: z.RefinementCtx,
): void {
  if (value.detailPath !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["detailPath"],
      message: "リポジトリの無い Node は詳細のファイルを持てません",
    });
  }
  if (value.diagrams.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["diagrams"],
      message: "リポジトリの無い Node は図を持てません",
    });
  }
}

/** kind・title・summary・status・tags・links・meta・detailPath・diagrams・relations */
export const NodeFields = z.object(fieldsShape).superRefine(checkMeta);

export const NodeCreateInput = z
  .object({
    ...fieldsShape,
    id: NodeId,
    repo: NodeRepo.nullable(),
  })
  .superRefine((value, ctx) => {
    checkMeta(value, ctx);
    checkNoSelfRelation(value.id, value, ctx);
    if (value.repo === null) checkRepoLess(value, ctx);
  });

/** id とリポジトリは変えられない */
export const NodeUpdateInput = NodeFields;

export type NodeFields = z.output<typeof NodeFields>;
export type NodeRepo = z.output<typeof NodeRepo>;
export type NodeCreateInput = z.output<typeof NodeCreateInput>;
export type NodeUpdateInput = z.output<typeof NodeUpdateInput>;
