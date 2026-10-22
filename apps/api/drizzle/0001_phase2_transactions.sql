CREATE TABLE `saved_filters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`filter` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_filters_user_name_unique` ON `saved_filters` (`user_id`,lower("name"));--> statement-breakpoint
ALTER TABLE `transactions` ADD `client_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_client_id_unique` ON `transactions` (`client_id`);