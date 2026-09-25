CREATE TABLE `backup_schedule` (
	`id` varchar(36) PRIMARY KEY,
	`user_id` varchar(36) NOT NULL,
	`saved_connection_id` varchar(36) NOT NULL,
	`database_name` varchar(255) NOT NULL,
	`cron_expression` varchar(100) NOT NULL,
	`timezone` varchar(64) NOT NULL,
	`retention_count` int NOT NULL DEFAULT 7,
	`enabled` boolean NOT NULL DEFAULT true,
	`last_run_at` timestamp(3),
	`next_run_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `backup_schedule_unique_idx` UNIQUE INDEX(`saved_connection_id`,`database_name`)
);
--> statement-breakpoint
CREATE TABLE `backup_run` (
	`id` varchar(36) PRIMARY KEY,
	`schedule_id` varchar(36) NOT NULL,
	`started_at` timestamp(3) NOT NULL DEFAULT (now()),
	`finished_at` timestamp(3),
	`status` varchar(16) NOT NULL,
	`error_message` text,
	`skip_reason` varchar(64),
	`backup_id` varchar(36)
);
--> statement-breakpoint
ALTER TABLE `user` ADD `timezone` varchar(64);--> statement-breakpoint
CREATE INDEX `backup_schedule_userId_idx` ON `backup_schedule` (`user_id`);--> statement-breakpoint
CREATE INDEX `backup_schedule_tick_idx` ON `backup_schedule` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `backup_run_schedule_idx` ON `backup_run` (`schedule_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `backup_run_status_idx` ON `backup_run` (`status`);--> statement-breakpoint
ALTER TABLE `backup_schedule` ADD CONSTRAINT `backup_schedule_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `backup_schedule` ADD CONSTRAINT `backup_schedule_saved_connection_id_saved_connection_id_fkey` FOREIGN KEY (`saved_connection_id`) REFERENCES `saved_connection`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `backup_run` ADD CONSTRAINT `backup_run_schedule_id_backup_schedule_id_fkey` FOREIGN KEY (`schedule_id`) REFERENCES `backup_schedule`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `backup_run` ADD CONSTRAINT `backup_run_backup_id_database_backup_id_fkey` FOREIGN KEY (`backup_id`) REFERENCES `database_backup`(`id`) ON DELETE SET NULL;