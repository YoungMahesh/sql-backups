CREATE TABLE `saved_connection` (
	`id` varchar(36) PRIMARY KEY,
	`user_id` varchar(36) NOT NULL,
	`host` varchar(255) NOT NULL,
	`port` int NOT NULL DEFAULT 3306,
	`username` varchar(255) NOT NULL,
	`database` varchar(255),
	`encrypted_connection_string` text NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `saved_connection_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE INDEX `saved_connection_userId_idx` ON `saved_connection` (`user_id`);--> statement-breakpoint
CREATE INDEX `saved_connection_lookup_idx` ON `saved_connection` (`user_id`,`host`,`port`,`username`);