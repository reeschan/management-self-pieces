ALTER TABLE "nodes" ALTER COLUMN "detail_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ALTER COLUMN "source_repo" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "repo_id" bigint;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "repo_reachable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_source_repo_unique" UNIQUE("source_repo");--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_repo_id_unique" UNIQUE("repo_id");