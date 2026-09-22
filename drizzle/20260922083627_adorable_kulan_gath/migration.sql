CREATE TABLE "account" (
	"id" varchar(36) PRIMARY KEY,
	"issuer" varchar(191) NOT NULL,
	"account_id" varchar(191) NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" varchar(36) PRIMARY KEY,
	"expires_at" timestamp with time zone NOT NULL,
	"token" varchar(255) NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" varchar(36) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" varchar(36) PRIMARY KEY,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"timezone" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" varchar(36) PRIMARY KEY,
	"identifier" varchar(255) NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_connection" (
	"id" varchar(36) PRIMARY KEY,
	"user_id" varchar(36) NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer DEFAULT 3306 NOT NULL,
	"username" varchar(255) NOT NULL,
	"database" varchar(255),
	"encrypted_connection_string" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "database_backup" (
	"id" varchar(36) PRIMARY KEY,
	"user_id" varchar(36) NOT NULL,
	"database_name" varchar(255) NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer DEFAULT 3306 NOT NULL,
	"s3_key" varchar(512) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_schedule" (
	"id" varchar(36) PRIMARY KEY,
	"user_id" varchar(36) NOT NULL,
	"saved_connection_id" varchar(36) NOT NULL,
	"database_name" varchar(255) NOT NULL,
	"cron_expression" varchar(100) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"retention_count" integer DEFAULT 7 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_run" (
	"id" varchar(36) PRIMARY KEY,
	"schedule_id" varchar(36) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" varchar(16) NOT NULL,
	"error_message" text,
	"skip_reason" varchar(64),
	"backup_id" varchar(36)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "saved_connection_userId_idx" ON "saved_connection" ("user_id");--> statement-breakpoint
CREATE INDEX "saved_connection_lookup_idx" ON "saved_connection" ("user_id","host","port","username");--> statement-breakpoint
CREATE INDEX "database_backup_userId_idx" ON "database_backup" ("user_id");--> statement-breakpoint
CREATE INDEX "database_backup_createdAt_idx" ON "database_backup" ("created_at");--> statement-breakpoint
CREATE INDEX "database_backup_lookup_idx" ON "database_backup" ("user_id","database_name");--> statement-breakpoint
CREATE INDEX "backup_schedule_userId_idx" ON "backup_schedule" ("user_id");--> statement-breakpoint
CREATE INDEX "backup_schedule_tick_idx" ON "backup_schedule" ("enabled","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "backup_schedule_unique_idx" ON "backup_schedule" ("saved_connection_id","database_name");--> statement-breakpoint
CREATE INDEX "backup_run_schedule_idx" ON "backup_run" ("schedule_id","started_at");--> statement-breakpoint
CREATE INDEX "backup_run_status_idx" ON "backup_run" ("status");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "saved_connection" ADD CONSTRAINT "saved_connection_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "database_backup" ADD CONSTRAINT "database_backup_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD CONSTRAINT "backup_schedule_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_schedule" ADD CONSTRAINT "backup_schedule_saved_connection_id_saved_connection_id_fkey" FOREIGN KEY ("saved_connection_id") REFERENCES "saved_connection"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_schedule_id_backup_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "backup_schedule"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_backup_id_database_backup_id_fkey" FOREIGN KEY ("backup_id") REFERENCES "database_backup"("id") ON DELETE SET NULL;