CREATE SEQUENCE "public"."user_posix_identity_sequence" INCREMENT BY 1 MINVALUE 20000 MAXVALUE 59999 START WITH 20000 CACHE 1;--> statement-breakpoint
DROP INDEX "workstation_assignments_active_user_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "posix_uid" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "posix_gid" integer;--> statement-breakpoint
WITH ranked_users AS MATERIALIZED (
  SELECT id, (19999 + row_number() OVER (ORDER BY created_at, id))::integer AS posix_id
  FROM users
)
UPDATE users
SET posix_uid = ranked_users.posix_id, posix_gid = ranked_users.posix_id
FROM ranked_users
WHERE users.id = ranked_users.id;--> statement-breakpoint
SELECT setval('user_posix_identity_sequence', maximum_posix_id, true)
FROM (SELECT max(posix_uid) AS maximum_posix_id FROM users) allocated
WHERE maximum_posix_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "posix_uid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "posix_gid" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_posix_uid_unique" ON "users" USING btree ("posix_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "users_posix_gid_unique" ON "users" USING btree ("posix_gid");--> statement-breakpoint
CREATE UNIQUE INDEX "workstation_assignments_active_user_workstation_unique" ON "workstation_assignments" USING btree ("user_id","workstation_id") WHERE "workstation_assignments"."status" = 'active';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_posix_identity_range" CHECK ("users"."posix_uid" between 20000 and 59999 and "users"."posix_gid" between 20000 and 59999);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_posix_uid_gid_match" CHECK ("users"."posix_uid" = "users"."posix_gid");
