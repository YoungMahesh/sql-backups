ALTER TABLE "saved_connection" ADD COLUMN "engine" varchar(32) DEFAULT 'mysql' NOT NULL;--> statement-breakpoint
ALTER TABLE "database_backup" ADD COLUMN "engine" varchar(32) DEFAULT 'mysql' NOT NULL;