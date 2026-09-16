CREATE TYPE "public"."assignment_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."provisioning_status" AS ENUM('pending', 'applied', 'error');--> statement-breakpoint
CREATE TABLE "workstation_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workstation_id" uuid NOT NULL,
	"status" "assignment_status" DEFAULT 'active' NOT NULL,
	"desired_generation" integer DEFAULT 1 NOT NULL,
	"applied_generation" integer DEFAULT 0 NOT NULL,
	"provisioning_status" "provisioning_status" DEFAULT 'pending' NOT NULL,
	"provisioning_message" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "linux_password_hash" text;--> statement-breakpoint
ALTER TABLE "workstation_assignments" ADD CONSTRAINT "workstation_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstation_assignments" ADD CONSTRAINT "workstation_assignments_workstation_id_workstations_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workstation_assignments_active_user_unique" ON "workstation_assignments" USING btree ("user_id") WHERE "workstation_assignments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "workstation_assignments_workstation_index" ON "workstation_assignments" USING btree ("workstation_id");--> statement-breakpoint
CREATE INDEX "workstation_assignments_status_index" ON "workstation_assignments" USING btree ("status");