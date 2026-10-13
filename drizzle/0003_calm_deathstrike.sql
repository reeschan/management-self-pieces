CREATE TABLE "dev_projects" (
	"node_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"paused" boolean DEFAULT true NOT NULL,
	"pause_reason" text,
	"autonomy" integer DEFAULT 1 NOT NULL,
	"max_iterations_per_day" integer DEFAULT 1 NOT NULL,
	"max_pbis_per_iteration" integer DEFAULT 10 NOT NULL,
	"sprint_limit" integer DEFAULT 6 NOT NULL,
	"last_selected_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dev_projects_autonomy_check" CHECK ("dev_projects"."autonomy" >= 0 AND "dev_projects"."autonomy" <= 3)
);
--> statement-breakpoint
CREATE TABLE "devloop_control" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devloop_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"iteration" integer,
	"phase" text NOT NULL,
	"status" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"tokens" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "iterations" (
	"node_id" text NOT NULL,
	"number" integer NOT NULL,
	"goal" text NOT NULL,
	"phase" text NOT NULL,
	"result" text,
	"biz_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pr_url" text,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"source_sha" text,
	CONSTRAINT "iterations_node_id_number_pk" PRIMARY KEY("node_id","number")
);
--> statement-breakpoint
ALTER TABLE "task_cache" ADD COLUMN "section" text;--> statement-breakpoint
ALTER TABLE "task_cache" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "task_cache" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "dev_projects" ADD CONSTRAINT "dev_projects_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devloop_runs" ADD CONSTRAINT "devloop_runs_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iterations" ADD CONSTRAINT "iterations_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devloop_runs_node_id_started_at_idx" ON "devloop_runs" USING btree ("node_id","started_at");