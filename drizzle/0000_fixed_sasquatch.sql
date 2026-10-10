CREATE TABLE "external_refs" (
	"node_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "external_refs_node_id_provider_pk" PRIMARY KEY("node_id","provider")
);
--> statement-breakpoint
CREATE TABLE "import_errors" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_repo" text NOT NULL,
	"path" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"status" text NOT NULL,
	"detail_path" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"diagrams" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_repo" text NOT NULL,
	"source_sha" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relations" (
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "relations_from_id_to_id_type_pk" PRIMARY KEY("from_id","to_id","type")
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_cache" (
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"project_external_id" text NOT NULL,
	"node_id" text NOT NULL,
	"name" text NOT NULL,
	"completed" boolean NOT NULL,
	"due_on" text,
	"url" text,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "task_cache_provider_external_id_pk" PRIMARY KEY("provider","external_id")
);
--> statement-breakpoint
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relations" ADD CONSTRAINT "relations_from_id_nodes_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_refs_provider_external_id_idx" ON "external_refs" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "import_errors_source_repo_idx" ON "import_errors" USING btree ("source_repo");--> statement-breakpoint
CREATE INDEX "task_cache_provider_project_idx" ON "task_cache" USING btree ("provider","project_external_id");