CREATE TYPE "public"."gpu_diagnostic_outcome" AS ENUM('passed', 'faulty', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."gpu_diagnostic_scope" AS ENUM('all', 'gpu');--> statement-breakpoint
CREATE TYPE "public"."gpu_diagnostic_status" AS ENUM('pending', 'dispatched', 'running', 'cancel_requested', 'passed', 'faulty', 'failed', 'refused', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."gpu_diagnostic_workload" AS ENUM('fp32', 'fp64', 'tensor');--> statement-breakpoint
CREATE TABLE "gpu_diagnostic_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"gpu_id" uuid,
	"gpu_uuid" varchar(128) NOT NULL,
	"local_index" integer NOT NULL,
	"model" varchar(255) NOT NULL,
	"outcome" "gpu_diagnostic_outcome" NOT NULL,
	"max_temperature_c" double precision,
	"peak_utilization_percent" double precision,
	"peak_memory_bytes" bigint,
	"average_gflops" double precision,
	"maximum_gflops" double precision,
	"error_count" integer DEFAULT 0 NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gpu_diagnostic_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workstation_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"target_gpu_id" uuid,
	"target_gpu_uuids" jsonb NOT NULL,
	"scope" "gpu_diagnostic_scope" NOT NULL,
	"workload" "gpu_diagnostic_workload" DEFAULT 'fp32' NOT NULL,
	"status" "gpu_diagnostic_status" DEFAULT 'pending' NOT NULL,
	"duration_seconds" integer NOT NULL,
	"memory_percent" integer NOT NULL,
	"temperature_cutoff_c" integer NOT NULL,
	"image_digest" varchar(255) NOT NULL,
	"detail" text,
	"output_log" text,
	"reserved_until" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gpu_diagnostic_runs_duration_range" CHECK ("gpu_diagnostic_runs"."duration_seconds" between 10 and 1800),
	CONSTRAINT "gpu_diagnostic_runs_memory_range" CHECK ("gpu_diagnostic_runs"."memory_percent" between 50 and 90),
	CONSTRAINT "gpu_diagnostic_runs_temperature_range" CHECK ("gpu_diagnostic_runs"."temperature_cutoff_c" between 70 and 90),
	CONSTRAINT "gpu_diagnostic_runs_target_matches_scope" CHECK (("gpu_diagnostic_runs"."scope" = 'all' and "gpu_diagnostic_runs"."target_gpu_id" is null) or ("gpu_diagnostic_runs"."scope" = 'gpu' and "gpu_diagnostic_runs"."target_gpu_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "gpu_observations" ADD COLUMN "power_watts" double precision;--> statement-breakpoint
ALTER TABLE "gpus" ADD COLUMN "power_watts" double precision;--> statement-breakpoint
ALTER TABLE "workstations" ADD COLUMN "diagnostics_image_digest" varchar(255);--> statement-breakpoint
ALTER TABLE "gpu_diagnostic_results" ADD CONSTRAINT "gpu_diagnostic_results_run_id_gpu_diagnostic_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."gpu_diagnostic_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpu_diagnostic_results" ADD CONSTRAINT "gpu_diagnostic_results_gpu_id_gpus_id_fk" FOREIGN KEY ("gpu_id") REFERENCES "public"."gpus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpu_diagnostic_runs" ADD CONSTRAINT "gpu_diagnostic_runs_workstation_id_workstations_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpu_diagnostic_runs" ADD CONSTRAINT "gpu_diagnostic_runs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpu_diagnostic_runs" ADD CONSTRAINT "gpu_diagnostic_runs_target_gpu_id_gpus_id_fk" FOREIGN KEY ("target_gpu_id") REFERENCES "public"."gpus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gpu_diagnostic_results_run_uuid_unique" ON "gpu_diagnostic_results" USING btree ("run_id","gpu_uuid");--> statement-breakpoint
CREATE INDEX "gpu_diagnostic_results_run_index" ON "gpu_diagnostic_results" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gpu_diagnostic_runs_workstation_active_unique" ON "gpu_diagnostic_runs" USING btree ("workstation_id") WHERE "gpu_diagnostic_runs"."status" in ('pending', 'dispatched', 'running', 'cancel_requested');--> statement-breakpoint
CREATE INDEX "gpu_diagnostic_runs_workstation_created_index" ON "gpu_diagnostic_runs" USING btree ("workstation_id","created_at");--> statement-breakpoint
CREATE INDEX "gpu_diagnostic_runs_expires_at_index" ON "gpu_diagnostic_runs" USING btree ("expires_at");