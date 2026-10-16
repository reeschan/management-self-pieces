import { z } from "zod";

const NODE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const NodeId = z
  .string()
  .regex(NODE_ID_PATTERN)
  .describe("Node の ID (英小文字・数字・ハイフン、先頭は英小文字か数字、63 文字まで)");

export const RepoPath = z
  .string()
  .min(1, "空のパスは使えません")
  .refine((p) => !p.startsWith("/"), "パスは / で始められません")
  .refine((p) => !p.includes("\\"), "パスに \\ は使えません")
  .refine((p) => !p.split("/").includes(".."), "パスに .. は使えません")
  .describe("リポジトリ内の相対パス");

export const RelationType = z
  .enum(["uses", "depends-on", "derived-from", "part-of", "related"])
  .describe("関係の種類");

export const NodeStatus = z
  .enum(["idea", "active", "maintenance", "archived"])
  .describe("状態");

export const Diagram = z
  .object({
    path: RepoPath.describe("図のファイルのリポジトリ内相対パス"),
    title: z.string().optional().describe("図のタイトル"),
  })
  .describe("図");

export const Relation = z
  .object({
    type: RelationType.describe("関係の種類"),
    to: NodeId.describe("関係先の Node の ID"),
  })
  .describe("他の Node との関係");

export type RelationType = z.output<typeof RelationType>;
