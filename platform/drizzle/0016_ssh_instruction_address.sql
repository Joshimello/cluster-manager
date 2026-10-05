ALTER TABLE "workstations" ADD COLUMN "ip_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workstations" ADD COLUMN "ssh_address_override" varchar(253);