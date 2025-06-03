CREATE TABLE "runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"task_metrics_id" integer,
	"model" text NOT NULL,
	"description" text,
	"settings" jsonb,
	"pid" integer,
	"socket_path" text NOT NULL,
	"concurrency" integer DEFAULT 2 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taskMetrics" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "taskMetrics_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"tokens_context" integer NOT NULL,
	"cache_writes" integer NOT NULL,
	"cache_reads" integer NOT NULL,
	"cost" real NOT NULL,
	"duration" integer NOT NULL,
	"tool_usage" jsonb,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" integer NOT NULL,
	"task_metrics_id" integer,
	"language" text NOT NULL,
	"exercise" text NOT NULL,
	"passed" boolean,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "toolErrors" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "toolErrors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" integer,
	"task_id" integer,
	"tool_name" text NOT NULL,
	"error" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_task_metrics_id_taskMetrics_id_fk" FOREIGN KEY ("task_metrics_id") REFERENCES "public"."taskMetrics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_task_metrics_id_taskMetrics_id_fk" FOREIGN KEY ("task_metrics_id") REFERENCES "public"."taskMetrics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolErrors" ADD CONSTRAINT "toolErrors_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toolErrors" ADD CONSTRAINT "toolErrors_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_language_exercise_idx" ON "tasks" USING btree ("run_id","language","exercise");