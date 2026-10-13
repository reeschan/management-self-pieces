import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * アプリの DB は GitHub と Asana から作り直せる「表示用の一時保存」。
 * ただし MCP の口の 4 テーブル (トークン・IP 許可リスト・回数・監査ログ) は作り直せない運用データ。
 * Better Auth のテーブルは `./auth-schema.ts` に置く。
 */

export const nodes = pgTable("nodes", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull(),
  detailPath: text("detail_path").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  links: jsonb("links")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  diagrams: jsonb("diagrams")
    .$type<{ path: string; title?: string }[]>()
    .notNull()
    .default([]),
  meta: jsonb("meta")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  sourceRepo: text("source_repo").notNull(),
  sourceSha: text("source_sha").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const relations = pgTable(
  "relations",
  {
    fromId: text("from_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    // 相手の Node がまだ無くてもよいので FK は張らない
    toId: text("to_id").notNull(),
    type: text("type").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.fromId, table.toId, table.type] }),
  ],
);

export const externalRefs = pgTable(
  "external_refs",
  {
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.nodeId, table.provider] }),
    uniqueIndex("external_refs_provider_external_id_idx").on(
      table.provider,
      table.externalId,
    ),
  ],
);

export const taskCache = pgTable(
  "task_cache",
  {
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    projectExternalId: text("project_external_id").notNull(),
    nodeId: text("node_id").notNull(),
    name: text("name").notNull(),
    completed: boolean("completed").notNull(),
    dueOn: text("due_on"),
    url: text("url"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.externalId] }),
    index("task_cache_provider_project_idx").on(
      table.provider,
      table.projectExternalId,
    ),
  ],
);

export const syncState = pgTable("sync_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const importErrors = pgTable(
  "import_errors",
  {
    id: serial("id").primaryKey(),
    sourceRepo: text("source_repo").notNull(),
    path: text("path").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("import_errors_source_repo_idx").on(table.sourceRepo)],
);

// エージェント用トークン。平文は保存せずハッシュだけを持つ
export const agentTokens = pgTable(
  "agent_tokens",
  {
    // アプリ側で crypto.randomUUID() を入れる
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_tokens_token_hash_idx").on(table.tokenHash),
  ],
);

// MCP の口に入ってよい IP の範囲
export const ipAllowlist = pgTable(
  "ip_allowlist",
  {
    id: serial("id").primaryKey(),
    cidr: text("cidr").notNull(),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("ip_allowlist_cidr_idx").on(table.cidr)],
);

// トークンごと・種類ごと・時間枠ごとの呼び出し回数
export const mcpRateLimits = pgTable(
  "mcp_rate_limits",
  {
    tokenId: text("token_id").notNull(),
    // "all" か "write"
    kind: text("kind").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.tokenId, table.kind, table.windowStart] }),
  ],
);

// MCP の口への呼び出しの監査ログ
export const mcpAuditLog = pgTable(
  "mcp_audit_log",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // "local" か "host"
    mode: text("mode").notNull(),
    tokenId: text("token_id"),
    ip: text("ip"),
    tool: text("tool"),
    argsSummary: text("args_summary"),
    // "ok" / "tool_error" / "rejected"
    outcome: text("outcome").notNull(),
    reason: text("reason"),
    durationMs: integer("duration_ms"),
  },
  (table) => [index("mcp_audit_log_created_at_idx").on(table.createdAt)],
);

export type NodeRow = typeof nodes.$inferSelect;
export type NewNodeRow = typeof nodes.$inferInsert;
export type RelationRow = typeof relations.$inferSelect;
export type NewRelationRow = typeof relations.$inferInsert;
export type ExternalRefRow = typeof externalRefs.$inferSelect;
export type NewExternalRefRow = typeof externalRefs.$inferInsert;
export type TaskCacheRow = typeof taskCache.$inferSelect;
export type NewTaskCacheRow = typeof taskCache.$inferInsert;
export type SyncStateRow = typeof syncState.$inferSelect;
export type NewSyncStateRow = typeof syncState.$inferInsert;
export type ImportErrorRow = typeof importErrors.$inferSelect;
export type NewImportErrorRow = typeof importErrors.$inferInsert;
export type AgentTokenRow = typeof agentTokens.$inferSelect;
export type NewAgentTokenRow = typeof agentTokens.$inferInsert;
export type IpAllowlistRow = typeof ipAllowlist.$inferSelect;
export type NewIpAllowlistRow = typeof ipAllowlist.$inferInsert;
export type McpRateLimitRow = typeof mcpRateLimits.$inferSelect;
export type NewMcpRateLimitRow = typeof mcpRateLimits.$inferInsert;
export type McpAuditLogRow = typeof mcpAuditLog.$inferSelect;
export type NewMcpAuditLogRow = typeof mcpAuditLog.$inferInsert;
