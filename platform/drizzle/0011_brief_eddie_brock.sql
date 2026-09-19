CREATE TYPE "public"."node_update_status" AS ENUM('pending', 'dispatched', 'restarting', 'succeeded', 'failed', 'rolled_back', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "node_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workstation_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"source_version" varchar(64) NOT NULL,
	"target_version" varchar(64) NOT NULL,
	"status" "node_update_status" DEFAULT 'pending' NOT NULL,
	"detail" text,
	"expires_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workstations" ADD COLUMN "node_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "node_updates" ADD CONSTRAINT "node_updates_workstation_id_workstations_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_updates" ADD CONSTRAINT "node_updates_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "node_updates_workstation_active_unique" ON "node_updates" USING btree ("workstation_id") WHERE "node_updates"."status" in ('pending', 'dispatched', 'restarting');--> statement-breakpoint
CREATE INDEX "node_updates_workstation_created_index" ON "node_updates" USING btree ("workstation_id","created_at");--> statement-breakpoint
CREATE INDEX "node_updates_expires_at_index" ON "node_updates" USING btree ("expires_at");