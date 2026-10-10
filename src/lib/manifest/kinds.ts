import { z } from "zod";

/**
 * Node の種類 (kind) の登録表。kind を足すときはここに 1 行足すだけでよい。
 * 各 meta は未知のキーを許す (loose)。
 */
export const kinds = {
  app: {
    label: "アプリ",
    meta: z
      .object({
        url: z.url().optional().describe("公開 URL"),
        deployTarget: z.string().optional().describe("デプロイ先"),
      })
      .loose(),
  },
  skill: {
    label: "スキル",
    meta: z
      .object({
        trigger: z.string().optional().describe("起動のきっかけ"),
        runtime: z.string().optional().describe("実行環境"),
      })
      .loose(),
  },
  library: {
    label: "ライブラリ",
    meta: z
      .object({
        packageName: z.string().optional().describe("パッケージ名"),
      })
      .loose(),
  },
  doc: { label: "文書", meta: z.object({}).loose() },
  infra: { label: "インフラ", meta: z.object({}).loose() },
  other: { label: "その他", meta: z.object({}).loose() },
} as const satisfies Record<string, { label: string; meta: z.ZodObject }>;

export type KindId = keyof typeof kinds;

export const kindIds = Object.keys(kinds) as [KindId, ...KindId[]];
