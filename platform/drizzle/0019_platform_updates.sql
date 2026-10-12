CREATE TABLE "platform_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"source_version" text NOT NULL,
	"target_version" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"detail" text DEFAULT 'Waiting for the updater.' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "platform_update_status" CHECK ("platform_updates"."status" in ('pending','preparing','backing_up','restarting','succeeded','failed','expired'))
);
--> statement-breakpoint
ALTER TABLE "platform_updates" ADD CONSTRAINT "platform_updates_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_update_active" ON "platform_updates" USING btree ((1)) WHERE "platform_updates"."status" in ('pending','preparing','backing_up','restarting');