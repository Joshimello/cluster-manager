CREATE TABLE "workstation_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workstation_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"cpu_utilization_percent" double precision NOT NULL,
	"memory_used_bytes" bigint NOT NULL,
	"memory_total_bytes" bigint NOT NULL,
	"storage_path" varchar(512) NOT NULL,
	"storage_used_bytes" bigint NOT NULL,
	"storage_total_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workstation_observations" ADD CONSTRAINT "workstation_observations_workstation_id_workstations_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workstation_observations_workstation_time_unique" ON "workstation_observations" USING btree ("workstation_id","observed_at");--> statement-breakpoint
CREATE INDEX "workstation_observations_observed_at_index" ON "workstation_observations" USING btree ("observed_at");