CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gpu_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"status" "reservation_status" DEFAULT 'active' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"is_admin_override" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_end_after_start" CHECK ("reservations"."end_at" > "reservations"."start_at"),
	CONSTRAINT "reservations_half_hour_boundaries" CHECK (mod(extract(epoch from "reservations"."start_at")::bigint, 1800) = 0 and mod(extract(epoch from "reservations"."end_at")::bigint, 1800) = 0)
);
--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_gpu_id_gpus_id_fk" FOREIGN KEY ("gpu_id") REFERENCES "public"."gpus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservations_gpu_start_index" ON "reservations" USING btree ("gpu_id","start_at");--> statement-breakpoint
CREATE INDEX "reservations_user_start_index" ON "reservations" USING btree ("user_id","start_at");--> statement-breakpoint
CREATE INDEX "reservations_status_end_index" ON "reservations" USING btree ("status","end_at");
--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_no_active_overlap"
EXCLUDE USING gist (
	"gpu_id" WITH =,
	tstzrange("start_at", "end_at", '[)') WITH &&
) WHERE ("status" = 'active');
