CREATE TABLE "account_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workstation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"account" jsonb NOT NULL,
	"generation" integer NOT NULL,
	"delete_home" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_operations_kind_check" CHECK ("account_operations"."kind" in ('adopt','remove')),
	CONSTRAINT "account_operations_generation_check" CHECK ("account_operations"."generation" > 0),
	CONSTRAINT "account_operations_status_check" CHECK ("account_operations"."status" in ('pending','dispatched','adopted','completed','blocked','failed','expired'))
);
--> statement-breakpoint
CREATE TABLE "posix_identity_reservations" (
	"posix_id" integer PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"conflicted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "posix_identity_reservations_posix_id_check" CHECK ("posix_identity_reservations"."posix_id" between 20000 and 59999)
);
--> statement-breakpoint
ALTER TABLE "workstation_assignments" ADD COLUMN "account_state" text DEFAULT 'managed' NOT NULL;--> statement-breakpoint
ALTER TABLE "workstations" ADD COLUMN "account_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_workstation_id_workstations_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_assignment_id_workstation_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."workstation_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_operations_workstation_status_idx" ON "account_operations" USING btree ("workstation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "account_operations_active_assignment" ON "account_operations" USING btree ("assignment_id") WHERE "account_operations"."status" in ('pending','dispatched','adopted');--> statement-breakpoint
ALTER TABLE "workstation_assignments" ADD CONSTRAINT "assignment_account_state" CHECK ("workstation_assignments"."account_state" in ('managed','adopting','removing','removed'));
--> statement-breakpoint
INSERT INTO posix_identity_reservations (posix_id, username) SELECT posix_uid, username FROM users;
