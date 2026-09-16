CREATE TABLE "gpu_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gpu_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"utilization_percent" double precision NOT NULL,
	"memory_used_bytes" bigint NOT NULL,
	"memory_total_bytes" bigint NOT NULL,
	"temperature_c" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gpu_process_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observation_id" uuid NOT NULL,
	"pid" integer NOT NULL,
	"uid" integer NOT NULL,
	"username" varchar(64) NOT NULL,
	"command" varchar(128) NOT NULL,
	"memory_used_bytes" bigint NOT NULL,
	"process_start_ticks" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gpus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workstation_id" uuid NOT NULL,
	"gpu_uuid" varchar(128) NOT NULL,
	"local_index" integer NOT NULL,
	"model" varchar(255) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"utilization_percent" double precision NOT NULL,
	"memory_used_bytes" bigint NOT NULL,
	"memory_total_bytes" bigint NOT NULL,
	"temperature_c" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gpu_observations" ADD CONSTRAINT "gpu_observations_gpu_id_gpus_id_fk" FOREIGN KEY ("gpu_id") REFERENCES "public"."gpus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpu_process_observations" ADD CONSTRAINT "gpu_process_observations_observation_id_gpu_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."gpu_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpus" ADD CONSTRAINT "gpus_workstation_id_workstations_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gpu_observations_gpu_time_unique" ON "gpu_observations" USING btree ("gpu_id","observed_at");--> statement-breakpoint
CREATE INDEX "gpu_observations_observed_at_index" ON "gpu_observations" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "gpu_process_observations_observation_index" ON "gpu_process_observations" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "gpu_process_observations_username_index" ON "gpu_process_observations" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "gpus_workstation_uuid_unique" ON "gpus" USING btree ("workstation_id","gpu_uuid");--> statement-breakpoint
CREATE INDEX "gpus_workstation_active_index" ON "gpus" USING btree ("workstation_id","active");--> statement-breakpoint
CREATE INDEX "gpus_last_observed_at_index" ON "gpus" USING btree ("last_observed_at");