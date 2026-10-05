CREATE TABLE "reservation_policy" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"standard_slots_per_week" integer DEFAULT 6 NOT NULL,
	"dynamic_slots_today" integer DEFAULT 3 NOT NULL,
	"dynamic_slots_tomorrow" integer DEFAULT 2 NOT NULL,
	"dynamic_slots_day_after" integer DEFAULT 1 NOT NULL,
	"overnight_slots_per_week" integer DEFAULT 2 NOT NULL,
	"time_zone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_policy_singleton" CHECK ("reservation_policy"."id" = 1),
	CONSTRAINT "reservation_policy_nonnegative" CHECK ("reservation_policy"."standard_slots_per_week" >= 0 and "reservation_policy"."dynamic_slots_today" >= 0 and "reservation_policy"."dynamic_slots_tomorrow" >= 0 and "reservation_policy"."dynamic_slots_day_after" >= 0 and "reservation_policy"."overnight_slots_per_week" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_half_hour_boundaries";--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "quota_kind" varchar(16) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "overnight_slot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_whole_minute_boundaries" CHECK (date_trunc('minute', "reservations"."start_at") = "reservations"."start_at" and date_trunc('minute', "reservations"."end_at") = "reservations"."end_at");