CREATE TABLE "workstation_user_usage" (
	"workstation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"login_milliseconds" bigint DEFAULT 0 NOT NULL,
	"gpu_milliseconds" bigint DEFAULT 0 NOT NULL,
	"booked_gpu_milliseconds" bigint DEFAULT 0 NOT NULL,
	"observed_scheduled_milliseconds" bigint DEFAULT 0 NOT NULL,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_gpu_at" timestamp with time zone,
	"storage_bytes" bigint,
	"storage_observed_at" timestamp with time zone,
	"storage_status" varchar(32),
	CONSTRAINT "workstation_user_usage_workstation_id_user_id_pk" PRIMARY KEY("workstation_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "workstations" ADD COLUMN "user_usage_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workstations" ADD COLUMN "user_usage_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "workstation_user_usage" ADD CONSTRAINT "workstation_user_usage_workstation_id_workstations_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstation_user_usage" ADD CONSTRAINT "workstation_user_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workstation_user_usage_user_index" ON "workstation_user_usage" USING btree ("user_id");