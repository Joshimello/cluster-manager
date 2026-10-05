ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workstations" ADD COLUMN "deleted_at" timestamp with time zone;