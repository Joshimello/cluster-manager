CREATE TYPE "public"."workstation_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "workstations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(32) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"status" "workstation_status" DEFAULT 'active' NOT NULL,
	"enrollment_token_hash" varchar(64),
	"enrollment_expires_at" timestamp with time zone,
	"enrollment_used_at" timestamp with time zone,
	"credential_hash" varchar(64),
	"credential_issued_at" timestamp with time zone,
	"enrolled_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"inventory_observed_at" timestamp with time zone,
	"node_version" varchar(64),
	"hostname" varchar(255),
	"boot_id" varchar(128),
	"uptime_seconds" bigint,
	"inventory" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workstations_name_unique" ON "workstations" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "workstations_credential_hash_unique" ON "workstations" USING btree ("credential_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "workstations_enrollment_token_hash_unique" ON "workstations" USING btree ("enrollment_token_hash");--> statement-breakpoint
CREATE INDEX "workstations_last_heartbeat_at_index" ON "workstations" USING btree ("last_heartbeat_at");