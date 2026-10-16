CREATE TABLE "oidc_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"secret" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_objects" (
	"model" text NOT NULL,
	"id" text NOT NULL,
	"payload" text NOT NULL,
	"grant_id" text,
	"user_id" uuid,
	"security_version" integer,
	"client_id" uuid,
	"uid" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "oidc_objects_model_id_pk" PRIMARY KEY("model","id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "security_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "oidc_objects" ADD CONSTRAINT "oidc_objects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_objects" ADD CONSTRAINT "oidc_objects_client_id_oidc_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oidc_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oidc_objects_grant" ON "oidc_objects" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "oidc_objects_uid" ON "oidc_objects" USING btree ("uid");--> statement-breakpoint
CREATE INDEX "oidc_objects_expiry" ON "oidc_objects" USING btree ("expires_at");--> statement-breakpoint
CREATE FUNCTION advance_user_security_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.password_hash IS DISTINCT FROM OLD.password_hash OR NEW.status IS DISTINCT FROM OLD.status OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.must_change_password IS DISTINCT FROM OLD.must_change_password THEN
  NEW.security_version := OLD.security_version + 1;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER user_security_version BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION advance_user_security_version();
