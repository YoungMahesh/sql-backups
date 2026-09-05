CREATE TABLE `database_backup` (
	`id` varchar(36) PRIMARY KEY,
	`user_id` varchar(36) NOT NULL,
	`database_name` varchar(255) NOT NULL,
	`host` varchar(255) NOT NULL,
	`port` int NOT NULL DEFAULT 3306,
	`s3_key` varchar(512) NOT NULL,
	`size_bytes` bigint NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `database_backup_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE INDEX `database_backup_userId_idx` ON `database_backup` (`user_id`);--> statement-breakpoint
CREATE INDEX `database_backup_createdAt_idx` ON `database_backup` (`created_at`);--> statement-breakpoint
CREATE INDEX `database_backup_lookup_idx` ON `database_backup` (`user_id`,`database_name`);