CREATE TYPE "public"."stop_request_status" AS ENUM('pending', 'termination_requested', 'resolved', 'dismissed', 'stale', 'failed');--> statement-breakpoint
CREATE TYPE "public"."termination_instruction_status" AS ENUM('pending', 'dispatched', 'completed', 'expired');--> statement-breakpoint
CREATE TABLE "stop_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"gpu_id" uuid NOT NULL,
	"workstation_id" uuid NOT NULL,
	"requester_user_id" uuid NOT NULL,
	"status" "stop_request_status" DEFAULT 'pending' NOT NULL,
	"target_pid" integer NOT NULL,
	"target_uid" integer NOT NULL,
	"target_username" varchar(64) NOT NULL,
	"target_command" varchar(128) NOT NULL,
	"target_memory_used_bytes" bigint NOT NULL,
	"target_process_start_ticks" bigint NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"result_message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "termination_instructions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stop_request_id" uuid NOT NULL,
	"workstation_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"status" "termination_instruction_status" DEFAULT 'pending' NOT NULL,
	"gpu_uuid" varchar(128) NOT NULL,
	"target_pid" integer NOT NULL,
	"target_uid" integer NOT NULL,
	"target_process_start_ticks" bigint NOT NULL,
	"allow_sigkill" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"outcome" varchar(64),
	"detail" text,
	"term_sent" boolean DEFAULT false NOT NULL,
	"kill_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stop_requests" ADD CONSTRAINT "stop_requests_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_requests" ADD CONSTRAINT "stop_requests_gpu_id_gpus_id_fk" FOREIGN KEY ("gpu_id") REFERENCES "public"."gpus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_requests" ADD CONSTRAINT "stop_requests_workstation_id_workstations_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_requests" ADD CONSTRAINT "stop_requests_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_requests" ADD CONSTRAINT "stop_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termination_instructions" ADD CONSTRAINT "termination_instructions_stop_request_id_stop_requests_id_fk" FOREIGN KEY ("stop_request_id") REFERENCES "public"."stop_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termination_instructions" ADD CONSTRAINT "termination_instructions_workstation_id_workstations_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termination_instructions" ADD CONSTRAINT "termination_instructions_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stop_requests_actionable_target_unique" ON "stop_requests" USING btree ("reservation_id","target_pid","target_uid","target_process_start_ticks") WHERE "stop_requests"."status" in ('pending', 'termination_requested');--> statement-breakpoint
CREATE INDEX "stop_requests_requester_status_index" ON "stop_requests" USING btree ("requester_user_id","status");--> statement-breakpoint
CREATE INDEX "stop_requests_workstation_status_index" ON "stop_requests" USING btree ("workstation_id","status");--> statement-breakpoint
CREATE INDEX "stop_requests_requested_at_index" ON "stop_requests" USING btree ("requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "termination_instructions_stop_request_unique" ON "termination_instructions" USING btree ("stop_request_id");--> statement-breakpoint
CREATE INDEX "termination_instructions_workstation_status_index" ON "termination_instructions" USING btree ("workstation_id","status");--> statement-breakpoint
CREATE INDEX "termination_instructions_expires_at_index" ON "termination_instructions" USING btree ("expires_at");