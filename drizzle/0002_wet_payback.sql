CREATE TABLE "agent_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_allowlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"cidr" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mode" text NOT NULL,
	"token_id" text,
	"ip" text,
	"tool" text,
	"args_summary" text,
	"outcome" text NOT NULL,
	"reason" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "mcp_rate_limits" (
	"token_id" text NOT NULL,
	"kind" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mcp_rate_limits_token_id_kind_window_start_pk" PRIMARY KEY("token_id","kind","window_start")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tokens_token_hash_idx" ON "agent_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ip_allowlist_cidr_idx" ON "ip_allowlist" USING btree ("cidr");--> statement-breakpoint
CREATE INDEX "mcp_audit_log_created_at_idx" ON "mcp_audit_log" USING btree ("created_at");